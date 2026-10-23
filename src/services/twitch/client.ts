import type { ActivityEvent, DashboardStats, TwitchSession } from '../../types'
import { twitchNative } from '../native'
import { normalizeTwitch } from './events'

export const TWITCH_SCOPES = ['moderator:read:followers', 'channel:read:subscriptions', 'bits:read', 'channel:read:redemptions', 'channel:manage:broadcast']
type EventSubEnvelope = { metadata: { message_id: string; message_type: string; message_timestamp: string }; payload: { session?: { id: string; keepalive_timeout_seconds?: number; reconnect_url?: string }; subscription?: { type: string }; event?: Record<string, unknown> } }

export async function loadTwitchSnapshot(clientId: string, session: TwitchSession): Promise<Partial<DashboardStats>> {
  const [followers, subscriptions, stream, channel] = await Promise.all([
    twitchNative.helix<{ total: number }>(clientId, 'channels/followers', [['broadcaster_id', session.userId], ['moderator_id', session.userId]]),
    twitchNative.helix<{ total: number }>(clientId, 'subscriptions', [['broadcaster_id', session.userId]]),
    twitchNative.helix<{ data: Array<{ viewer_count: number; started_at: string; title: string; game_name: string }> }>(clientId, 'streams', [['user_id', session.userId]]),
    twitchNative.helix<{ data: Array<{ title: string; game_name: string }> }>(clientId, 'channels', [['broadcaster_id', session.userId]]),
  ])
  const live = stream.data[0]
  return { followers: followers.total, subscribers: subscriptions.total, viewers: live?.viewer_count ?? 0, live: !!live,
    startedAt: live?.started_at, title: live?.title ?? channel.data[0]?.title, category: live?.game_name ?? channel.data[0]?.game_name }
}

const subscriptions = (userId: string) => [
  ['channel.follow', '2', { broadcaster_user_id: userId, moderator_user_id: userId }],
  ['channel.subscribe', '1', { broadcaster_user_id: userId }],
  ['channel.subscription.message', '1', { broadcaster_user_id: userId }],
  ['channel.subscription.gift', '1', { broadcaster_user_id: userId }],
  ['channel.cheer', '1', { broadcaster_user_id: userId }],
  ['channel.raid', '1', { to_broadcaster_user_id: userId }],
  ['channel.channel_points_custom_reward_redemption.add', '1', { broadcaster_user_id: userId }],
  ['stream.online', '1', { broadcaster_user_id: userId }],
  ['stream.offline', '1', { broadcaster_user_id: userId }],
] as const

export class TwitchEventSub {
  private socket?: WebSocket
  private stopped = false
  private retry = 0
  private watchdog?: number
  private session: TwitchSession
  private clientId: string
  private onEvent: (event: ActivityEvent) => void
  private onState: (state: 'connected'|'reconnecting'|'error', detail?: string) => void
  constructor(clientId: string, session: TwitchSession, onEvent: (event: ActivityEvent) => void, onState: (state: 'connected'|'reconnecting'|'error', detail?: string) => void) { this.clientId = clientId; this.session = session; this.onEvent = onEvent; this.onState = onState }
  start() { this.stopped = false; this.open('wss://eventsub.wss.twitch.tv/ws?keepalive_timeout_seconds=30') }
  stop() { this.stopped = true; window.clearTimeout(this.watchdog); this.socket?.close(); this.socket = undefined }
  private open(url: string, replacement = false) {
    const old = this.socket
    const ws = new WebSocket(url)
    this.socket = ws
    ws.onmessage = async ({ data }) => {
      let msg: EventSubEnvelope
      try { msg = JSON.parse(String(data)) } catch { return }
      this.armWatchdog(msg.payload.session?.keepalive_timeout_seconds ?? 30)
      if (msg.metadata.message_type === 'session_welcome' && msg.payload.session) {
        this.retry = 0; this.onState('connected'); if (replacement) old?.close()
        if (!replacement) {
          try { for (const [type, version, condition] of subscriptions(this.session.userId)) await twitchNative.subscribe(this.clientId, { type, version, condition, transport: { method: 'websocket', session_id: msg.payload.session.id } }) }
          catch (error) { this.onState('error', String(error)); ws.close() }
        }
      } else if (msg.metadata.message_type === 'session_notification' && msg.payload.subscription && msg.payload.event) {
        const event = normalizeTwitch(msg.metadata.message_id, msg.payload.subscription.type, msg.payload.event, msg.metadata.message_timestamp)
        if (event) this.onEvent(event)
      } else if (msg.metadata.message_type === 'session_reconnect' && msg.payload.session?.reconnect_url) {
        this.onState('reconnecting'); this.open(msg.payload.session.reconnect_url, true)
      } else if (msg.metadata.message_type === 'revocation') this.onState('error', 'Twitch revoked an event subscription')
    }
    ws.onerror = () => this.onState('error', 'EventSub connection failed')
    ws.onclose = () => { if (!this.stopped && this.socket === ws) this.retryLater() }
  }
  private armWatchdog(seconds: number) { window.clearTimeout(this.watchdog); this.watchdog = window.setTimeout(() => { this.socket?.close() }, (seconds + 10) * 1000) }
  private retryLater() { this.onState('reconnecting'); const wait = Math.min(30_000, 1000 * 2 ** this.retry++) + Math.random() * 500; window.setTimeout(() => { if (!this.stopped) this.open('wss://eventsub.wss.twitch.tv/ws?keepalive_timeout_seconds=30') }, wait) }
}
