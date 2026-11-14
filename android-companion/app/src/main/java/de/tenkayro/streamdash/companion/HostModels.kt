package de.tenkayro.streamdash.companion

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

data class DiscoveredHost(
    val hostName: String,
    val ip: String,
    val port: Int,
    val authRequired: Boolean,
    val version: String,
    val ips: List<String>
)

data class KnownHostHint(
    val ip: String,
    val port: Int
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

data class CompanionSettings(
    val language: String = "system",
    val keepScreenOn: Boolean = true,
    val autoReconnect: Boolean = true,
    val notificationsEnabled: Boolean = true,
    val notifyFollows: Boolean = true,
    val notifySubs: Boolean = true,
    val notifyRaids: Boolean = true,
    val notifyCheers: Boolean = true,
    val notifyDonations: Boolean = true,
    val notifyChannelPoints: Boolean = false,
    val notifyStreamStatus: Boolean = true,
    val notifyChatMentions: Boolean = true,
    val hapticsEnabled: Boolean = true,
    val hapticStrength: String = "strong"
) {
    fun normalized(): CompanionSettings {
        val cleanLang = when (language.trim()) {
            "system", "en", "de", "es", "fr", "pt-BR" -> language.trim()
            else -> "system"
        }
        val cleanStrength = when (hapticStrength.trim()) {
            "off", "subtle", "strong" -> hapticStrength.trim()
            else -> "strong"
        }
        return copy(language = cleanLang, hapticStrength = cleanStrength)
    }

    fun toJson(): JSONObject = JSONObject()
        .put("language", normalized().language)
        .put("keepScreenOn", keepScreenOn)
        .put("autoReconnect", autoReconnect)
        .put("notificationsEnabled", notificationsEnabled)
        .put("notifyFollows", notifyFollows)
        .put("notifySubs", notifySubs)
        .put("notifyRaids", notifyRaids)
        .put("notifyCheers", notifyCheers)
        .put("notifyDonations", notifyDonations)
        .put("notifyChannelPoints", notifyChannelPoints)
        .put("notifyStreamStatus", notifyStreamStatus)
        .put("notifyChatMentions", notifyChatMentions)
        .put("hapticsEnabled", hapticsEnabled)
        .put("hapticStrength", normalized().hapticStrength)

    companion object {
        fun fromJson(json: JSONObject?, fallback: CompanionSettings = CompanionSettings()): CompanionSettings {
            if (json == null) return fallback.normalized()
            return CompanionSettings(
                language = json.optString("language", fallback.language),
                keepScreenOn = json.optBoolean("keepScreenOn", fallback.keepScreenOn),
                autoReconnect = json.optBoolean("autoReconnect", fallback.autoReconnect),
                notificationsEnabled = json.optBoolean("notificationsEnabled", fallback.notificationsEnabled),
                notifyFollows = json.optBoolean("notifyFollows", fallback.notifyFollows),
                notifySubs = json.optBoolean("notifySubs", fallback.notifySubs),
                notifyRaids = json.optBoolean("notifyRaids", fallback.notifyRaids),
                notifyCheers = json.optBoolean("notifyCheers", fallback.notifyCheers),
                notifyDonations = json.optBoolean("notifyDonations", fallback.notifyDonations),
                notifyChannelPoints = json.optBoolean("notifyChannelPoints", fallback.notifyChannelPoints),
                notifyStreamStatus = json.optBoolean("notifyStreamStatus", fallback.notifyStreamStatus),
                notifyChatMentions = json.optBoolean("notifyChatMentions", fallback.notifyChatMentions),
                hapticsEnabled = json.optBoolean("hapticsEnabled", fallback.hapticsEnabled),
                hapticStrength = json.optString("hapticStrength", fallback.hapticStrength)
            ).normalized()
        }
    }
}

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
        val cleanHost = conn.host.trim()
        val cleanName = conn.hostName.trim().ifEmpty { cleanHost }
        prefs.edit()
            .putString(KEY_HOST, cleanHost)
            .putInt(KEY_PORT, conn.port)
            .putString(KEY_TOKEN, conn.token.trim())
            .putString(KEY_HOST_NAME, cleanName)
            .apply()
        recordRecentHost(cleanHost, conn.port)
    }

    fun clearConnection() {
        prefs.edit()
            .remove(KEY_HOST)
            .remove(KEY_PORT)
            .remove(KEY_TOKEN)
            .remove(KEY_HOST_NAME)
            .apply()
    }

    fun clearAllSavedHosts() {
        prefs.edit()
            .remove(KEY_HOST)
            .remove(KEY_PORT)
            .remove(KEY_TOKEN)
            .remove(KEY_HOST_NAME)
            .remove(KEY_RECENT_HOSTS)
            .apply()
    }

    fun recordRecentHost(ip: String, port: Int) {
        val cleanIp = ip.trim()
        if (cleanIp.isEmpty() || port !in 1..65535) return
        val existing = getRecentHosts()
            .filterNot { it.ip == cleanIp && it.port == port }
            .take(MAX_RECENT_HOSTS - 1)
        val updated = listOf(KnownHostHint(cleanIp, port)) + existing
        val arr = JSONArray()
        for (item in updated) {
            arr.put(
                JSONObject()
                    .put("ip", item.ip)
                    .put("port", item.port)
            )
        }
        prefs.edit().putString(KEY_RECENT_HOSTS, arr.toString()).apply()
    }

    fun getRecentHosts(): List<KnownHostHint> {
        val out = mutableListOf<KnownHostHint>()
        loadConnection()?.let { out.add(KnownHostHint(it.host, it.port)) }
        val raw = prefs.getString(KEY_RECENT_HOSTS, null) ?: return out
        runCatching {
            val arr = JSONArray(raw)
            for (i in 0 until arr.length()) {
                val obj = arr.optJSONObject(i) ?: continue
                val ip = obj.optString("ip").trim()
                val port = obj.optInt("port", 0)
                if (ip.isNotEmpty() && port in 1..65535 && out.none { it.ip == ip && it.port == port }) {
                    out.add(KnownHostHint(ip, port))
                }
            }
        }
        return out.take(MAX_RECENT_HOSTS)
    }

    fun getCompanionSettings(): CompanionSettings {
        val legacyFallback = CompanionSettings(
            keepScreenOn = prefs.getBoolean(KEY_KEEP_SCREEN_ON, true),
            autoReconnect = prefs.getBoolean(KEY_AUTO_RECONNECT, true)
        )
        val raw = prefs.getString(KEY_COMPANION_SETTINGS, null) ?: return legacyFallback
        val json = runCatching { JSONObject(raw) }.getOrNull()
        return CompanionSettings.fromJson(json, legacyFallback)
    }

    fun saveCompanionSettings(settings: CompanionSettings, pendingHostSync: Boolean) {
        val normalized = settings.normalized()
        prefs.edit()
            .putString(KEY_COMPANION_SETTINGS, normalized.toJson().toString())
            .putBoolean(KEY_KEEP_SCREEN_ON, normalized.keepScreenOn)
            .putBoolean(KEY_AUTO_RECONNECT, normalized.autoReconnect)
            .putBoolean(KEY_COMPANION_PENDING_SYNC, pendingHostSync)
            .apply()
    }

    fun hasPendingCompanionSync(): Boolean =
        prefs.getBoolean(KEY_COMPANION_PENDING_SYNC, false)

    fun setPendingCompanionSync(pending: Boolean) {
        prefs.edit().putBoolean(KEY_COMPANION_PENDING_SYNC, pending).apply()
    }

    fun isNotificationPrompted(): Boolean =
        prefs.getBoolean(KEY_NOTIFICATION_PROMPTED, false)

    fun markNotificationPrompted() {
        prefs.edit().putBoolean(KEY_NOTIFICATION_PROMPTED, true).apply()
    }

    fun isKeepScreenOn(): Boolean = getCompanionSettings().keepScreenOn

    fun isAutoReconnect(): Boolean = getCompanionSettings().autoReconnect

    fun getDefaultHostPort(): Int {
        val p = prefs.getInt(KEY_DEFAULT_PORT, HostApi.DEFAULT_PORT)
        return if (p in 1024..65535) p else HostApi.DEFAULT_PORT
    }

    fun setDefaultHostPort(port: Int) {
        val safe = if (port in 1024..65535) port else HostApi.DEFAULT_PORT
        prefs.edit().putInt(KEY_DEFAULT_PORT, safe).apply()
    }

    companion object {
        private const val PREFS_NAME = "streamdash_companion_prefs"
        private const val KEY_HOST = "saved_host"
        private const val KEY_PORT = "saved_port"
        private const val KEY_TOKEN = "saved_token"
        private const val KEY_HOST_NAME = "saved_host_name"
        private const val KEY_RECENT_HOSTS = "recent_hosts"
        private const val KEY_COMPANION_SETTINGS = "companion_settings_json"
        private const val KEY_COMPANION_PENDING_SYNC = "companion_settings_pending_sync"
        private const val KEY_NOTIFICATION_PROMPTED = "notification_prompted"
        private const val KEY_KEEP_SCREEN_ON = "keep_screen_on"
        private const val KEY_AUTO_RECONNECT = "auto_reconnect"
        private const val KEY_DEFAULT_PORT = "default_host_port"
        private const val MAX_RECENT_HOSTS = 6
    }
}
