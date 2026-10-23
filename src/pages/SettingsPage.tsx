import { enable, disable } from '@tauri-apps/plugin-autostart'
import { getVersion } from '@tauri-apps/api/app'
import { RotateCcw, Save, ShieldCheck } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Button, Card, PageHeader } from '../components/ui'
import { defaultDashboardWidgets, useAppStore } from '../stores/app-store'
import { saveSetting } from '../services/native'
import { useRuntime } from '../services/runtime-context'
import { errorMessage, isTauri } from '../lib/utils'
import type { ActivityType, AppSettings } from '../types'

const eventOptions: Array<{ id: ActivityType; label: string }> = [
  { id: 'follow', label: 'Follows' }, { id: 'subscription', label: 'Subscriptions' }, { id: 'resubscription', label: 'Resubs' },
  { id: 'gift_subscription', label: 'Gift subs' }, { id: 'community_gift', label: 'Community gifts' }, { id: 'cheer', label: 'Cheers' },
  { id: 'raid', label: 'Raids' }, { id: 'donation', label: 'Donations' }, { id: 'channel_point', label: 'Channel points' },
  { id: 'stream_online', label: 'Stream online' }, { id: 'stream_offline', label: 'Stream offline' },
]

function Toggle({ value, onChange }: { value: boolean; onChange: (value: boolean) => void }) {
  return <button role="switch" aria-checked={value} onClick={() => onChange(!value)} className={`relative h-5 w-9 rounded-full transition ${value ? 'bg-accent' : 'bg-zinc-700'}`}><span className={`absolute top-0.5 size-4 rounded-full bg-white transition ${value ? 'left-[18px]' : 'left-0.5'}`}/></button>
}
function Row({ label, detail, children }: { label: string; detail: string; children: ReactNode }) {
  return <div className="flex items-center justify-between gap-6 border-b border-line py-4 last:border-0"><div><div className="text-sm">{label}</div><div className="mt-1 text-xs text-muted">{detail}</div></div>{children}</div>
}
function HighlightWords({ value, onSave }: { value: string[]; onSave: (value: string[]) => void }) {
  const [draft, setDraft] = useState(value.join(', '))
  return <input aria-label="Highlight words" className="input max-w-72" placeholder="important, giveaway, your name" value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={() => onSave([...new Set(draft.split(',').map((word) => word.trim()).filter(Boolean))])}/>
}

