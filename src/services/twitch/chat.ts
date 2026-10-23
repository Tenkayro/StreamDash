import type { ChatMessage, ChatPart, ConnectionPhase } from '../../types'

const IRC_URL = 'wss://irc-ws.chat.twitch.tv:443'
const TV_BASE = 'https://7tv.io/v3'
const TWITCH_EMOTE = (id: string) => `https://static-cdn.jtvnw.net/emoticons/v2/${id}/default/dark/2.0`
const USER_COLORS = ['#ff7f7f', '#ffbf7f', '#ffdf7f', '#ffff7f', '#bfff7f', '#7fff7f', '#7fffbf', '#7fffff', '#7fbfff', '#7f7fff', '#bf7fff', '#ff7fff', '#ff7fbf']

export interface ChatEmote { name: string; url: string; zeroWidth: boolean }
export type ChatEmoteMap = Map<string, ChatEmote>

interface SevenTvFile { name: string; format: string; width: number }
interface SevenTvActiveEmote {
  name: string
  flags: number
  data?: { flags?: number; listed?: boolean; host?: { url?: string; files?: SevenTvFile[] } }
}

function selectEmoteFile(files: SevenTvFile[]) {
  return files.find((file) => file.format === 'WEBP' && file.width >= 64) ?? files.find((file) => file.format === 'WEBP') ?? files[0]
}

async function fetchEmoteSet(url: string, kind: 'set' | 'user'): Promise<ChatEmote[]> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`7TV request failed with ${response.status}`)
  const payload = await response.json() as { emotes?: SevenTvActiveEmote[]; emote_set?: { emotes?: SevenTvActiveEmote[] } }
  const emotes = kind === 'set' ? payload.emotes : payload.emote_set?.emotes
  return (emotes ?? []).flatMap((active) => {
    const data = active.data
    const host = data?.host
    if (!host?.url || data?.listed === false || ((data?.flags ?? 0) & (1 << 24))) return []
    const file = selectEmoteFile(host.files ?? [])
    if (!file) return []
    return [{ name: active.name, url: `https:${host.url}/${file.name}`, zeroWidth: (active.flags & 1) === 1 }]
  })
}

export async function loadSevenTvEmotes(channelId?: string): Promise<ChatEmoteMap> {
  const [global, channel] = await Promise.allSettled([
    fetchEmoteSet(`${TV_BASE}/emote-sets/global`, 'set'),
    channelId ? fetchEmoteSet(`${TV_BASE}/users/twitch/${channelId}`, 'user') : Promise.resolve<ChatEmote[]>([]),
  ])
  const map: ChatEmoteMap = new Map()
  for (const emote of global.status === 'fulfilled' ? global.value : []) map.set(emote.name, emote)
  for (const emote of channel.status === 'fulfilled' ? channel.value : []) map.set(emote.name, emote)
  return map
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer = 0
  const timeout = new Promise<T>((_, reject) => { timer = window.setTimeout(() => reject(new Error('7TV request timed out')), ms) })
  return Promise.race([promise, timeout]).finally(() => window.clearTimeout(timer))
}

interface IrcLine { tags: Record<string, string>; prefix?: string; command: string; params: string[] }

const TAG_ESCAPES: Record<string, string> = { ':': ';', '\\': '\\', s: ' ', r: '\r', n: '\n' }

function unescapeTag(value: string) {
  return value.replace(/\\([:\\srn])/g, (_, escape: string) => TAG_ESCAPES[escape] ?? escape)
}

function parseIrcLine(raw: string): IrcLine | undefined {
  let rest = raw
  const tags: Record<string, string> = {}
  if (rest.startsWith('@')) {
    const end = rest.indexOf(' ')
    if (end === -1) return undefined
    for (const entry of rest.slice(1, end).split(';')) {
      const separator = entry.indexOf('=')
      if (separator === -1) tags[entry] = ''
      else tags[entry.slice(0, separator)] = unescapeTag(entry.slice(separator + 1))
    }
    rest = rest.slice(end + 1)
  }
  let prefix: string | undefined
  if (rest.startsWith(':')) {
    const end = rest.indexOf(' ')
    if (end === -1) return undefined
    prefix = rest.slice(1, end)
    rest = rest.slice(end + 1)
  }
  const trailing = rest.indexOf(' :')
  const head = (trailing === -1 ? rest : rest.slice(0, trailing)).split(' ')
  const command = head[0]
  if (!command) return undefined
  const params = trailing === -1 ? head.slice(1) : [...head.slice(1), rest.slice(trailing + 2)]
  return { tags, prefix, command, params }
}

function parseNativeEmotes(value: string | undefined) {
  if (!value) return []
  const ranges: Array<{ id: string; start: number; end: number }> = []
  for (const group of value.split('/')) {
    const separator = group.indexOf(':')
    if (separator === -1) continue
    const id = group.slice(0, separator)
    for (const range of group.slice(separator + 1).split(',')) {
      const [start, end] = range.split('-').map(Number)
      if (Number.isInteger(start) && Number.isInteger(end)) ranges.push({ id, start, end })
    }
  }
  return ranges.sort((a, b) => a.start - b.start)
}

