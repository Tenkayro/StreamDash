import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { twitchNative } from '../native'
import type { ChatBadge, ChatEmote, ChatMessage, ChatPart, ConnectionPhase } from '../../types'

const TV_BASE = 'https://7tv.io/v3'
const TWITCH_EMOTE = (id: string) => `https://static-cdn.jtvnw.net/emoticons/v2/${id}/default/dark/2.0`
const USER_COLORS = ['#ff7f7f', '#ffbf7f', '#ffdf7f', '#ffff7f', '#bfff7f', '#7fff7f', '#7fffbf', '#7fffff', '#7fbfff', '#7f7fff', '#bf7fff', '#ff7fff', '#ff7fbf']

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

function parseSevenTvEmotes(emotes: SevenTvActiveEmote[] = []): ChatEmote[] {
  return emotes.flatMap((active) => {
    const data = active.data
    const host = data?.host
    if (!host?.url || data?.listed === false || ((data?.flags ?? 0) & (1 << 24))) return []
    const file = selectEmoteFile(host.files ?? [])
    if (!file) return []
    return [{ name: active.name, url: `https:${host.url}/${file.name}`, zeroWidth: (active.flags & 1) === 1, source: '7tv' as const }]
  })
}

async function fetchSevenTvSet(url: string): Promise<ChatEmote[]> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`7TV request failed with ${response.status}`)
  const payload = await response.json() as { emotes?: SevenTvActiveEmote[] }
  return parseSevenTvEmotes(payload.emotes)
}

async function fetchSevenTvChannel(channelId: string): Promise<ChatEmote[]> {
  const response = await fetch(`${TV_BASE}/users/twitch/${channelId}`)
  if (response.status === 404) return []
  if (!response.ok) throw new Error(`7TV channel request failed with ${response.status}`)
  const payload = await response.json() as { emote_set?: { emotes?: SevenTvActiveEmote[] }; emote_set_id?: string }
  if (payload.emote_set?.emotes) return parseSevenTvEmotes(payload.emote_set.emotes)
  return payload.emote_set_id ? fetchSevenTvSet(`${TV_BASE}/emote-sets/${payload.emote_set_id}`) : []
}

export async function loadSevenTvEmotes(channelId?: string): Promise<ChatEmoteMap> {
  const [global, channel] = await Promise.allSettled([
    fetchSevenTvSet(`${TV_BASE}/emote-sets/global`),
    channelId ? fetchSevenTvChannel(channelId) : Promise.resolve<ChatEmote[]>([]),
  ])
  const map: ChatEmoteMap = new Map()
  for (const emote of global.status === 'fulfilled' ? global.value : []) map.set(emote.name, emote)
  for (const emote of channel.status === 'fulfilled' ? channel.value : []) map.set(emote.name, emote)
  return map
}

