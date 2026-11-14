package de.tenkayro.streamdash.companion

import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.atomic.AtomicBoolean

class HostEventStream(
    private val host: String,
    private val port: Int,
    private val token: String,
    private val onEventData: (String) -> Unit
) {
    private val stopped = AtomicBoolean(false)
    @Volatile
    private var activeConn: HttpURLConnection? = null
    @Volatile
    private var workerThread: Thread? = null

    fun start() {
        if (stopped.get()) return
        val thread = Thread({
            var backoffMs = 2000L
            while (!stopped.get()) {
                val connectedCleanly = streamOnce()
                if (stopped.get()) break
                backoffMs = if (connectedCleanly) 2000L else (backoffMs * 2).coerceAtMost(10000L)
                try {
                    Thread.sleep(backoffMs)
                } catch (_: InterruptedException) {
                    break
                }
            }
        }, "sd-companion-sse")
        thread.isDaemon = true
        workerThread = thread
        thread.start()
    }

    fun stop() {
        stopped.set(true)
        runCatching { activeConn?.disconnect() }
        workerThread?.interrupt()
    }

    private fun streamOnce(): Boolean {
        var conn: HttpURLConnection? = null
        return try {
            val ipv4Host = HostApi.resolveIpv4Host(host) ?: return false
            val url = URL("http://$ipv4Host:$port/api/companion-events")
            conn = (url.openConnection() as HttpURLConnection).apply {
                connectTimeout = 5000
                readTimeout = 35000 // > 15s keep-alive interval on server
                requestMethod = "GET"
                setRequestProperty("Accept", "text/event-stream")
                if (token.isNotBlank()) {
                    setRequestProperty("X-SD-Token", token.trim())
                }
            }
            activeConn = conn
            if (conn.responseCode != 200) return false

            BufferedReader(InputStreamReader(conn.inputStream, Charsets.UTF_8)).use { reader ->
                val dataBuf = StringBuilder()
                while (!stopped.get()) {
                    val line = reader.readLine() ?: break
                    when {
                        line.startsWith("data:") -> {
                            if (dataBuf.isNotEmpty()) dataBuf.append('\n')
                            dataBuf.append(line.removePrefix("data:").trimStart())
                        }
                        line.isEmpty() -> {
                            if (dataBuf.isNotEmpty()) {
                                val payload = dataBuf.toString()
                                dataBuf.setLength(0)
                                onEventData(payload)
                            }
                        }
                    }
                }
            }
            true
        } catch (_: Exception) {
            false
        } finally {
            if (activeConn == conn) activeConn = null
            runCatching { conn?.disconnect() }
        }
    }
}
