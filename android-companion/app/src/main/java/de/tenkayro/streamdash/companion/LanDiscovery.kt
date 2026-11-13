package de.tenkayro.streamdash.companion

import android.content.Context
import android.net.wifi.WifiManager
import org.json.JSONObject
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.Inet4Address
import java.net.InetAddress
import java.net.NetworkInterface
import java.net.SocketTimeoutException

object LanDiscovery {
    const val DISCOVERY_PORT = 48951
    private val MAGIC = "STREAMDASH_DISCOVER_V1".toByteArray(Charsets.UTF_8)

    fun discover(context: Context, timeoutMs: Int = 1500): List<DiscoveredHost> {
        val wifiManager = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
        val lock = runCatching {
            wifiManager?.createMulticastLock("streamdash_discovery")?.apply {
                setReferenceCounted(false)
                acquire()
            }
        }.getOrNull()

        val found = linkedMapOf<String, DiscoveredHost>()
        var socket: DatagramSocket? = null

        try {
            socket = DatagramSocket().apply {
                broadcast = true
                soTimeout = 350
            }

            val targets = collectBroadcastAddresses()
            sendProbes(socket, targets)

            val deadline = System.currentTimeMillis() + timeoutMs
            var secondProbeSent = false
            val buf = ByteArray(4096)

            while (System.currentTimeMillis() < deadline) {
                if (!secondProbeSent && deadline - System.currentTimeMillis() < timeoutMs - 400) {
                    secondProbeSent = true
                    sendProbes(socket, targets)
                }
                val packet = DatagramPacket(buf, buf.size)
                try {
                    socket.receive(packet)
                    val payload = String(packet.data, packet.offset, packet.length, Charsets.UTF_8)
                    val senderIp = packet.address?.hostAddress.orEmpty()
                    parseDiscoveryResponse(payload, senderIp)?.let { host ->
                        val key = "${host.hostName}:${host.port}:${host.ip}"
                        found[key] = host
                    }
                } catch (_: SocketTimeoutException) {
                    // Poll until deadline
                }
            }
        } catch (_: Exception) {
            // Best-effort discovery; manual entry remains available
        } finally {
            runCatching { socket?.close() }
            runCatching {
                if (lock?.isHeld == true) lock.release()
            }
        }

        return found.values.sortedWith(compareBy({ it.hostName.lowercase() }, { it.ip }))
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
                if (ip.isNotEmpty()) ips.add(ip)
            }
        }

        val chosenIp = senderIp.ifBlank { ips.firstOrNull().orEmpty() }
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

    private fun sendProbes(socket: DatagramSocket, targets: List<InetAddress>) {
        for (addr in targets) {
            runCatching {
                val pkt = DatagramPacket(MAGIC, MAGIC.size, addr, DISCOVERY_PORT)
                socket.send(pkt)
            }
        }
    }

    private fun collectBroadcastAddresses(): List<InetAddress> {
        val addresses = linkedSetOf<InetAddress>()
        runCatching { addresses.add(InetAddress.getByName("255.255.255.255")) }

        runCatching {
            val interfaces = NetworkInterface.getNetworkInterfaces()
            while (interfaces.hasMoreElements()) {
                val iface = interfaces.nextElement()
                if (iface.isLoopback || !iface.isUp) continue
                for (ifaceAddr in iface.interfaceAddresses) {
                    val broadcast = ifaceAddr.broadcast
                    if (broadcast is Inet4Address) {
                        addresses.add(broadcast)
                    }
                }
            }
        }
        return addresses.toList()
    }
}
