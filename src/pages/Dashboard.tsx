import { Activity, ArrowDown, ArrowUp, Check, Clock3, Eye, Heart, LayoutGrid, Link2, Radio, RotateCcw, Settings2, Sparkles, Star, Target, Wallet, type LucideIcon } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useAppStore, defaultDashboardWidgets } from '../stores/app-store'
import { saveSetting } from '../services/native'
import { ActivityFeed } from '../components/ActivityFeed'
import { Badge, Button, Card, PageHeader } from '../components/ui'
import { money } from '../lib/utils'
import type { ConnectionState, DashboardWidgetId } from '../types'

const widgetCatalog: Array<{ id: DashboardWidgetId; label: string; description: string }> = [
  { id: 'followers', label: 'Followers', description: 'Current Twitch followers' },
  { id: 'subscribers', label: 'Subscribers', description: 'Current active subscriptions' },
  { id: 'viewers', label: 'Viewers', description: 'Current live viewers' },
  { id: 'duration', label: 'Stream duration', description: 'Time since going live' },
  { id: 'bits', label: 'Bits', description: 'Locally collected bits' },
  { id: 'donations', label: 'Donations', description: 'Locally collected donations' },
  { id: 'status', label: 'Stream status', description: 'Live state and title' },
  { id: 'eventCount', label: 'Event count', description: 'Stored activity total' },
  { id: 'activity', label: 'Recent activity', description: 'Latest events at a glance' },
  { id: 'streamDetails', label: 'Stream details', description: 'Title and category' },
  { id: 'goals', label: 'Goals', description: 'Progress toward your targets' },
  { id: 'connections', label: 'Connections', description: 'Service health and accounts' },
]
const allWidgetIds = new Set(widgetCatalog.map((widget) => widget.id))

function Metric({ label, value, note, icon: Icon }: { label: string; value: string; note?: string; icon: LucideIcon }) {
  return <Card className="flex min-h-24 flex-col p-3.5"><div className="flex items-center justify-between"><span className="text-[11px] font-medium text-muted">{label}</span><Icon size={14} className="text-zinc-600"/></div><div className="mt-auto pt-2 text-xl font-semibold tracking-[-.03em]">{value}</div>{note && <div className="mt-0.5 truncate text-[10px] text-zinc-600">{note}</div>}</Card>
}
function duration(since?: string) { if (!since) return '—'; const seconds = Math.max(0, Math.floor((Date.now() - new Date(since).getTime()) / 1000)); return `${Math.floor(seconds / 3600)}h ${Math.floor(seconds % 3600 / 60)}m` }
function connectionTone(state: ConnectionState) { return state.phase === 'connected' ? 'bg-emerald-400' : state.phase === 'connecting' || state.phase === 'reconnecting' ? 'bg-amber-400' : state.phase === 'error' || state.phase === 'expired' ? 'bg-red-400' : 'bg-zinc-600' }

