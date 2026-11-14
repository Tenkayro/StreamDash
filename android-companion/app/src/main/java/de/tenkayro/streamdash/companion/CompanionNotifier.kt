package de.tenkayro.streamdash.companion

import android.Manifest
import android.annotation.SuppressLint
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.view.HapticFeedbackConstants
import android.view.View
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import org.json.JSONObject
import java.text.NumberFormat
import java.util.Currency
import java.util.concurrent.atomic.AtomicInteger

object CompanionNotifier {
    const val CHANNEL_ALERTS = "sd_alerts_high"
    const val CHANNEL_ACTIVITY = "sd_activity_default"

    enum class HapticPattern {
        TAP,
        SOFT_PULSE,
        DOUBLE_PULSE,
        CELEBRATE,
        DISCONNECT
    }

    private const val MAX_SEEN_IDS = 250
    private val seenEventIds = LinkedHashSet<String>()
    private val notifCounter = AtomicInteger(2000)

    fun createChannels(context: Context) {
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return
        val alerts = NotificationChannel(
            CHANNEL_ALERTS,
            context.getString(R.string.notif_channel_alerts_name),
            NotificationManager.IMPORTANCE_HIGH
        ).apply {
            description = context.getString(R.string.notif_channel_alerts_desc)
            enableVibration(false) // Handled explicitly with scaled companion haptics
        }
        val activity = NotificationChannel(
            CHANNEL_ACTIVITY,
            context.getString(R.string.notif_channel_activity_name),
            NotificationManager.IMPORTANCE_DEFAULT
        ).apply {
            description = context.getString(R.string.notif_channel_activity_desc)
            enableVibration(false)
        }
        nm.createNotificationChannel(alerts)
        nm.createNotificationChannel(activity)
    }

