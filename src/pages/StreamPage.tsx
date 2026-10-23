import { ExternalLink, Gamepad2, Languages, LoaderCircle, RadioTower, Save, Search, TriangleAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import { openUrl } from '@tauri-apps/plugin-opener'
import { toast } from 'sonner'
import { Badge, Button, Card, EmptyState, PageHeader } from '../components/ui'
import { errorMessage, isTauri } from '../lib/utils'
import { twitchNative } from '../services/native'
import { useRuntime } from '../services/runtime-context'
import { useAppStore } from '../stores/app-store'

const MANAGE_SCOPE = 'channel:manage:broadcast'
const LANGUAGES = [
  ['en', 'English'], ['de', 'Deutsch'], ['es', 'Español'], ['fr', 'Français'], ['it', 'Italiano'],
  ['pt', 'Português'], ['nl', 'Nederlands'], ['pl', 'Polski'], ['ru', 'Русский'], ['tr', 'Türkçe'],
  ['sv', 'Svenska'], ['da', 'Dansk'], ['fi', 'Suomi'], ['no', 'Norsk'], ['cs', 'Čeština'],
  ['sk', 'Slovenčina'], ['hu', 'Magyar'], ['ro', 'Română'], ['uk', 'Українська'], ['el', 'Ελληνικά'],
  ['bg', 'Български'], ['ja', '日本語'], ['ko', '한국어'], ['zh', '中文'], ['th', 'ไทย'],
  ['vi', 'Tiếng Việt'], ['id', 'Bahasa Indonesia'], ['ar', 'العربية'], ['hi', 'हिन्दी'], ['he', 'עברית'],
].map(([value, label]) => ({ value, label }))

interface Channel { title: string; game_id: string; game_name: string; broadcaster_language: string }
interface Category { id: string; name: string; boxArt?: string }

function BoxArt({ category, className }: { category?: Category; className: string }) {
  if (category?.boxArt) return <img src={category.boxArt} alt="" className={`${className} rounded object-cover`}/>
  return <div className={`${className} grid place-items-center rounded bg-white/5 text-zinc-600`}><Gamepad2 size={15}/></div>
}

export function StreamPage() {
  const { stats, settings, twitch, setStats } = useAppStore()
  const runtime = useRuntime()
  const clientId = settings.twitchClientId.trim()
  const connected = twitch.phase === 'connected' && Boolean(twitch.userId) && Boolean(clientId)
  const busy = twitch.phase === 'connecting' || twitch.phase === 'reconnecting'
  const missingScope = connected && !twitch.scopes?.includes(MANAGE_SCOPE)

  const [saving, setSaving] = useState(false)
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState<Category>()
  const [language, setLanguage] = useState('en')
  const [query, setQuery] = useState('')
  const [lookup, setLookup] = useState<{ term: string; items: Category[] }>({ term: '', items: [] })
  const [loaded, setLoaded] = useState(false)

  const userId = twitch.userId
  const busyLoading = connected && !loaded
  const term = query.trim()
  const showResults = connected && term.length >= 2
  const searching = showResults && lookup.term !== term

  useEffect(() => {
    if (!connected || !userId) return
    let cancelled = false
    ;(async () => {
      try {
        const { data } = await twitchNative.helix<{ data: Channel[] }>(clientId, 'channels', [['broadcaster_id', userId]])
        if (cancelled) return
        const channel = data[0]
        if (channel) {
          setTitle(channel.title)
          setCategory({ id: channel.game_id, name: channel.game_name })
          setLanguage(channel.broadcaster_language || 'en')
        }
      } catch (error) { if (!cancelled) toast.error('Could not load stream details', { description: errorMessage(error) }) }
      finally { if (!cancelled) setLoaded(true) }
    })()
    return () => { cancelled = true }
  }, [clientId, connected, userId])

  useEffect(() => {
    if (!connected || term.length < 2) return
    let cancelled = false
    const timer = window.setTimeout(async () => {
      try {
        const { data } = await twitchNative.helix<{ data: Array<{ id: string; name: string; box_art_url?: string }> }>(clientId, 'search/categories', [['query', term], ['first', '8']])
        if (!cancelled) setLookup({ term, items: data.map((item) => ({ id: item.id, name: item.name, boxArt: item.box_art_url?.replace('{width}x{height}', '46x62') })) })
      } catch { if (!cancelled) setLookup({ term, items: [] }) }
    }, 350)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [clientId, connected, term])

  const save = async () => {
    if (!connected || !userId) return
    const value = title.trim()
    if (!value) { toast.error('Please enter a stream title'); return }
    if (value.length > 140) { toast.error('Twitch allows at most 140 characters'); return }
    setSaving(true)
    try {
      await twitchNative.helixPatch(clientId, 'channels', [['broadcaster_id', userId]], {
        title: value,
        ...(category ? { game_id: category.id } : {}),
        ...(language ? { broadcaster_language: language } : {}),
      })
      setStats({ title: value, category: category?.name })
      toast.success('Stream details updated', { description: 'Your Twitch channel now shows the new title, category, and language.' })
    } catch (error) { toast.error('Could not update stream details', { description: errorMessage(error) }) }
    finally { setSaving(false) }
  }

  const header = <PageHeader title="Stream" description="Change the title, category, and language shown on your Twitch channel." actions={<Badge tone={stats.live ? 'green' : 'neutral'}>{stats.live ? 'Live' : 'Offline'}</Badge>}/>

  if (!connected) return <>{header}<Card>{runtime.deviceAuth
    ? <div className="p-5"><div className="text-xs text-muted">Enter this code in the Twitch page opened in your browser</div><div className="mt-2 font-mono text-2xl font-semibold tracking-[.16em]">{runtime.deviceAuth.code}</div><Button className="mt-3" onClick={() => openUrl(runtime.deviceAuth!.url)}><ExternalLink size={14}/>Open Twitch activation</Button></div>
    : busy
      ? <div className="flex min-h-52 items-center justify-center gap-2 text-sm text-muted"><LoaderCircle size={16} className="animate-spin"/>Waiting for Twitch authorization…</div>
      : <EmptyState icon={<RadioTower size={22}/>} title="Twitch is not connected" body="Connect your broadcaster account to edit the title, category, and language of your channel from StreamDash." action={<Button variant="primary" disabled={!isTauri()} onClick={runtime.connectTwitch}>Connect Twitch</Button>}/>}
  </Card>{twitch.detail && <p className="mt-3 px-1 text-xs text-red-300">{twitch.detail}</p>}</>

  return <>{header}
    {missingScope && <Card className="mb-4 flex items-start gap-3 border-amber-500/30 bg-amber-400/[.06] p-4"><TriangleAlert size={16} className="mt-0.5 shrink-0 text-amber-300"/><div className="flex-1"><div className="text-sm font-medium text-amber-200">Twitch permission is missing</div><p className="mt-1 text-xs leading-5 text-muted">StreamDash needs the <span className="font-mono">channel:manage:broadcast</span> scope to edit your channel. Reconnect once to grant it.</p></div><Button onClick={runtime.connectTwitch}><RadioTower size={14}/>Reconnect Twitch</Button></Card>}
    <div className="grid grid-cols-[1fr_300px] gap-4">
      <Card className="p-5">
        <label className="label" htmlFor="stream-title">Stream title</label>
        <p className="mt-1 text-xs leading-5 text-muted">Shown on your channel page, in the Twitch directory, and in search results.</p>
        <div className="relative mt-3"><input id="stream-title" className="input pr-16" maxLength={140} autoComplete="off" placeholder="What are you streaming today?" value={title} disabled={busyLoading || missingScope} onChange={(event) => setTitle(event.target.value)}/><span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] tabular-nums text-zinc-600">{title.length}/140</span></div>

        <div className="mt-6">
          <label className="label inline-flex items-center gap-1.5" htmlFor="stream-category"><Gamepad2 size={13}/>Category</label>
          <p className="mt-1 text-xs leading-5 text-muted">Search Twitch’s directory for the game or category you are streaming.</p>
          {category && <div className="mt-3 flex items-center gap-3 rounded-xl border border-line bg-[#101116] p-2.5"><BoxArt category={category} className="h-12 w-9"/><div className="min-w-0 flex-1"><div className="truncate text-sm">{category.name}</div><div className="mt-0.5 text-[11px] text-zinc-600">Current category</div></div></div>}
          <div className="relative mt-3">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600"/>
            <input id="stream-category" className="input pl-9" autoComplete="off" spellCheck={false} placeholder="Search categories, e.g. Minecraft" value={query} disabled={busyLoading || missingScope} onChange={(event) => setQuery(event.target.value)}/>
            {showResults && <div className="absolute z-10 mt-1 max-h-80 w-full overflow-y-auto rounded-xl border border-line bg-[#14151b] p-1 shadow-2xl shadow-black/40">
              {searching && <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted"><LoaderCircle size={13} className="animate-spin"/>Searching…</div>}
              {!searching && lookup.items.length === 0 && <div className="px-3 py-2 text-xs text-muted">No categories found</div>}
              {!searching && lookup.items.map((item) => <button key={item.id} className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-white/[.06]" onClick={() => { setCategory(item); setQuery(''); setLookup({ term: '', items: [] }) }}><BoxArt category={item} className="h-9 w-7"/><span className="truncate text-sm">{item.name}</span></button>)}
            </div>}
          </div>
        </div>

        <div className="mt-6">
          <label className="label inline-flex items-center gap-1.5" htmlFor="stream-language"><Languages size={13}/>Language</label>
          <p className="mt-1 text-xs leading-5 text-muted">Used for the language filter in the Twitch directory.</p>
          <select id="stream-language" className="input mt-3 max-w-xs" value={language} disabled={busyLoading || missingScope} onChange={(event) => setLanguage(event.target.value)}>
            {!LANGUAGES.some((item) => item.value === language) && <option value={language}>{language}</option>}
            {LANGUAGES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </div>

        <div className="mt-6 flex items-center justify-between gap-4 border-t border-line pt-5">
          <p className="text-[11px] leading-5 text-zinc-600">Changes apply immediately, also while you are offline.</p>
          <Button variant="primary" disabled={saving || busyLoading || missingScope || !title.trim()} onClick={save}>{saving ? <LoaderCircle size={15} className="animate-spin"/> : <Save size={15}/>}Save changes</Button>
        </div>
      </Card>

      <Card className="h-fit p-4">
        <h2 className="text-sm font-semibold">Channel preview</h2>
        <div className="mt-4 flex gap-3">
          <BoxArt category={category} className="h-24 w-16 shrink-0"/>
          <div className="min-w-0">
            <div className="line-clamp-3 text-sm font-medium leading-5">{title.trim() || 'No title yet'}</div>
            <div className="mt-1 truncate text-xs text-muted">{category?.name || 'No category selected'}</div>
            <div className="mt-0.5 text-[11px] text-zinc-600">{LANGUAGES.find((item) => item.value === language)?.label ?? language}</div>
          </div>
        </div>
        <div className="mt-4 space-y-2 border-t border-line pt-3 text-xs">
          <div className="flex items-center justify-between"><span className="text-muted">Status</span><span>{stats.live ? 'Live' : 'Offline'}</span></div>
          <div className="flex items-center justify-between"><span className="text-muted">Viewers</span><span className="tabular-nums">{stats.viewers?.toLocaleString() ?? '—'}</span></div>
          <div className="flex items-center justify-between"><span className="text-muted">Account</span><span className="truncate pl-3">{twitch.account ?? '—'}</span></div>
        </div>
      </Card>
    </div>
  </>
}