function LayoutEditor({ widgets, onChange, onClose }: { widgets: DashboardWidgetId[]; onChange: (widgets: DashboardWidgetId[]) => void; onClose: () => void }) {
  const active = new Set(widgets)
  const toggle = (id: DashboardWidgetId) => onChange(active.has(id) ? widgets.filter((item) => item !== id) : [...widgets, id])
  const move = (id: DashboardWidgetId, direction: -1 | 1) => { const from = widgets.indexOf(id); const to = from + direction; if (from < 0 || to < 0 || to >= widgets.length) return; const next = [...widgets]; [next[from], next[to]] = [next[to], next[from]]; onChange(next) }
  return <Card className="mb-3 overflow-hidden border-accent/30"><div className="flex items-center justify-between border-b border-line px-4 py-2.5"><div><div className="text-sm font-semibold">Customize dashboard</div><div className="text-[11px] text-muted">Show only what matters and choose the order.</div></div><div className="flex gap-2"><Button variant="ghost" onClick={() => onChange(defaultDashboardWidgets)}><RotateCcw size={13}/>Reset</Button><Button variant="primary" onClick={onClose}><Check size={13}/>Done</Button></div></div><div className="grid grid-cols-2 gap-px bg-line lg:grid-cols-3 xl:grid-cols-4">{widgetCatalog.map((widget) => { const enabled = active.has(widget.id); const position = widgets.indexOf(widget.id); return <div key={widget.id} className="flex min-w-0 items-center gap-2 bg-panel p-3"><button role="switch" aria-checked={enabled} onClick={() => toggle(widget.id)} className={`grid size-5 shrink-0 place-items-center rounded border ${enabled ? 'border-accent bg-accent text-white' : 'border-zinc-700 bg-transparent text-transparent'}`}><Check size={12}/></button><button className="min-w-0 flex-1 text-left" onClick={() => toggle(widget.id)}><div className="truncate text-xs font-medium">{widget.label}</div><div className="truncate text-[10px] text-zinc-600">{widget.description}</div></button>{enabled && <div className="flex shrink-0"><button aria-label={`Move ${widget.label} up`} disabled={position === 0} onClick={() => move(widget.id, -1)} className="grid size-6 place-items-center rounded text-zinc-500 hover:bg-white/5 hover:text-zinc-200 disabled:opacity-20"><ArrowUp size={12}/></button><button aria-label={`Move ${widget.label} down`} disabled={position === widgets.length - 1} onClick={() => move(widget.id, 1)} className="grid size-6 place-items-center rounded text-zinc-500 hover:bg-white/5 hover:text-zinc-200 disabled:opacity-20"><ArrowDown size={12}/></button></div>}</div> })}</div></Card>
}