    fun hasNotificationPermission(context: Context): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return true
        return ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.POST_NOTIFICATIONS
        ) == PackageManager.PERMISSION_GRANTED
    }

    fun triggerUiHaptic(view: View?, settings: CompanionSettings) {
        if (view == null || !settings.hapticsEnabled || settings.hapticStrength == "off") return
        val flag = if (settings.hapticStrength == "subtle") {
            HapticFeedbackConstants.CLOCK_TICK
        } else {
            HapticFeedbackConstants.KEYBOARD_TAP
        }
        view.performHapticFeedback(flag)
    }

    fun triggerVibration(context: Context, settings: CompanionSettings, pattern: HapticPattern) {
        if (!settings.hapticsEnabled || settings.hapticStrength == "off") return
        val vibrator = resolveVibrator(context) ?: return
        if (!vibrator.hasVibrator()) return

        val subtle = settings.hapticStrength == "subtle"
        val amp = if (subtle) 90 else 210
        val ampStrong = if (subtle) 125 else 255

        runCatching {
            val effect = when (pattern) {
                HapticPattern.TAP -> VibrationEffect.createOneShot(
                    if (subtle) 18L else 28L,
                    amp
                )
                HapticPattern.SOFT_PULSE -> VibrationEffect.createOneShot(
                    if (subtle) 28L else 45L,
                    amp
                )
                HapticPattern.DOUBLE_PULSE -> VibrationEffect.createWaveform(
                    longArrayOf(0L, 40L, 65L, 60L),
                    intArrayOf(0, amp, 0, ampStrong),
                    -1
                )
                HapticPattern.CELEBRATE -> VibrationEffect.createWaveform(
                    longArrayOf(0L, 45L, 55L, 75L, 55L, 105L),
                    intArrayOf(0, amp, 0, ampStrong, 0, ampStrong),
                    -1
                )
                HapticPattern.DISCONNECT -> VibrationEffect.createWaveform(
                    longArrayOf(0L, 35L, 110L, 35L),
                    intArrayOf(0, amp, 0, amp),
                    -1
                )
            }
            vibrator.vibrate(effect)
        }
    }

    @Suppress("DEPRECATION")
    private fun resolveVibrator(context: Context): Vibrator? {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val vm = context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager
            vm?.defaultVibrator
        } else {
            context.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
        }
    }

    internal fun shouldNotifyEvent(settings: CompanionSettings, eventType: String): Boolean {
        if (!settings.notificationsEnabled) return false
        return when (eventType) {
            "follow" -> settings.notifyFollows
            "subscription", "resubscription", "gift_subscription", "community_gift" -> settings.notifySubs
            "raid" -> settings.notifyRaids
            "cheer" -> settings.notifyCheers
            "donation" -> settings.notifyDonations
            "channel_point" -> settings.notifyChannelPoints
            "stream_online", "stream_offline" -> settings.notifyStreamStatus
            "chat_mention" -> settings.notifyChatMentions
            else -> false
        }
    }

    internal fun hapticPatternForEvent(eventType: String): HapticPattern = when (eventType) {
        "raid", "donation", "stream_online" -> HapticPattern.CELEBRATE
        "subscription", "resubscription", "gift_subscription", "community_gift", "cheer" -> HapticPattern.DOUBLE_PULSE
        "stream_offline" -> HapticPattern.DISCONNECT
        else -> HapticPattern.SOFT_PULSE
    }

    internal fun isHighPriorityEvent(eventType: String): Boolean = when (eventType) {
        "raid", "donation", "subscription", "resubscription", "gift_subscription", "community_gift", "cheer", "stream_online", "stream_offline" -> true
        else -> false
    }

    fun handleIncomingEvent(
        context: Context,
        settings: CompanionSettings,
        rawJson: String,
        onSettingsUpdated: ((CompanionSettings) -> Unit)? = null
    ) {
        val json = runCatching { JSONObject(rawJson) }.getOrNull() ?: return
        val kind = json.optString("kind").trim()
        if (kind == "settings") {
            val compJson = json.optJSONObject("companion") ?: return
            onSettingsUpdated?.invoke(CompanionSettings.fromJson(compJson, settings))
            return
        }

        val eventType = json.optString("eventType").trim()
        if (eventType.isEmpty()) return

        val eventId = json.optString("id").trim()
        if (eventId.isNotEmpty() && !markSeen(eventId)) return

        if (!shouldNotifyEvent(settings, eventType)) return

        triggerVibration(context, settings, hapticPatternForEvent(eventType))

        val (title, body) = buildNotificationCopy(context, eventType, json)
        val channelId = if (isHighPriorityEvent(eventType)) CHANNEL_ALERTS else CHANNEL_ACTIVITY
        postNotification(context, channelId, title, body, notifCounter.incrementAndGet())
    }

    fun sendTestNotification(context: Context, settings: CompanionSettings) {
        createChannels(context)
        triggerVibration(context, settings, HapticPattern.CELEBRATE)
        postNotification(
            context,
            CHANNEL_ALERTS,
            context.getString(R.string.notif_test_title),
            context.getString(R.string.notif_test_body),
            1001
        )
    }

    private fun markSeen(id: String): Boolean {
        synchronized(seenEventIds) {
            if (seenEventIds.contains(id)) return false
            seenEventIds.add(id)
            while (seenEventIds.size > MAX_SEEN_IDS) {
                val first = seenEventIds.iterator().next()
                seenEventIds.remove(first)
            }
            return true
        }
    }

    private fun buildNotificationCopy(
        context: Context,
        eventType: String,
        json: JSONObject
    ): Pair<String, String> {
        val actor = json.optString("displayName").trim()
            .ifEmpty { context.getString(R.string.notif_someone) }
        val message = json.optString("message").trim()

        val title = when (eventType) {
            "follow" -> context.getString(R.string.notif_title_follow)
            "subscription", "resubscription" -> context.getString(R.string.notif_title_sub)
            "gift_subscription", "community_gift" -> {
                val gifts = json.optInt("giftCount", 1).coerceAtLeast(1)
                if (gifts > 1) {
                    context.getString(R.string.notif_title_gift_subs, gifts)
                } else {
                    context.getString(R.string.notif_title_gift_sub)
                }
            }
            "raid" -> {
                val viewers = json.optInt("viewerCount", 0).coerceAtLeast(0)
                if (viewers > 0) {
                    context.getString(R.string.notif_title_raid_viewers, viewers)
                } else {
                    context.getString(R.string.notif_title_raid)
                }
            }
            "cheer" -> {
                val bits = json.optInt("bits", 0).coerceAtLeast(0)
                if (bits > 0) {
                    context.getString(R.string.notif_title_cheer_bits, bits)
                } else {
                    context.getString(R.string.notif_title_cheer)
                }
            }
            "donation" -> {
                val amount = json.optDouble("amount", 0.0)
                val currency = json.optString("currency").trim()
                if (amount > 0.0) {
                    context.getString(
                        R.string.notif_title_donation_amount,
                        formatMoney(amount, currency)
                    )
                } else {
                    context.getString(R.string.notif_title_donation)
                }
            }
            "channel_point" -> context.getString(R.string.notif_title_channel_point)
            "stream_online" -> context.getString(R.string.notif_title_stream_online)
            "stream_offline" -> context.getString(R.string.notif_title_stream_offline)
            "chat_mention" -> context.getString(R.string.notif_title_chat_mention, actor)
            else -> context.getString(R.string.app_name)
        }

        val body = when (eventType) {
            "chat_mention" -> message
            "stream_online" -> context.getString(R.string.notif_body_stream_online)
            "stream_offline" -> context.getString(R.string.notif_body_stream_offline)
            else -> if (message.isNotEmpty()) "$actor — $message" else actor
        }
        return title to body
    }

    private fun formatMoney(amount: Double, currencyCode: String): String {
        val code = currencyCode.uppercase().ifEmpty { "EUR" }
        return runCatching {
            val fmt = NumberFormat.getCurrencyInstance().apply {
                currency = Currency.getInstance(code)
            }
            fmt.format(amount)
        }.getOrElse {
            String.format("%.2f %s", amount, code)
        }
    }

    @SuppressLint("MissingPermission")
    private fun postNotification(
        context: Context,
        channelId: String,
        title: String,
        body: String,
        id: Int
    ) {
        if (!hasNotificationPermission(context)) return
        createChannels(context)

        val openIntent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val pendingIntent = PendingIntent.getActivity(
            context,
            0,
            openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notification = NotificationCompat.Builder(context, channelId)
            .setSmallIcon(R.drawable.ic_notification)
            .setColor(ContextCompat.getColor(context, R.color.accent_violet))
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setAutoCancel(true)
            .setContentIntent(pendingIntent)
            .build()

        runCatching {
            NotificationManagerCompat.from(context).notify(id, notification)
        }
    }
}
