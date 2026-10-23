import type { ActivityEvent, ActivityType } from '../../types'

type Json = Record<string, unknown>
export class StreamElementsClient {
  private socket?: WebSocket; private stopped = false; private retry = 0; private reconnectToken?: string
  private token: string
  private onEvent: (event: ActivityEvent) => void
  private onState: (state: 'connected'|'reconnecting'|'error', detail?: string) => void
  constructor(token: string, onEvent: (event: ActivityEvent) => void, onState: (state: 'connected'|'reconnecting'|'error', detail?: string) => void) { this.token = token; this.onEvent = onEvent; this.onState = onState }
  start() { this.stopped = false; this.open() }
  stop() { this.stopped = true; this.socket?.close(); this.socket = undefined }
  private open() {
    const old = this.socket
    const suffix = this.reconnectToken ? `?reconnect_token=${encodeURIComponent(this.reconnectToken)}` : ''
    const ws = new WebSocket(`wss://astro.streamelements.com/${suffix}`); this.socket = ws
    ws.onmessage = ({ data }) => {
      let msg: Json; try { msg = JSON.parse(String(data)) } catch { return }
      if (msg.type === 'welcome') {
        this.retry = 0; this.onState('connected'); if (old && old !== ws) old.close()
        if (!this.reconnectToken) for (const topic of ['channel.activities', 'channel.tips']) ws.send(JSON.stringify({ type: 'subscribe', nonce: crypto.randomUUID(), data: { topic, token: this.token, token_type: 'jwt' } }))
        this.reconnectToken = undefined
      } else if (msg.type === 'response' && msg.error) this.onState('error', String((msg.data as Json)?.message ?? msg.error))
      else if (msg.type === 'reconnect') { this.reconnectToken = String((msg.data as Json).reconnect_token); this.onState('reconnecting'); this.open() }
      else if (msg.type === 'message') { const event = normalizeStreamElements(msg); if (event) this.onEvent(event) }
    }
    ws.onerror = () => this.onState('error', 'StreamElements realtime connection failed')
    ws.onclose = () => { if (!this.stopped && this.socket === ws) this.retryLater() }
  }
  private retryLater() { this.onState('reconnecting'); this.reconnectToken = undefined; const wait = Math.min(30_000, 1000 * 2 ** this.retry++) + Math.random() * 500; window.setTimeout(() => { if (!this.stopped) this.open() }, wait) }
}

function normalizeStreamElements(msg: Json): ActivityEvent | null {
  const payload = msg.data as Json; const topic = String(msg.topic || '')
  if (topic === 'channel.tips') {
    const donation = payload.donation as Json; const user = donation?.user as Json
    if (!donation || payload.status !== 'success') return null
    return { id: `se:${payload._id ?? msg.id}`, source: 'streamelements', eventType: 'donation', username: String(user?.username ?? 'Anonymous'), displayName: String(user?.username ?? 'Anonymous'), timestamp: String(payload.createdAt ?? msg.ts), amount: Number(donation.amount), currency: String(donation.currency), message: String(donation.message ?? ''), metadata: { provider: payload.provider } }
  }
  if (topic !== 'channel.activities') return null
  const details = payload.data as Json; const types: Record<string, ActivityType> = { follow: 'follow', follower: 'follow', tip: 'donation', subscriber: 'subscription', cheer: 'cheer', raid: 'raid', communityGiftPurchase: 'community_gift', channelPointsRedemption: 'channel_point' }
  const eventType = types[String(payload.type)]; if (!eventType || eventType === 'donation') return null // channel.tips is authoritative for donations
  return { id: `se:${payload._id ?? msg.id}`, source: 'streamelements', eventType, username: String(details?.username ?? ''), displayName: String(details?.displayName ?? details?.username ?? ''), timestamp: String(payload.createdAt ?? msg.ts), bits: typeof details?.amount === 'number' && eventType === 'cheer' ? details.amount : undefined, viewerCount: typeof details?.amount === 'number' && eventType === 'raid' ? details.amount : undefined, giftCount: typeof details?.amount === 'number' && eventType === 'community_gift' ? details.amount : undefined, message: typeof details?.message === 'string' ? details.message : undefined, metadata: { provider: payload.provider } }
}