export function Dashboard() {
  const { stats, events, settings, twitch, streamElements, setPage, setSettings } = useAppStore()
  const [, tick] = useState(0); const [editing, setEditing] = useState(false)
  useEffect(() => { const id = setInterval(() => tick((x) => x + 1), 30_000); return () => clearInterval(id) }, [])
  const connected = twitch.phase === 'connected' || streamElements.phase === 'connected'
  const widgets = useMemo(() => Array.isArray(settings.dashboardWidgets) ? [...new Set(settings.dashboardWidgets.filter((id) => allWidgetIds.has(id)))] : defaultDashboardWidgets, [settings.dashboardWidgets])
  const updateWidgets = (next: DashboardWidgetId[]) => { setSettings({ dashboardWidgets: next }); void saveSetting('dashboardWidgets', next).catch(() => toast.error('Dashboard layout could not be saved')) }
  const metric = (id: DashboardWidgetId) => {
    if (id === 'followers') return <Metric label="Followers" value={stats.followers?.toLocaleString('en-US') ?? '—'} icon={Heart}/>
    if (id === 'subscribers') return <Metric label="Subscribers" value={stats.subscribers?.toLocaleString('en-US') ?? '—'} icon={Star}/>
    if (id === 'viewers') return <Metric label="Current viewers" value={stats.viewers?.toLocaleString('en-US') ?? '—'} icon={Eye}/>
    if (id === 'duration') return <Metric label="Stream duration" value={duration(stats.startedAt)} icon={Clock3}/>
    if (id === 'bits') return <Metric label="Bits collected" value={stats.bits.toLocaleString('en-US')} icon={Sparkles}/>
    if (id === 'donations') return <Metric label="Donations" value={money(stats.donations, stats.donationCurrency)} icon={Wallet}/>
    if (id === 'status') return <Metric label="Stream status" value={stats.live ? 'Live' : 'Offline'} note={stats.title} icon={Radio}/>
    return <Metric label="Activity events" value={events.length.toLocaleString('en-US')} icon={Activity}/>
  }
  const renderWidget = (id: DashboardWidgetId) => {
    if (!['activity', 'streamDetails', 'goals', 'connections'].includes(id)) return <div key={id} className="col-span-12 sm:col-span-6 xl:col-span-3">{metric(id)}</div>
    if (id === 'activity') return <Card key={id} className="col-span-12 overflow-hidden lg:col-span-8"><div className="flex items-center justify-between border-b border-line px-4 py-3"><h2 className="text-xs font-semibold">Recent activity</h2><button className="text-[11px] text-accent hover:brightness-125" onClick={() => setPage('activity')}>View all</button></div><ActivityFeed events={events} limit={settings.uiDensity === 'compact' ? 5 : 7} compact={settings.compactFeed || settings.uiDensity === 'compact'}/></Card>
    if (id === 'streamDetails') return <Card key={id} className="col-span-12 p-4 lg:col-span-4"><div className="flex items-center justify-between"><h2 className="text-xs font-semibold">Stream details</h2><button className="text-[11px] text-accent hover:brightness-125" onClick={() => setPage('stream')}>Edit</button></div><div className="mt-4 space-y-4"><div><div className="text-[10px] text-muted">Title</div><div className="mt-1 text-xs">{stats.title || 'No stream information'}</div></div><div><div className="text-[10px] text-muted">Category</div><div className="mt-1 text-xs">{stats.category || '—'}</div></div></div></Card>
    if (id === 'goals') { const goals = [{ label: 'Followers', value: stats.followers, target: settings.goals.followers }, { label: 'Subscribers', value: stats.subscribers, target: settings.goals.subscribers }, { label: 'Donations', value: stats.donations, target: settings.goals.donations }]; return <Card key={id} className="col-span-12 p-4 lg:col-span-6"><div className="mb-3 flex items-center justify-between"><div className="flex items-center gap-2 text-xs font-semibold"><Target size={14} className="text-accent"/>Goals</div><button className="text-[11px] text-accent" onClick={() => setPage('goals')}>Manage</button></div><div className="space-y-3">{goals.map((goal) => { const percent = goal.value != null && goal.target ? Math.min(100, goal.value / goal.target * 100) : 0; return <div key={goal.label}><div className="mb-1 flex justify-between text-[10px]"><span className="text-muted">{goal.label}</span><span>{goal.target ? `${Math.round(percent)}%` : 'No target'}</span></div><div className="h-1.5 overflow-hidden rounded-full bg-white/5"><div className="h-full rounded-full bg-accent" style={{ width: `${percent}%` }}/></div></div> })}</div></Card> }
    return <Card key={id} className="col-span-12 p-4 lg:col-span-6"><div className="mb-3 flex items-center justify-between"><div className="flex items-center gap-2 text-xs font-semibold"><Link2 size={14} className="text-accent"/>Connections</div><button className="text-[11px] text-accent" onClick={() => setPage('connections')}>Manage</button></div>{[['Twitch', twitch], ['StreamElements', streamElements]].map(([name, state]) => { const service = state as ConnectionState; return <div key={name as string} className="flex items-center justify-between border-t border-line py-2.5 first:border-0"><div><div className="text-xs">{name as string}</div><div className="text-[10px] text-zinc-600">{service.account || service.phase}</div></div><span className={`size-2 rounded-full ${connectionTone(service)}`}/></div> })}</Card>
  }
  return <><PageHeader title="Dashboard" actions={<div className="flex items-center gap-2"><Badge tone={stats.live ? 'green' : connected ? 'neutral' : 'amber'}>{stats.live ? 'Live' : connected ? 'Offline' : 'Disconnected'}</Badge><Button variant={editing ? 'primary' : 'default'} onClick={() => setEditing(!editing)}>{editing ? <LayoutGrid size={14}/> : <Settings2 size={14}/>} {editing ? 'Finish' : 'Customize'}</Button></div>}/>{editing && <LayoutEditor widgets={widgets} onChange={updateWidgets} onClose={() => setEditing(false)}/>}<div className="grid grid-cols-12 gap-3">{widgets.map(renderWidget)}</div>{widgets.length === 0 && <Card className="grid min-h-52 place-items-center text-center"><div><LayoutGrid size={24} className="mx-auto text-zinc-600"/><div className="mt-3 text-sm font-medium">Your dashboard is empty</div><button className="mt-2 text-xs text-accent" onClick={() => setEditing(true)}>Add widgets</button></div></Card>}</>
}
