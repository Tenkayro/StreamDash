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
    private val onEventData: (String) -> Unit,
    private val onHostStopped: () -> Unit = {},
    private val onUnauthorized: () -> Unit = {},
    private val onConnectionLost: () -> Unit = {}
) {
    private enum class StreamOutcome {
        HOST_STOPPED,
        UNAUTHORIZED,
        DISCONNECTED,
    }

    private val stopped = AtomicBoolean(false)
    @Volatile
    private var activeConn: HttpURLConnection? = null
    @Volatile
    private var workerThread: Thread? = null

    fun start() {
        if (stopped.get()) return
        val thread = Thread({
            var backoffMs = 1500L
            while (!stopped.get()) {
                when (streamOnce()) {
                    StreamOutcome.HOST_STOPPED -> {
                        stopped.set(true)
                        onHostStopped()
                        break
                    }
                    StreamOutcome.UNAUTHORIZED -> {
                        stopped.set(true)
                        onUnauthorized()
                        break
                    }
                    StreamOutcome.DISCONNECTED -> {
                        if (stopped.get()) break
                        onConnectionLost()
                        backoffMs = (backoffMs * 2).coerceAtMost(10000L)
                        try {
                            Thread.sleep(backoffMs)
                        } catch (_: InterruptedException) {
                            break
                        }
                    }
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

    private fun streamOnce(): StreamOutcome {
        var conn: HttpURLConnection? = null
        return try {
            val ipv4Host = HostApi.resolveIpv4Host(host) ?: return StreamOutcome.DISCONNECTED
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
            val code = conn.responseCode
            if (code == 401 || code == 403) return StreamOutcome.UNAUTHORIZED
            if (code != 200) return StreamOutcome.DISCONNECTED

            BufferedReader(InputStreamReader(conn.inputStream, Charsets.UTF_8)).use { reader ->
                var currentEvent = ""
                val dataBuf = StringBuilder()
                while (!stopped.get()) {
                    val line = reader.readLine() ?: break
                    when {
                        line.startsWith("event:") -> {
                            currentEvent = line.removePrefix("event:").trim()
                        }
                        line.startsWith("data:") -> {
                            if (dataBuf.isNotEmpty()) dataBuf.append('\n')
                            dataBuf.append(line.removePrefix("data:").trimStart())
                        }
                        line.isEmpty() -> {
                            if (dataBuf.isNotEmpty() || currentEvent.isNotEmpty()) {
                                val eventName = currentEvent
                                val payload = dataBuf.toString()
                                currentEvent = ""
                                dataBuf.setLength(0)
                                if (eventName == "host_stopped" || payload.contains("\"kind\":\"host_stopped\"")) {
                                    return StreamOutcome.HOST_STOPPED
                                }
                                if (payload.isNotEmpty()) {
                                    onEventData(payload)
                                }
                            }
                        }
                    }
                }
            }
            StreamOutcome.DISCONNECTED
        } catch (_: Exception) {
            StreamOutcome.DISCONNECTED
        } finally {
            if (activeConn == conn) activeConn = null
            runCatching { conn?.disconnect() }
        }
    }
}