function pushText(parts: ChatPart[], value: string, emotes: ChatEmoteMap) {
  for (const token of value.split(/(\s+)/)) {
    if (!token) continue
    const emote = /^\s+$/.test(token) ? undefined : emotes.get(token)
    if (!emote) {
      const previous = parts[parts.length - 1]
      if (previous?.type === 'text') previous.text += token
      else parts.push({ type: 'text', text: token })
      continue
    }
    const previous = parts[parts.length - 1]
    if (emote.zeroWidth && previous?.type === 'emote') { previous.layers.push({ name: token, url: emote.url }); continue }
    parts.push({ type: 'emote', layers: [{ name: token, url: emote.url }] })
  }
}

export function buildChatParts(text: string, nativeEmotes: string | undefined, emotes: ChatEmoteMap): ChatPart[] {
  const parts: ChatPart[] = []
  let cursor = 0
  for (const range of parseNativeEmotes(nativeEmotes)) {
    if (range.end < range.start || range.start < cursor) continue
    if (range.start > cursor) pushText(parts, text.slice(cursor, range.start), emotes)
    parts.push({ type: 'emote', layers: [{ name: text.slice(range.start, range.end + 1), url: TWITCH_EMOTE(range.id) }] })
    cursor = range.end + 1
  }
  if (cursor < text.length) pushText(parts, text.slice(cursor), emotes)
  return parts
}

function colorFor(login: string) {
  let hash = 0
  for (let index = 0; index < login.length; index++) hash = (hash * 31 + login.charCodeAt(index)) >>> 0
  return USER_COLORS[hash % USER_COLORS.length]
}

function parseBadges(value: string | undefined) {
  return (value ?? '').split(',').filter(Boolean).flatMap((entry) => {
    const [id, version] = entry.split('/')
    return id && version ? [{ id, version }] : []
  })
}

export class TwitchChatClient {
  private socket?: WebSocket
  private stopped = false
  private retry = 0
  private timer?: number
  private emotes: ChatEmoteMap = new Map()
  private login: string
  private channelId?: string
  private onMessage: (message: ChatMessage) => void
  private onPhase: (phase: ConnectionPhase, detail?: string) => void
  private onDelete: (id: string) => void
  private onClear: (login?: string) => void

  constructor(
    login: string, channelId: string | undefined,
    onMessage: (message: ChatMessage) => void, onPhase: (phase: ConnectionPhase, detail?: string) => void,
    onDelete: (id: string) => void, onClear: (login?: string) => void,
  ) {
    this.login = login
    this.channelId = channelId
    this.onMessage = onMessage
    this.onPhase = onPhase
    this.onDelete = onDelete
    this.onClear = onClear
  }

  start() { this.stopped = false; void this.prepare() }
  stop() { this.stopped = true; window.clearTimeout(this.timer); this.socket?.close(); this.socket = undefined }

  private async prepare() {
    this.onPhase('connecting')
    try { this.emotes = await withTimeout(loadSevenTvEmotes(this.channelId), 6000) } catch { this.emotes = new Map() }
    if (!this.stopped) this.open()
  }

  private open() {
    const socket = new WebSocket(IRC_URL)
    this.socket = socket
    socket.onopen = () => {
      this.retry = 0
      this.send('CAP REQ :twitch.tv/tags twitch.tv/commands')
      this.send(`NICK justinfan${Math.floor(Math.random() * 90_000) + 10_000}`)
      this.send(`JOIN #${this.login}`)
      this.onPhase('connected')
    }
    socket.onmessage = ({ data }) => { for (const line of String(data).split('\r\n')) if (line) this.handle(line) }
    socket.onerror = () => this.onPhase('error', 'Twitch chat connection failed')
    socket.onclose = () => { if (!this.stopped && this.socket === socket) this.retryLater() }
  }

  private retryLater() {
    this.onPhase('reconnecting')
    const wait = Math.min(30_000, 1000 * 2 ** this.retry++) + Math.random() * 500
    window.clearTimeout(this.timer)
    this.timer = window.setTimeout(() => { if (!this.stopped) this.open() }, wait)
  }

  private send(line: string) { if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(`${line}\r\n`) }

  private handle(raw: string) {
    if (raw.startsWith('PING')) { this.send('PONG :tmi.twitch.tv'); return }
    const line = parseIrcLine(raw)
    if (!line) return
    if (line.command === 'RECONNECT') { this.socket?.close(); return }
    if (line.command === 'CLEARMSG') { const id = line.tags['target-msg-id']; if (id) this.onDelete(id); return }
    if (line.command === 'CLEARCHAT') {
      const login = line.params[1]
      this.onClear(login ? login.toLowerCase() : undefined)
      return
    }
    if (line.command === 'NOTICE') {
      const message = line.params[1] ?? ''
      if (/authentication|login|error/i.test(message)) this.onPhase('error', message)
      return
    }
    if (line.command !== 'PRIVMSG') return
    const text = line.params[1] ?? ''
    const login = (line.tags.login || line.prefix?.split('!')[0] || 'unknown').toLowerCase()
    const timestamp = Number(line.tags['tmi-sent-ts'] ?? '') || Date.now()
    this.onMessage({
      id: line.tags.id || `${timestamp}-${login}-${text.length}`,
      login,
      displayName: line.tags['display-name'] || login,
      color: line.tags.color || colorFor(login),
      badges: parseBadges(line.tags.badges),
      timestamp,
      text,
      parts: buildChatParts(text, line.tags.emotes, this.emotes),
    })
  }
}
