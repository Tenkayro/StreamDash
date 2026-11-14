package de.tenkayro.streamdash.companion

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.BufferedReader
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

data class AppUpdateInfo(
    val version: String,
    val downloadUrl: String,
    val authToken: String? = null,
    val devSha256: String? = null
)

sealed class UpdateCheckResult {
    data class UpdateAvailable(val info: AppUpdateInfo) : UpdateCheckResult()
    data object UpToDate : UpdateCheckResult()
    data object Failed : UpdateCheckResult()
}

object AppUpdater {
    private const val REPO = "Tenkayro/StreamDash"
    private const val MANIFEST_URL =
        "https://github.com/$REPO/releases/latest/download/companion-latest.json"
    private const val RELEASES_API_URL =
        "https://api.github.com/repos/$REPO/releases/latest"
    private const val PREFS_NAME = "streamdash_companion_updater"
    private const val KEY_LAST_CHECK_MS = "last_check_ms"
    private const val CHECK_INTERVAL_MS = 6L * 60L * 60L * 1000L

    fun shouldAutoCheck(context: Context, nowMs: Long = System.currentTimeMillis()): Boolean {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val last = prefs.getLong(KEY_LAST_CHECK_MS, 0L)
        return nowMs - last >= CHECK_INTERVAL_MS
    }

    fun markChecked(context: Context, nowMs: Long = System.currentTimeMillis()) {
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putLong(KEY_LAST_CHECK_MS, nowMs)
            .apply()
    }

    /** Returns true if candidateVersion is strictly newer than currentVersion (SemVer major.minor.patch). */
    fun isNewerVersion(candidateVersion: String, currentVersion: String): Boolean {
        val c = parseSemVer(candidateVersion) ?: return false
        val cur = parseSemVer(currentVersion) ?: return false
        for (i in 0..2) {
            if (c[i] != cur[i]) return c[i] > cur[i]
        }
        return false
    }

    internal fun parseSemVer(raw: String): IntArray? {
        val cleaned = raw.trim().removePrefix("v").removePrefix("V").substringBefore("-")
        val parts = cleaned.split(".")
        if (parts.isEmpty() || parts.size > 4) return null
        val major = parts.getOrNull(0)?.toIntOrNull() ?: return null
        val minor = parts.getOrNull(1)?.toIntOrNull() ?: 0
        val patch = parts.getOrNull(2)?.toIntOrNull() ?: 0
        return intArrayOf(major, minor, patch)
    }

    internal fun parseCompanionManifest(raw: String): AppUpdateInfo? {
        val json = runCatching { JSONObject(raw) }.getOrNull() ?: return null
        val version = json.optString("version").trim().removePrefix("v")
        val url = json.optString("url").trim()
        if (version.isEmpty() || !url.startsWith("https://")) return null
        return AppUpdateInfo(version = version, downloadUrl = url)
    }

    internal fun parseGithubReleaseJson(raw: String): AppUpdateInfo? {
        val json = runCatching { JSONObject(raw) }.getOrNull() ?: return null
        val tag = json.optString("tag_name").trim().removePrefix("v")
        val assets = json.optJSONArray("assets") ?: return null
        var fallbackApkUrl = ""
        for (i in 0 until assets.length()) {
            val asset = assets.optJSONObject(i) ?: continue
            val name = asset.optString("name")
            val url = asset.optString("browser_download_url")
            if (name.endsWith(".apk", ignoreCase = true) && url.startsWith("https://")) {
                if (name.contains("android", ignoreCase = true) ||
                    name.contains("Companion", ignoreCase = true)
                ) {
                    return AppUpdateInfo(version = tag, downloadUrl = url)
                }
                if (fallbackApkUrl.isEmpty()) fallbackApkUrl = url
            }
        }
        return if (tag.isNotEmpty() && fallbackApkUrl.isNotEmpty()) {
            AppUpdateInfo(version = tag, downloadUrl = fallbackApkUrl)
        } else {
            null
        }
    }

    fun checkForUpdate(currentVersion: String = BuildConfig.VERSION_NAME): UpdateCheckResult {
        val info = fetchText(MANIFEST_URL)?.let(::parseCompanionManifest)
            ?: fetchText(RELEASES_API_URL)?.let(::parseGithubReleaseJson)
            ?: return UpdateCheckResult.Failed

        return if (isNewerVersion(info.version, currentVersion)) {
            UpdateCheckResult.UpdateAvailable(info)
        } else {
            UpdateCheckResult.UpToDate
        }
    }

    internal fun parseDevApkInfoJson(raw: String, host: String, port: Int, token: String): AppUpdateInfo? {
        val json = runCatching { JSONObject(raw) }.getOrNull() ?: return null
        if (!json.optBoolean("available", false)) return null
        val sha256 = json.optString("sha256").trim().lowercase()
        if (sha256.length < 16) return null
        return AppUpdateInfo(
            version = sha256.take(8),
            downloadUrl = "http://${host.trim()}:$port/api/dev-apk",
            authToken = token.trim().takeIf { it.isNotEmpty() },
            devSha256 = sha256
        )
    }

