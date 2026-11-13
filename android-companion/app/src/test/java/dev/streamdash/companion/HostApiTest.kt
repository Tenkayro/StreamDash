package dev.streamdash.companion

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
}