interface HelixEmote { name?: string; images?: { url_1x?: string; url_2x?: string; url_4x?: string } }
async function loadTwitchEmotes(clientId: string, channelId: string): Promise<ChatEmoteMap> {
  const results = await Promise.allSettled([
    twitchNative.helix<{ data?: HelixEmote[] }>(clientId, 'chat/emotes/global'),
    twitchNative.helix<{ data?: HelixEmote[] }>(clientId, 'chat/emotes', [['broadcaster_id', channelId]]),
  ])
  const map: ChatEmoteMap = new Map()
  for (const result of results) {
    if (result.status !== 'fulfilled') continue
    for (const emote of result.value.data ?? []) {
      const url = emote.images?.url_2x || emote.images?.url_1x || emote.images?.url_4x
      if (emote.name && url) map.set(emote.name, { name: emote.name, url, zeroWidth: false, source: 'twitch' })
    }
  }
  return map
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer = 0
  const timeout = new Promise<T>((_, reject) => { timer = window.setTimeout(() => reject(new Error('Chat resource request timed out')), ms) })
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

interface HelixBadgeSet { set_id?: string; versions?: Array<{ id?: string; image_url_1x?: string; image_url_2x?: string }> }

async function loadTwitchBadges(clientId: string, channelId: string) {
  const map = new Map<string, string>()
  const results = await Promise.allSettled([
    twitchNative.helix<{ data?: HelixBadgeSet[] }>(clientId, 'chat/badges/global'),
    twitchNative.helix<{ data?: HelixBadgeSet[] }>(clientId, 'chat/badges', [['broadcaster_id', channelId]]),
  ])
  for (const result of results) {
    if (result.status !== 'fulfilled') continue
    for (const set of result.value.data ?? []) {
      if (!set.set_id) continue
      for (const version of set.versions ?? []) {
        const url = version.image_url_2x || version.image_url_1x
        if (version.id && url) map.set(`${set.set_id}/${version.id}`, url)
      }
    }
  }
  return map
}

function parseBadges(value: string | undefined, badgeUrls: Map<string, string>) {
  return (value ?? '').split(',').filter(Boolean).flatMap((entry) => {
    const [id, version] = entry.split('/')
    const url = id && version ? badgeUrls.get(`${id}/${version}`) : undefined
    return url ? [{ id, version, url }] : []
  })
}

export class TwitchChatClient {
  private stopped = false
  private retry = 0
  private timer?: number
  private unlisten: UnlistenFn[] = []
  private session = ''
  private emotes: ChatEmoteMap = new Map()
  private badges = new Map<string, string>()
  private self = { displayName: '', color: '', badges: [] as ChatBadge[] }
  private login: string
  private channelId?: string
  private clientId: string
  private onMessage: (message: ChatMessage) => void
  private onPhase: (phase: ConnectionPhase, detail?: string) => void
  private onDelete: (id: string) => void
  private onClear: (login?: string) => void
  private onEmotes: (emotes: ChatEmote[]) => void

  constructor(
    clientId: string, login: string, channelId: string | undefined,
    onMessage: (message: ChatMessage) => void, onPhase: (phase: ConnectionPhase, detail?: string) => void,
    onDelete: (id: string) => void, onClear: (login?: string) => void, onEmotes: (emotes: ChatEmote[]) => void,
  ) {
    this.clientId = clientId
    this.login = login
    this.channelId = channelId
    this.onMessage = onMessage
    this.onPhase = onPhase
    this.onDelete = onDelete
    this.onClear = onClear
    this.onEmotes = onEmotes
  }

  start() { this.stopped = false; void this.prepare() }
  stop() {
    this.stopped = true
    window.clearTimeout(this.timer)
    this.session = ''
    this.unlisten.forEach((unlisten) => unlisten())
    this.unlisten = []
    void twitchNative.chatStop()
  }

  echo(text: string) {
    const timestamp = Date.now()
    this.onMessage({
      id: `local-${timestamp}-${Math.random().toString(36).slice(2, 8)}`,
      login: this.login,
      displayName: this.self.displayName || this.login,
      color: this.self.color || colorFor(this.login),
      badges: this.self.badges,
      timestamp,
      text,
      parts: buildChatParts(text, undefined, this.emotes),
    })
  }

  private async prepare() {
    this.onPhase('connecting')
    const [sevenTv, twitchEmotes, badges] = await Promise.allSettled([
      withTimeout(loadSevenTvEmotes(this.channelId), 6000),
      this.channelId ? withTimeout(loadTwitchEmotes(this.clientId, this.channelId), 6000) : Promise.resolve(new Map<string, ChatEmote>()),
      this.channelId ? withTimeout(loadTwitchBadges(this.clientId, this.channelId), 6000) : Promise.resolve(new Map<string, string>()),
    ])
    this.emotes = twitchEmotes.status === 'fulfilled' ? twitchEmotes.value : new Map()
    if (sevenTv.status === 'fulfilled') for (const [name, emote] of sevenTv.value) this.emotes.set(name, emote)
    this.badges = badges.status === 'fulfilled' ? badges.value : new Map()
    this.onEmotes([...this.emotes.values()].sort((left, right) => left.name.localeCompare(right.name)))
    if (this.stopped) return
    this.unlisten = await Promise.all([
      listen<{ session: string; line: string }>('twitch-chat-line', ({ payload }) => {
        if (payload.session !== this.session) return
        for (const line of payload.line.split('\r\n')) if (line) this.handle(line)
      }),
      listen<{ session: string }>('twitch-chat-closed', ({ payload }) => {
        if (payload.session === this.session && !this.stopped) this.retryLater()
      }),
    ])
    if (this.stopped) { this.unlisten.forEach((unlisten) => unlisten()); this.unlisten = [] } else void this.connect()
  }

  private async connect() {
    this.onPhase('connecting')
    this.session = crypto.randomUUID()
    try {
      await twitchNative.chatStart(this.clientId, this.login, this.login, this.session)
      if (this.stopped) return
      this.retry = 0
      this.onPhase('connected')
    } catch (error) {
      if (this.stopped) return
      this.onPhase('error', error instanceof Error ? error.message : String(error))
      this.retryLater()
    }
  }

  private retryLater() {
    this.onPhase('reconnecting')
    const wait = Math.min(30_000, 1000 * 2 ** this.retry++) + Math.random() * 500
    window.clearTimeout(this.timer)
    this.timer = window.setTimeout(() => { if (!this.stopped) void this.connect() }, wait)
  }

  private handle(raw: string) {
    const line = parseIrcLine(raw)
    if (!line) return
    if (line.command === 'USERSTATE') {
      this.self = {
        displayName: line.tags['display-name'] || this.login,
        color: line.tags.color || colorFor(this.login),
        badges: parseBadges(line.tags.badges, this.badges),
      }
      return
    }
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
    const rawText = line.params[1] ?? ''
    const action = rawText.startsWith('\u0001ACTION ') && rawText.endsWith('\u0001')
    const text = action ? rawText.slice(8, -1) : rawText
    const login = (line.tags.login || line.prefix?.split('!')[0] || 'unknown').toLowerCase()
    const timestamp = Number(line.tags['tmi-sent-ts'] ?? '') || Date.now()
    this.onMessage({
      id: line.tags.id || `${timestamp}-${login}-${text.length}`,
      login,
      displayName: line.tags['display-name'] || login,
      color: line.tags.color || colorFor(login),
      badges: parseBadges(line.tags.badges, this.badges),
      timestamp,
      text,
      parts: buildChatParts(text, action ? undefined : line.tags.emotes, this.emotes),
      action,
      firstMessage: line.tags['first-msg'] === '1',
      reply: line.tags['reply-parent-display-name'] ? { displayName: line.tags['reply-parent-display-name'], body: line.tags['reply-parent-msg-body'] || '' } : undefined,
    })
  }
}