    fun computeInstalledApkSha256(context: Context): String? {
        val path = context.applicationInfo?.sourceDir ?: return null
        val file = File(path)
        if (!file.isFile) return null
        return runCatching {
            val md = MessageDigest.getInstance("SHA-256")
            FileInputStream(file).use { input ->
                val buf = ByteArray(16 * 1024)
                while (true) {
                    val read = input.read(buf)
                    if (read <= 0) break
                    md.update(buf, 0, read)
                }
            }
            md.digest().joinToString("") { "%02x".format(it) }
        }.getOrNull()
    }

    fun checkForDevUpdate(
        context: Context,
        host: String,
        port: Int,
        token: String
    ): UpdateCheckResult {
        val cleanHost = HostApi.resolveIpv4Host(host) ?: return UpdateCheckResult.Failed
        if (port !in 1..65535) return UpdateCheckResult.Failed
        val infoUrl = "http://$cleanHost:$port/api/dev-apk-info"
        val headers = if (token.isNotBlank()) mapOf("X-SD-Token" to token.trim()) else emptyMap()
        val raw = fetchText(infoUrl, extraHeaders = headers) ?: return UpdateCheckResult.Failed
        val remote = parseDevApkInfoJson(raw, cleanHost, port, token) ?: return UpdateCheckResult.UpToDate

        val installedSha = computeInstalledApkSha256(context)
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val lastDownloadedSha = prefs.getString("last_dev_apk_sha", null)

        return if (remote.devSha256 != installedSha && remote.devSha256 != lastDownloadedSha) {
            UpdateCheckResult.UpdateAvailable(remote)
        } else {
            UpdateCheckResult.UpToDate
        }
    }

    fun markDevShaDownloaded(context: Context, sha256: String?) {
        if (sha256.isNullOrBlank()) return
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString("last_dev_apk_sha", sha256)
            .apply()
    }

    fun downloadApk(
        context: Context,
        downloadUrl: String,
        authToken: String? = null,
        onProgress: (percent: Int) -> Unit
    ): File {
        val updatesDir = File(context.cacheDir, "updates").apply { mkdirs() }
        // Keep cache clean from prior downloads
        updatesDir.listFiles()?.forEach { runCatching { it.delete() } }
        val targetFile = File(updatesDir, "StreamDash-Companion-update.apk")

        var url = URL(downloadUrl)
        var redirects = 0
        var conn: HttpURLConnection? = null

        try {
            while (true) {
                conn = (url.openConnection() as HttpURLConnection).apply {
                    connectTimeout = 10000
                    readTimeout = 20000
                    instanceFollowRedirects = false
                    setRequestProperty("User-Agent", "StreamDashCompanion/${BuildConfig.VERSION_NAME}")
                    if (!authToken.isNullOrBlank()) {
                        setRequestProperty("X-SD-Token", authToken)
                    }
                }
                val code = conn.responseCode
                if (code in 301..308 && redirects < 6) {
                    val location = conn.getHeaderField("Location")
                        ?: throw IllegalStateException("Redirect missing Location")
                    conn.disconnect()
                    url = URL(url, location)
                    redirects++
                    continue
                }
                if (code !in 200..299) {
                    throw IllegalStateException("Download failed (HTTP $code)")
                }
                val totalBytes = conn.contentLengthLong
                var downloaded = 0L
                val buffer = ByteArray(16 * 1024)
                conn.inputStream.use { input ->
                    FileOutputStream(targetFile).use { output ->
                        while (true) {
                            val read = input.read(buffer)
                            if (read <= 0) break
                            output.write(buffer, 0, read)
                            downloaded += read
                            if (totalBytes > 0) {
                                val pct = ((downloaded * 100L) / totalBytes).toInt().coerceIn(0, 100)
                                onProgress(pct)
                            }
                        }
                    }
                }
                return targetFile
            }
        } finally {
            conn?.disconnect()
        }
    }

    fun canInstallPackages(context: Context): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.packageManager.canRequestPackageInstalls()
        } else {
            true
        }
    }

    fun createUnknownSourcesSettingsIntent(context: Context): Intent {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Intent(
                Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:${context.packageName}")
            )
        } else {
            Intent(Settings.ACTION_SECURITY_SETTINGS)
        }
    }

    fun createInstallApkIntent(context: Context, apkFile: File): Intent {
        val uri = FileProvider.getUriForFile(
            context,
            "${BuildConfig.APPLICATION_ID}.fileprovider",
            apkFile
        )
        return Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, "application/vnd.android.package-archive")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
    }

    private fun fetchText(
        urlString: String,
        extraHeaders: Map<String, String> = emptyMap()
    ): String? {
        var conn: HttpURLConnection? = null
        return try {
            conn = (URL(urlString).openConnection() as HttpURLConnection).apply {
                connectTimeout = 5000
                readTimeout = 5000
                instanceFollowRedirects = true
                setRequestProperty("Accept", "application/json")
                setRequestProperty("User-Agent", "StreamDashCompanion/${BuildConfig.VERSION_NAME}")
                for ((k, v) in extraHeaders) {
                    setRequestProperty(k, v)
                }
            }
            if (conn.responseCode != 200) return null
            conn.inputStream.bufferedReader().use(BufferedReader::readText)
        } catch (_: Exception) {
            null
        } finally {
            conn?.disconnect()
        }
    }
}
