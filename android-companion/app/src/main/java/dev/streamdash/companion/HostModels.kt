package dev.streamdash.companion

import android.content.Context

data class DiscoveredHost(
    val hostName: String,
    val ip: String,
    val port: Int,
    val authRequired: Boolean,
    val version: String,
    val ips: List<String>
)

data class SavedConnection(
    val host: String,
    val port: Int,
    val token: String,
    val hostName: String
)

data class ParsedTarget(
    val host: String,
    val port: Int,
    val token: String
)

class ConnectionStore(context: Context) {
    private val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    fun loadConnection(): SavedConnection? {
        val host = prefs.getString(KEY_HOST, null)?.trim().orEmpty()
        val port = prefs.getInt(KEY_PORT, 0)
        if (host.isEmpty() || port !in 1..65535) return null
        val token = prefs.getString(KEY_TOKEN, "")?.trim().orEmpty()
        val hostName = prefs.getString(KEY_HOST_NAME, host)?.trim().orEmpty().ifEmpty { host }
        return SavedConnection(host = host, port = port, token = token, hostName = hostName)
    }

    fun saveConnection(conn: SavedConnection) {
        prefs.edit()
            .putString(KEY_HOST, conn.host.trim())
            .putInt(KEY_PORT, conn.port)
            .putString(KEY_TOKEN, conn.token.trim())
            .putString(KEY_HOST_NAME, conn.hostName.trim().ifEmpty { conn.host.trim() })
            .apply()
    }

    fun clearConnection() {
        prefs.edit()
            .remove(KEY_HOST)
            .remove(KEY_PORT)
            .remove(KEY_TOKEN)
            .remove(KEY_HOST_NAME)
            .apply()
    }

    fun isKeepScreenOn(): Boolean = prefs.getBoolean(KEY_KEEP_SCREEN_ON, true)

    fun setKeepScreenOn(enabled: Boolean) {
        prefs.edit().putBoolean(KEY_KEEP_SCREEN_ON, enabled).apply()
    }

    companion object {
        private const val PREFS_NAME = "streamdash_companion_prefs"
        private const val KEY_HOST = "saved_host"
        private const val KEY_PORT = "saved_port"
        private const val KEY_TOKEN = "saved_token"
        private const val KEY_HOST_NAME = "saved_host_name"
        private const val KEY_KEEP_SCREEN_ON = "keep_screen_on"
    }
}
