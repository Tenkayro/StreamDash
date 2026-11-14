package de.tenkayro.streamdash.companion

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.wifi.WifiManager
import org.json.JSONObject
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.Inet4Address
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.NetworkInterface
import java.net.Socket
import java.net.SocketTimeoutException
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

object LanDiscovery {
    const val DISCOVERY_PORT = 48951
    private val MAGIC = "STREAMDASH_DISCOVER_V1".toByteArray(Charsets.UTF_8)
    private const val SUBNET_PROBE_THREADS = 32
    private const val TCP_CONNECT_TIMEOUT_MS = 180
    private const val HEALTH_HTTP_TIMEOUT_MS = 550

    private val EXCLUDED_IFACE_PREFIXES = listOf(
        "rmnet", "ccmni", "pdp", "tun", "tap", "ppp", "dummy", "lo", "v4-"
    )

    data class LanInterfaceInfo(
        val localIp: String,
        val prefixLength: Int,
        val broadcastIp: String?
    )

    fun hasLanConnection(context: Context): Boolean {
        val cm = context.applicationContext.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
        if (cm != null) {
            val network = cm.activeNetwork
            val caps = if (network != null) cm.getNetworkCapabilities(network) else null
            if (caps != null && (
                    caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) ||
                        caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)
                    )
            ) {
                return true
            }
        }
        return collectLanInterfaces(context).isNotEmpty()
    }

    fun discover(
        context: Context,
        knownHosts: List<KnownHostHint> = emptyList(),
        candidatePorts: List<Int> = listOf(HostApi.DEFAULT_PORT),
        timeoutMs: Int = 1600,
        cancelFlag: AtomicBoolean = AtomicBoolean(false),
        onUpdate: ((List<DiscoveredHost>) -> Unit)? = null
    ): List<DiscoveredHost> {
        val appContext = context.applicationContext
        val wifiManager = appContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
        val lock = runCatching {
            wifiManager?.createMulticastLock("streamdash_discovery")?.apply {
                setReferenceCounted(false)
                acquire()
            }
        }.getOrNull()

        val found = ConcurrentHashMap<String, DiscoveredHost>()
        val scanPool = Executors.newFixedThreadPool(SUBNET_PROBE_THREADS)
        val ports = candidatePorts
            .filter { it in 1024..65535 }
            .ifEmpty { listOf(HostApi.DEFAULT_PORT) }
            .distinct()

        fun notifyIfChanged() {
            if (!cancelFlag.get()) {
                onUpdate?.invoke(sortHosts(found.values))
            }
        }

        fun mergeHost(host: DiscoveredHost) {
            val key = "${host.ip}:${host.port}"
            val existing = found[key]
            val merged = if (existing == null) {
                host
            } else {
                existing.copy(
                    hostName = if (existing.hostName == existing.ip && host.hostName != host.ip) {
                        host.hostName
                    } else {
                        existing.hostName
                    },
                    version = existing.version.ifEmpty { host.version },
                    authRequired = host.authRequired,
                    ips = (existing.ips + host.ips).distinct()
                )
            }
            if (merged != existing) {
                found[key] = merged
                notifyIfChanged()
            }
        }

        val interfaces = collectLanInterfaces(appContext)
        val broadcastTargets = collectBroadcastAddresses(interfaces)

        val udpDone = CountDownLatch(1)
        val knownDone = CountDownLatch(1)
        val subnetDone = CountDownLatch(1)

        try {
            // 1. Direct fast HTTP probe for previously paired / recent hosts
            scanPool.execute {
                try {
                    probeKnownHosts(knownHosts, ports, cancelFlag, ::mergeHost)
                } finally {
                    knownDone.countDown()
                }
            }

            // 2. UDP broadcast discovery across 255.255.255.255 + NIC/computed broadcasts
            Thread({
                try {
                    runUdpDiscovery(
                        targets = broadcastTargets,
                        timeoutMs = minOf(timeoutMs, 1100),
                        cancelFlag = cancelFlag,
                        onHostFound = ::mergeHost
                    )
                } finally {
                    udpDone.countDown()
                }
            }, "sd-udp-discover").start()

            // 3. Parallel /24 TCP+HTTP fallback (resilient when UDP 48951 is filtered)
            Thread({
                try {
                    runSubnetFallbackScan(
                        interfaces = interfaces,
                        ports = ports,
                        pool = scanPool,
                        cancelFlag = cancelFlag,
                        onHostFound = ::mergeHost
                    )
                } finally {
                    subnetDone.countDown()
                }
            }, "sd-subnet-discover").start()

            knownDone.await(900, TimeUnit.MILLISECONDS)
            udpDone.await(1300, TimeUnit.MILLISECONDS)
            subnetDone.await(timeoutMs.toLong().coerceAtLeast(1600L), TimeUnit.MILLISECONDS)
        } catch (_: InterruptedException) {
            Thread.currentThread().interrupt()
        } finally {
            scanPool.shutdownNow()
            runCatching {
                if (lock?.isHeld == true) lock.release()
            }
        }

        return sortHosts(found.values)
    }

    private fun probeKnownHosts(
        knownHosts: List<KnownHostHint>,
        ports: List<Int>,
        cancelFlag: AtomicBoolean,
        onHostFound: (DiscoveredHost) -> Unit
    ) {
        val targets = linkedSetOf<KnownHostHint>()
        for (hint in knownHosts) {
            val ip = hint.ip.trim()
            if (ip.isEmpty()) continue
            targets.add(KnownHostHint(ip, hint.port))
            for (p in ports) {
                targets.add(KnownHostHint(ip, p))
            }
        }
        if (targets.isEmpty()) return

        val latch = CountDownLatch(targets.size)
        val probePool = Executors.newFixedThreadPool(minOf(targets.size, 8))
        try {
            for (target in targets) {
                probePool.execute {
                    try {
                        if (!cancelFlag.get()) {
                            probeHealthEndpoint(target.ip, target.port)?.let(onHostFound)
                        }
                    } finally {
                        latch.countDown()
                    }
                }
            }
            latch.await(900, TimeUnit.MILLISECONDS)
        } finally {
            probePool.shutdownNow()
        }
    }

    private fun runUdpDiscovery(
        targets: List<InetAddress>,
        timeoutMs: Int,
        cancelFlag: AtomicBoolean,
        onHostFound: (DiscoveredHost) -> Unit
    ) {
        var socket: DatagramSocket? = null
        try {
            socket = DatagramSocket().apply {
                reuseAddress = true
                broadcast = true
                soTimeout = 280
            }

            sendProbes(socket, targets)
            val start = System.currentTimeMillis()
            val deadline = start + timeoutMs
            var secondProbeSent = false
            val buf = ByteArray(4096)

            while (!cancelFlag.get() && System.currentTimeMillis() < deadline) {
                if (!secondProbeSent && System.currentTimeMillis() - start >= 280) {
                    secondProbeSent = true
                    sendProbes(socket, targets)
                }
                val packet = DatagramPacket(buf, buf.size)
                try {
                    socket.receive(packet)
                    val payload = String(packet.data, packet.offset, packet.length, Charsets.UTF_8)
                    val senderIp = packet.address?.hostAddress.orEmpty()
                    parseDiscoveryResponse(payload, senderIp)?.let(onHostFound)
                } catch (_: SocketTimeoutException) {
                    // Continue polling until deadline
                }
            }
        } catch (_: Exception) {
            // Best-effort discovery; HTTP subnet fallback handles filtered UDP
        } finally {
            runCatching { socket?.close() }
        }
    }

    private fun runSubnetFallbackScan(
        interfaces: List<LanInterfaceInfo>,
        ports: List<Int>,
        pool: java.util.concurrent.ExecutorService,
        cancelFlag: AtomicBoolean,
        onHostFound: (DiscoveredHost) -> Unit
    ) {
        val candidateIps = LinkedHashSet<String>()
        for (iface in interfaces.take(2)) {
            for (ip in enumerateSubnetIps(iface.localIp, iface.prefixLength)) {
                candidateIps.add(ip)
            }
        }
        if (candidateIps.isEmpty()) return

        val totalTasks = candidateIps.size * ports.size
        val latch = CountDownLatch(totalTasks)

        for (port in ports) {
            for (ip in candidateIps) {
                if (cancelFlag.get()) {
                    latch.countDown()
                    continue
                }
                runCatching {
                    pool.execute {
                        try {
                            if (cancelFlag.get()) return@execute
                            if (isTcpPortOpen(ip, port)) {
                                probeHealthEndpoint(ip, port)?.let(onHostFound)
                            }
                        } finally {
                            latch.countDown()
                        }
                    }
                }.onFailure {
                    latch.countDown()
                }
            }
        }
        latch.await(2200, TimeUnit.MILLISECONDS)
    }

    private fun isTcpPortOpen(ip: String, port: Int): Boolean {
        var sock: Socket? = null
        return try {
            sock = Socket()
            sock.connect(InetSocketAddress(ip, port), TCP_CONNECT_TIMEOUT_MS)
            true
        } catch (_: Exception) {
            false
        } finally {
            runCatching { sock?.close() }
        }
    }

    private fun probeHealthEndpoint(ip: String, port: Int): DiscoveredHost? {
        val health = HostApi.checkHealth(ip, port, timeoutMs = HEALTH_HTTP_TIMEOUT_MS) ?: return null
        return DiscoveredHost(
            hostName = health.hostName,
            ip = ip,
            port = port,
            authRequired = health.authRequired,
            version = health.version,
            ips = listOf(ip)
        )
    }

    internal fun parseDiscoveryResponse(raw: String, senderIp: String): DiscoveredHost? {
        val json = runCatching { JSONObject(raw) }.getOrNull() ?: return null
        if (json.optString("service") != "streamdash-host") return null
        val port = json.optInt("port", 0)
        if (port !in 1..65535) return null

        val ipsJson = json.optJSONArray("ips")
        val ips = mutableListOf<String>()
        if (ipsJson != null) {
            for (i in 0 until ipsJson.length()) {
                val ip = ipsJson.optString(i).trim()
                if (HostApi.isIpv4Literal(ip)) ips.add(ip)
            }
        }

        val cleanSender = senderIp.trim().takeIf { HostApi.isIpv4Literal(it) }.orEmpty()
        val chosenIp = cleanSender.ifBlank { ips.firstOrNull().orEmpty() }
        if (chosenIp.isBlank()) return null

        val hostName = json.optString("hostName").trim().ifEmpty { chosenIp }
        val authRequired = json.optBoolean("authRequired", true)
        val version = json.optString("version").trim()
        return DiscoveredHost(
            hostName = hostName,
            ip = chosenIp,
            port = port,
            authRequired = authRequired,
            version = version,
            ips = if (ips.isEmpty()) listOf(chosenIp) else ips
        )
    }

    private fun sortHosts(values: Collection<DiscoveredHost>): List<DiscoveredHost> =
        values.sortedWith(compareBy({ it.hostName.lowercase() }, { it.ip }, { it.port }))

    private fun sendProbes(socket: DatagramSocket, targets: List<InetAddress>) {
        for (addr in targets) {
            runCatching {
                val pkt = DatagramPacket(MAGIC, MAGIC.size, addr, DISCOVERY_PORT)
                socket.send(pkt)
            }
        }
    }

    private fun collectLanInterfaces(context: Context): List<LanInterfaceInfo> {
        val result = linkedMapOf<String, LanInterfaceInfo>()

        // 1. Prefer Android ConnectivityManager active Wi-Fi/Ethernet LinkProperties
        runCatching {
            val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
            val network = cm?.activeNetwork
            val caps = if (network != null) cm.getNetworkCapabilities(network) else null
            val isLan = caps != null && (
                caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) ||
                    caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)
                )
            if (isLan) {
                val props = cm?.getLinkProperties(network)
                if (props != null) {
                    for (la in props.linkAddresses) {
                        val addr = la.address
                        if (addr is Inet4Address && !addr.isLoopbackAddress) {
                            val ip = addr.hostAddress ?: continue
                            if (isPrivateLanIpv4(ip)) {
                                result[ip] = LanInterfaceInfo(
                                    localIp = ip,
                                    prefixLength = la.prefixLength.toInt().coerceIn(8, 30),
                                    broadcastIp = subnetBroadcast(ip, la.prefixLength.toInt())
                                )
                            }
                        }
                    }
                }
            }
        }

        // 2. Fallback / supplement via NetworkInterface for hotspot / tether / multi-NIC
        runCatching {
            val interfaces = NetworkInterface.getNetworkInterfaces()
            while (interfaces.hasMoreElements()) {
                val iface = interfaces.nextElement()
                val name = iface.name.lowercase()
                if (iface.isLoopback || !iface.isUp) continue
                if (EXCLUDED_IFACE_PREFIXES.any { name.startsWith(it) }) continue
                for (ifaceAddr in iface.interfaceAddresses) {
                    val addr = ifaceAddr.address
                    if (addr !is Inet4Address || addr.isLoopbackAddress) continue
                    val ip = addr.hostAddress ?: continue
                    if (!isPrivateLanIpv4(ip)) continue
                    val prefix = ifaceAddr.networkPrefixLength.toInt().coerceIn(8, 30)
                    val osBroadcast = (ifaceAddr.broadcast as? Inet4Address)?.hostAddress
                    result.putIfAbsent(
                        ip,
                        LanInterfaceInfo(
                            localIp = ip,
                            prefixLength = prefix,
                            broadcastIp = osBroadcast ?: subnetBroadcast(ip, prefix)
                        )
                    )
                }
            }
        }

        return result.values.toList()
    }

    private fun collectBroadcastAddresses(interfaces: List<LanInterfaceInfo>): List<InetAddress> {
        val addresses = linkedSetOf<InetAddress>()
        runCatching { addresses.add(InetAddress.getByName("255.255.255.255")) }
        for (iface in interfaces) {
            iface.broadcastIp?.let { b ->
                runCatching { addresses.add(InetAddress.getByName(b)) }
            }
            subnetBroadcast(iface.localIp, iface.prefixLength)?.let { b ->
                runCatching { addresses.add(InetAddress.getByName(b)) }
            }
        }
        return addresses.toList()
    }

    internal fun isPrivateLanIpv4(ip: String): Boolean {
        val parts = ip.split('.').mapNotNull { it.toIntOrNull() }
        if (parts.size != 4 || parts.any { it !in 0..255 }) return false
        val a = parts[0]
        val b = parts[1]
        return when {
            a == 10 -> true
            a == 172 && b in 16..31 -> true
            a == 192 && b == 168 -> true
            else -> false
        }
    }

    internal fun subnetBroadcast(ip: String, prefixLength: Int): String? {
        val parts = ip.split('.').mapNotNull { it.toIntOrNull() }
        if (parts.size != 4 || parts.any { it !in 0..255 }) return null
        val prefix = prefixLength.coerceIn(1, 32)
        val ipInt = (parts[0] shl 24) or (parts[1] shl 16) or (parts[2] shl 8) or parts[3]
        val mask = if (prefix == 0) 0 else -1 shl (32 - prefix)
        val bcast = ipInt or mask.inv()
        return listOf(
            (bcast ushr 24) and 0xFF,
            (bcast ushr 16) and 0xFF,
            (bcast ushr 8) and 0xFF,
            bcast and 0xFF
        ).joinToString(".")
    }

    internal fun enumerateSubnetIps(localIp: String, prefixLength: Int): List<String> {
        val parts = localIp.split('.').mapNotNull { it.toIntOrNull() }
        if (parts.size != 4 || parts.any { it !in 0..255 }) return emptyList()
        if (prefixLength !in 8..30) return emptyList()

        // Always sweep the immediate /24 around localIp (handles /16 and /24 cleanly within ~1.5s)
        val base = "${parts[0]}.${parts[1]}.${parts[2]}"
        val selfHost = parts[3]
        val prioritized = ArrayList<String>(254)
        for (host in 1..254) {
            if (host != selfHost) {
                prioritized.add("$base.$host")
            }
        }
        return prioritized
    }
}
