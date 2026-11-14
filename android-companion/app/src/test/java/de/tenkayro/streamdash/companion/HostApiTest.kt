package de.tenkayro.streamdash.companion

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class HostApiTest {

    @Test
    fun parseQrUrl_parsesHostPortAndToken() {
        val parsed = HostApi.parseQrUrl("http://192.168.178.42:48950/?token=A1B2C3D4")
        assertNotNull(parsed)
        assertEquals("192.168.178.42", parsed?.host)
        assertEquals(48950, parsed?.port)
        assertEquals("A1B2C3D4", parsed?.token)
    }

    @Test
    fun parseQrUrl_rejectsNonHttpUrls() {
        assertNull(HostApi.parseQrUrl("ftp://192.168.1.5:21"))
        assertNull(HostApi.parseQrUrl("not a url"))
    }

    @Test
    fun buildDashboardUrl_encodesTokenOrOmitsWhenEmpty() {
        assertEquals(
            "http://192.168.1.10:48950/?token=abc123",
            HostApi.buildDashboardUrl("192.168.1.10", 48950, "abc123")
        )
        assertEquals(
            "http://192.168.1.10:48950/",
            HostApi.buildDashboardUrl("192.168.1.10", 48950, "")
        )
    }

    @Test
    fun parseDiscoveryResponse_extractsFields() {
        val raw = """
            {
              "service": "streamdash-host",
              "version": "2.4.1",
              "hostName": "STREAM-PC",
              "port": 48950,
              "ips": ["192.168.1.55"],
              "authRequired": true
            }
        """.trimIndent()
        val parsed = LanDiscovery.parseDiscoveryResponse(raw, "192.168.1.55")
        assertNotNull(parsed)
        assertEquals("STREAM-PC", parsed?.hostName)
        assertEquals("192.168.1.55", parsed?.ip)
        assertEquals(48950, parsed?.port)
        assertEquals(true, parsed?.authRequired)
    }

    @Test
    fun parseHealthJson_validatesStreamDashIdentity() {
        val valid = """{"ok":true,"service":"streamdash-host","authRequired":false,"hostName":"GAMING-PC","version":"2.4.1"}"""
        val info = HostApi.parseHealthJson(valid, "192.168.178.20")
        assertNotNull(info)
        assertEquals("GAMING-PC", info?.hostName)
        assertEquals(false, info?.authRequired)
        assertEquals("2.4.1", info?.version)

        val unrelatedService = """{"ok":true,"status":"healthy"}"""
        assertNull(HostApi.parseHealthJson(unrelatedService, "192.168.178.99"))
    }

    @Test
    fun lanDiscovery_subnetHelpersComputeCorrectly() {
        assertEquals("192.168.178.255", LanDiscovery.subnetBroadcast("192.168.178.42", 24))
        assertEquals("10.0.255.255", LanDiscovery.subnetBroadcast("10.0.12.5", 16))
        assertEquals(true, LanDiscovery.isPrivateLanIpv4("192.168.1.50"))
        assertEquals(true, LanDiscovery.isPrivateLanIpv4("172.20.10.2"))
        assertEquals(false, LanDiscovery.isPrivateLanIpv4("8.8.8.8"))

        val ips = LanDiscovery.enumerateSubnetIps("192.168.178.42", 24)
        assertEquals(253, ips.size)
        assertEquals(false, ips.contains("192.168.178.42"))
        assertEquals(true, ips.contains("192.168.178.100"))
    }

    @Test
    fun companionSettings_roundTripAndNormalization() {
        val original = CompanionSettings(
            language = "pt-BR",
            keepScreenOn = false,
            autoReconnect = false,
            notificationsEnabled = true,
            notifyFollows = false,
            notifySubs = true,
            notifyRaids = true,
            notifyCheers = false,
            notifyDonations = true,
            notifyChannelPoints = true,
            notifyStreamStatus = false,
            notifyChatMentions = true,
            hapticsEnabled = true,
            hapticStrength = "subtle"
        )
        val parsed = CompanionSettings.fromJson(original.toJson())
        assertEquals(original, parsed)

        val invalid = CompanionSettings(language = "xx-INVALID", hapticStrength = "extreme").normalized()
        assertEquals("system", invalid.language)
        assertEquals("strong", invalid.hapticStrength)
    }

    @Test
    fun companionNotifier_filtersAndHapticPatterns() {
        val settings = CompanionSettings(
            notificationsEnabled = true,
            notifyFollows = true,
            notifyChannelPoints = false,
            notifyRaids = true
        )
        assertEquals(true, CompanionNotifier.shouldNotifyEvent(settings, "follow"))
        assertEquals(false, CompanionNotifier.shouldNotifyEvent(settings, "channel_point"))
        assertEquals(true, CompanionNotifier.shouldNotifyEvent(settings, "raid"))

        val muted = settings.copy(notificationsEnabled = false)
        assertEquals(false, CompanionNotifier.shouldNotifyEvent(muted, "follow"))
        assertEquals(false, CompanionNotifier.shouldNotifyEvent(muted, "raid"))

        assertEquals(
            CompanionNotifier.HapticPattern.CELEBRATE,
            CompanionNotifier.hapticPatternForEvent("raid")
        )
        assertEquals(
            CompanionNotifier.HapticPattern.DOUBLE_PULSE,
            CompanionNotifier.hapticPatternForEvent("cheer")
        )
        assertEquals(
            CompanionNotifier.HapticPattern.DISCONNECT,
            CompanionNotifier.hapticPatternForEvent("stream_offline")
        )
    }

    @Test
    fun isHostDashboardUrl_allowsOnlyActiveHostAndBlocksExternalOrUntrustedSchemes() {
        assertEquals(
            true,
            HostApi.isHostDashboardUrl("http://192.168.178.42:48950/?token=abc", "192.168.178.42", 48950)
        )
        assertEquals(
            true,
            HostApi.isHostDashboardUrl("http://192.168.178.42:48950/chat", "192.168.178.42", 48950)
        )
        assertEquals(
            false,
            HostApi.isHostDashboardUrl("https://twitch.tv/stream", "192.168.178.42", 48950)
        )
        assertEquals(
            false,
            HostApi.isHostDashboardUrl("file:///etc/passwd", "192.168.178.42", 48950)
        )
        assertEquals(
            false,
            HostApi.isHostDashboardUrl("intent://scan/#Intent;end", "192.168.178.42", 48950)
        )
    }
}