export function SettingsPage() {
  const { settings, setSettings } = useAppStore()
  const runtime = useRuntime()
  const [version, setVersion] = useState('1.0.0')
  const [clientId, setClientId] = useState(settings.twitchClientId)
  useEffect(() => { if (isTauri()) getVersion().then(setVersion) }, [])

  const update = async <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    try {
      if (key === 'launchAtStartup' && isTauri()) await (value ? enable() : disable())
      setSettings({ [key]: value })
      await saveSetting(key, value)
    } catch (error) { toast.error('Setting could not be saved', { description: errorMessage(error) }) }
  }
  const saveClientId = async () => {
    const value = clientId.trim()
    if (!/^[a-zA-Z0-9]{10,}$/.test(value)) { toast.error('This Twitch Client ID looks invalid'); return }
    const changed = value !== settings.twitchClientId
    await update('twitchClientId', value)
    if (changed) await runtime.disconnectTwitch()
    toast.success('Twitch Client ID saved', { description: changed ? 'Reconnect Twitch on the Connections page now.' : undefined })
  }

  return <><PageHeader title="Settings" description="Configure StreamDash and its service connections on this computer."/><div className="space-y-4">
    <section><h2 className="mb-2 px-1 text-[10px] font-bold tracking-[.14em] text-zinc-600">TWITCH</h2><Card className="p-5"><label className="label" htmlFor="twitch-client-id">Twitch Client ID</label><p className="mt-1 text-xs leading-5 text-muted">The public Client ID of your Twitch developer application. It is stored locally in the StreamDash database.</p><div className="mt-3 flex max-w-2xl gap-2"><input id="twitch-client-id" className="input font-mono" autoComplete="off" spellCheck={false} placeholder="Client ID from the Twitch Developer Console" value={clientId} onChange={(event) => setClientId(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void saveClientId() }}/><Button variant="primary" onClick={saveClientId}><Save size={14}/>Save</Button></div><div className="mt-3 flex items-center gap-2 text-[11px] text-zinc-600"><ShieldCheck size={13}/>The Client ID is public per Twitch. Access tokens stay protected in Windows Credential Manager.</div></Card></section>
    <section><h2 className="mb-2 px-1 text-[10px] font-bold tracking-[.14em] text-zinc-600">GENERAL</h2><Card className="px-5"><Row label="Launch with Windows" detail="Open StreamDash automatically after you sign in."><Toggle value={settings.launchAtStartup} onChange={(value) => update('launchAtStartup', value)}/></Row><Row label="Minimize to tray" detail="Keep realtime connections active when the window is closed."><Toggle value={settings.minimizeToTray} onChange={(value) => update('minimizeToTray', value)}/></Row><Row label="Keep user data on uninstall" detail="Keep the database, settings, and credentials when uninstalling."><Toggle value={settings.keepUserData} onChange={(value) => update('keepUserData', value)}/></Row></Card></section>
    <section><h2 className="mb-2 px-1 text-[10px] font-bold tracking-[.14em] text-zinc-600">APPEARANCE</h2><Card className="px-5"><Row label="Interface density" detail="Choose how much information fits on screen."><select className="input w-40" value={settings.uiDensity} onChange={(event) => update('uiDensity', event.target.value as AppSettings['uiDensity'])}><option value="compact">Compact</option><option value="comfortable">Comfortable</option></select></Row><Row label="Content width" detail="Limit the workspace or use all available room."><select className="input w-40" value={settings.contentWidth} onChange={(event) => update('contentWidth', event.target.value as AppSettings['contentWidth'])}><option value="compact">Focused</option><option value="wide">Wide</option><option value="full">Full width</option></select></Row><Row label="Accent color" detail="Used for actions, progress and selection."><select className="input w-40" value={settings.accentColor} onChange={(event) => update('accentColor', event.target.value as AppSettings['accentColor'])}><option value="violet">Violet</option><option value="blue">Blue</option><option value="emerald">Emerald</option><option value="orange">Orange</option></select></Row><Row label="Compact navigation" detail="Show only icons in the sidebar."><Toggle value={settings.sidebarCollapsed} onChange={(value) => update('sidebarCollapsed', value)}/></Row><Row label="Compact activity feed" detail="Use less vertical space between events."><Toggle value={settings.compactFeed} onChange={(value) => update('compactFeed', value)}/></Row><Row label="Animations" detail="Fade new events in smoothly."><Toggle value={settings.animations} onChange={(value) => update('animations', value)}/></Row><Row label="Dashboard layout" detail={`${settings.dashboardWidgets.length} widgets are currently visible.`}><Button onClick={() => update('dashboardWidgets', defaultDashboardWidgets)}><RotateCcw size={14}/>Reset</Button></Row></Card></section>
    <section><h2 className="mb-2 px-1 text-[10px] font-bold tracking-[.14em] text-zinc-600">NOTIFICATIONS</h2><Card className="px-5"><Row label="Windows notifications" detail="Show selected stream events as native notifications."><Toggle value={settings.notifications} onChange={(value) => update('notifications', value)}/></Row><Row label="Donations" detail="Notify when a donation is received."><Toggle value={settings.notifyDonations} onChange={(value) => update('notifyDonations', value)}/></Row><Row label="Raids" detail="Notify when another channel raids you."><Toggle value={settings.notifyRaids} onChange={(value) => update('notifyRaids', value)}/></Row><Row label="Gift subscriptions" detail="Notify for gifted and community subscriptions."><Toggle value={settings.notifyGiftSubs} onChange={(value) => update('notifyGiftSubs', value)}/></Row></Card></section>
    <section><h2 className="mb-2 px-1 text-[10px] font-bold tracking-[.14em] text-zinc-600">CHAT</h2><Card className="px-5"><Row label="Timestamps" detail="Show the receive time beside every message."><Toggle value={settings.chatTimestamps} onChange={(value) => update('chatTimestamps', value)}/></Row><Row label="Badges" detail="Show Twitch broadcaster, moderator and subscriber badges."><Toggle value={settings.chatBadges} onChange={(value) => update('chatBadges', value)}/></Row><Row label="Highlight mentions" detail="Highlight messages that mention your Twitch account."><Toggle value={settings.chatHighlightMentions} onChange={(value) => update('chatHighlightMentions', value)}/></Row><Row label="Highlight words" detail="Comma-separated words or phrases; matching is case-insensitive."><HighlightWords value={settings.chatHighlightWords} onSave={(value) => update('chatHighlightWords', value)}/></Row><Row label="Text size" detail="Change the chat message font size."><select className="input w-32" value={settings.chatFontSize} onChange={(event) => update('chatFontSize', Number(event.target.value))}><option value={12}>Small</option><option value={13}>Normal</option><option value={14}>Large</option><option value={16}>Extra large</option></select></Row><Row label="Emote size" detail="Set the height of Twitch and 7TV emotes."><select className="input w-32" value={settings.chatEmoteSize} onChange={(event) => update('chatEmoteSize', Number(event.target.value))}><option value={24}>Small</option><option value={28}>Normal</option><option value={34}>Large</option><option value={40}>Extra large</option></select></Row><Row label="Message buffer" detail="Older chat messages are discarded to keep memory usage stable."><select className="input w-32" value={settings.maximumChatMessages} onChange={(event) => update('maximumChatMessages', Number(event.target.value))}><option value={400}>400</option><option value={1000}>1,000</option><option value={2000}>2,000</option><option value={5000}>5,000</option></select></Row><Row label="Hidden users" detail={`${settings.chatHiddenUsers.length} users are hidden from the chat view.`}><Button disabled={!settings.chatHiddenUsers.length} onClick={() => update('chatHiddenUsers', [])}>Show all</Button></Row><Row label="Highlight exclusions" detail={`${settings.chatHighlightIgnoredUsers.length} users are excluded from highlights.`}><Button disabled={!settings.chatHighlightIgnoredUsers.length} onClick={() => update('chatHighlightIgnoredUsers', [])}>Reset</Button></Row></Card></section>
    <section><h2 className="mb-2 px-1 text-[10px] font-bold tracking-[.14em] text-zinc-600">EVENTS</h2><Card className="p-4"><p className="mb-3 text-xs text-muted">Choose which incoming events StreamDash records and displays.</p><div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-4">{eventOptions.map((option) => { const enabled = !settings.disabledEventTypes.includes(option.id); return <button key={option.id} onClick={() => update('disabledEventTypes', enabled ? [...settings.disabledEventTypes, option.id] : settings.disabledEventTypes.filter((id) => id !== option.id))} className={`flex items-center justify-between rounded-lg border px-3 py-2 text-xs transition ${enabled ? 'border-accent/30 bg-accent-soft text-zinc-200' : 'border-line bg-black/10 text-zinc-600'}`}><span>{option.label}</span><span className={`size-1.5 rounded-full ${enabled ? 'bg-accent' : 'bg-zinc-700'}`}/></button> })}</div></Card></section>
    <section><h2 className="mb-2 px-1 text-[10px] font-bold tracking-[.14em] text-zinc-600">DATA</h2><Card className="px-5"><Row label="Maximum stored events" detail="Older entries are removed automatically once this limit is reached."><select className="input w-32" value={settings.maximumEvents} onChange={(event) => update('maximumEvents', Number(event.target.value))}><option value={1000}>1,000</option><option value={5000}>5,000</option><option value={10000}>10,000</option><option value={50000}>50,000</option></select></Row></Card></section>
    <section><h2 className="mb-2 px-1 text-[10px] font-bold tracking-[.14em] text-zinc-600">ABOUT</h2><Card className="px-5"><Row label="StreamDash" detail="Tauri desktop application"><span className="text-xs text-muted">Version {version}</span></Row></Card></section>
  </div></>
}
