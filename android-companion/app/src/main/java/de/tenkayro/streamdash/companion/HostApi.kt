package de.tenkayro.streamdash.companion

import org.json.JSONObject
import java.io.BufferedReader
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import java.net.URLDecoder
import java.net.URLEncoder

object HostApi {
    const val DEFAULT_PORT = 48950

    sealed class VerifyResult {
        data class Success(val hostName: String, val authRequired: Boolean) : VerifyResult()
        data class InvalidToken(val hostName: String) : VerifyResult()
        data class CodeRequired(val hostName: String) : VerifyResult()
        data class Unreachable(val reason: String) : VerifyResult()
    }

    data class HealthInfo(
        val ok: Boolean,
        val authRequired: Boolean,
        val hostName: String,
        val version: String
    )

    fun parseQrUrl(raw: String): ParsedTarget? {
        val trimmed = raw.trim()
        if (trimmed.isEmpty()) return null
        val uri = runCatching { URI(trimmed) }.getOrNull() ?: return null
        val scheme = uri.scheme?.lowercase().orEmpty()
        if (scheme != "http" && scheme != "https") return null
        val host = uri.host?.trim().orEmpty()
        if (host.isEmpty()) return null
        val port = if (uri.port > 0) uri.port else DEFAULT_PORT
        if (port !in 1..65535) return null
        val token = extractQueryParam(uri.rawQuery.orEmpty(), "token")
        return ParsedTarget(host = host, port = port, token = token)
    }

    private fun extractQueryParam(rawQuery: String, key: String): String {
        if (rawQuery.isBlank()) return ""
        for (pair in rawQuery.split('&')) {
            val eqIdx = pair.indexOf('=')
            val k = if (eqIdx >= 0) pair.substring(0, eqIdx) else pair
            if (URLDecoder.decode(k, "UTF-8") == key) {
                val v = if (eqIdx >= 0) pair.substring(eqIdx + 1) else ""
                return URLDecoder.decode(v, "UTF-8").trim()
            }
        }
        return ""
    }

    fun buildDashboardUrl(host: String, port: Int, token: String): String {
        val cleanHost = host.trim()
        val cleanToken = token.trim()
        return if (cleanToken.isEmpty()) {
            "http://$cleanHost:$port/"
        } else {
            "http://$cleanHost:$port/?token=${URLEncoder.encode(cleanToken, "UTF-8")}"
        }
    }

    fun isHostDashboardUrl(rawUrl: String?, expectedHost: String?, expectedPort: Int): Boolean {
        if (rawUrl.isNullOrBlank() || expectedHost.isNullOrBlank() || expectedPort !in 1..65535) {
            return false
        }
        val uri = runCatching { URI(rawUrl.trim()) }.getOrNull() ?: return false
        val scheme = uri.scheme?.lowercase().orEmpty()
        if (scheme != "http" && scheme != "https") return false
        val urlHost = uri.host?.trim().orEmpty()
        val urlPort = when {
            uri.port > 0 -> uri.port
            scheme == "https" -> 443
            else -> 80
        }
        return urlHost.equals(expectedHost.trim(), ignoreCase = true) && urlPort == expectedPort
    }

    internal fun parseHealthJson(raw: String, fallbackHost: String): HealthInfo? {
        val json = runCatching { JSONObject(raw) }.getOrNull() ?: return null
        if (!json.optBoolean("ok", false)) return null
        val service = json.optString("service").trim()
        val isStreamDash = service == "streamdash-host" ||
            (json.has("hostName") && json.has("authRequired"))
        if (!isStreamDash) return null
        return HealthInfo(
            ok = true,
            authRequired = json.optBoolean("authRequired", true),
            hostName = json.optString("hostName").trim().ifEmpty { fallbackHost.trim() },
            version = json.optString("version").trim()
        )
    }

    fun checkHealth(host: String, port: Int, timeoutMs: Int = 2500): HealthInfo? {
        val url = URL("http://${host.trim()}:$port/api/health")
        var conn: HttpURLConnection? = null
        return try {
            conn = (url.openConnection() as HttpURLConnection).apply {
                connectTimeout = timeoutMs
                readTimeout = timeoutMs
                requestMethod = "GET"
            }
            if (conn.responseCode != 200) return null
            val body = conn.inputStream.bufferedReader().use(BufferedReader::readText)
            parseHealthJson(body, host)
        } catch (_: Exception) {
            null
        } finally {
            conn?.disconnect()
        }
    }

    fun verifyConnection(host: String, port: Int, token: String): VerifyResult {
        val health = checkHealth(host, port)
            ?: return VerifyResult.Unreachable("Health check failed")

        val cleanToken = token.trim()
        if (!health.authRequired) {
            return VerifyResult.Success(hostName = health.hostName, authRequired = false)
        }
        if (cleanToken.isEmpty()) {
            return VerifyResult.CodeRequired(hostName = health.hostName)
        }

        val statusUrl = URL("http://${host.trim()}:$port/api/host-status")
        var conn: HttpURLConnection? = null
        return try {
            conn = (statusUrl.openConnection() as HttpURLConnection).apply {
                connectTimeout = 3000
                readTimeout = 3000
                requestMethod = "GET"
                setRequestProperty("X-SD-Token", cleanToken)
            }
            when (conn.responseCode) {
                200 -> VerifyResult.Success(hostName = health.hostName, authRequired = true)
                401, 403 -> VerifyResult.InvalidToken(hostName = health.hostName)
                else -> VerifyResult.Unreachable("HTTP ${conn.responseCode}")
            }
        } catch (e: Exception) {
            VerifyResult.Unreachable(e.message ?: "Connection failed")
        } finally {
            conn?.disconnect()
        }
    }

    fun fetchCompanionSettings(host: String, port: Int, token: String): CompanionSettings? {
        val url = URL("http://${host.trim()}:$port/api/companion-settings")
        var conn: HttpURLConnection? = null
        return try {
            conn = (url.openConnection() as HttpURLConnection).apply {
                connectTimeout = 3000
                readTimeout = 3000
                requestMethod = "GET"
                if (token.isNotBlank()) {
                    setRequestProperty("X-SD-Token", token.trim())
                }
            }
            if (conn.responseCode != 200) return null
            val body = conn.inputStream.bufferedReader().use(BufferedReader::readText)
            val obj = JSONObject(body).optJSONObject("companion") ?: return null
            CompanionSettings.fromJson(obj)
        } catch (_: Exception) {
            null
        } finally {
            conn?.disconnect()
        }
    }

    fun pushCompanionSettings(
        host: String,
        port: Int,
        token: String,
        settings: CompanionSettings
    ): Boolean {
        val url = URL("http://${host.trim()}:$port/api/action")
        var conn: HttpURLConnection? = null
        return try {
            val payload = JSONObject()
                .put("type", "companion.settings")
                .put("payload", settings.toJson())
                .toString()
                .toByteArray(Charsets.UTF_8)
            conn = (url.openConnection() as HttpURLConnection).apply {
                connectTimeout = 3000
                readTimeout = 3000
                requestMethod = "POST"
                doOutput = true
                setRequestProperty("Content-Type", "application/json")
                if (token.isNotBlank()) {
                    setRequestProperty("X-SD-Token", token.trim())
                }
            }
            conn.outputStream.use { it.write(payload) }
            conn.responseCode in 200..299
        } catch (_: Exception) {
            false
        } finally {
            conn?.disconnect()
        }
    }
}
