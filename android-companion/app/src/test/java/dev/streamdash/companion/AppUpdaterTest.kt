package dev.streamdash.companion

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AppUpdaterTest {

    @Test
    fun isNewerVersion_handlesSemVerAndDebugSuffix() {
        assertTrue(AppUpdater.isNewerVersion("2.4.2", "1.0.0-debug"))
        assertTrue(AppUpdater.isNewerVersion("v2.5.0", "2.4.9"))
        assertFalse(AppUpdater.isNewerVersion("2.4.1", "2.4.1"))
        assertFalse(AppUpdater.isNewerVersion("2.4.0", "2.4.1"))
    }

    @Test
    fun parseCompanionManifest_parsesValidHttpsEntry() {
        val json = """
            {"version":"2.4.2","tag":"v2.4.2","url":"https://github.com/Tenkayro/StreamDash/releases/download/v2.4.2/StreamDash-Companion-v2.4.2.apk"}
        """.trimIndent()
        val parsed = AppUpdater.parseCompanionManifest(json)
        assertNotNull(parsed)
        assertEquals("2.4.2", parsed?.version)
        assertEquals(
            "https://github.com/Tenkayro/StreamDash/releases/download/v2.4.2/StreamDash-Companion-v2.4.2.apk",
            parsed?.downloadUrl
        )
    }

    @Test
    fun parseGithubReleaseJson_findsCompanionApkAsset() {
        val json = """
            {
              "tag_name": "v2.4.3",
              "assets": [
                {
                  "name": "StreamDash_2.4.3_x64-setup.exe",
                  "browser_download_url": "https://github.com/Tenkayro/StreamDash/releases/download/v2.4.3/StreamDash_2.4.3_x64-setup.exe"
                },
                {
                  "name": "StreamDash-Companion-v2.4.3.apk",
                  "browser_download_url": "https://github.com/Tenkayro/StreamDash/releases/download/v2.4.3/StreamDash-Companion-v2.4.3.apk"
                }
              ]
            }
        """.trimIndent()
        val parsed = AppUpdater.parseGithubReleaseJson(json)
        assertNotNull(parsed)
        assertEquals("2.4.3", parsed?.version)
        assertEquals(
            "https://github.com/Tenkayro/StreamDash/releases/download/v2.4.3/StreamDash-Companion-v2.4.3.apk",
            parsed?.downloadUrl
        )
    }
}
