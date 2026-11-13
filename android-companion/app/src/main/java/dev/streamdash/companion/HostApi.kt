package dev.streamdash.companion

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

    fun checkHealth(host: String, port: Int): HealthInfo? {
        val url = URL("http://${host.trim()}:$port/api/health")
        var conn: HttpURLConnection? = null
        return try {
            conn = (url.openConnection() as HttpURLConnection).apply {
                connectTimeout = 2500
                readTimeout = 2500
                requestMethod = "GET"
            }
            if (conn.responseCode != 200) return null
            val body = conn.inputStream.bufferedReader().use(BufferedReader::readText)
            val json = JSONObject(body)
            if (!json.optBoolean("ok", false)) return null
            HealthInfo(
                ok = true,
                authRequired = json.optBoolean("authRequired", true),
                hostName = json.optString("hostName").trim().ifEmpty { host.trim() },
                version = json.optString("version").trim()
            )
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
}
