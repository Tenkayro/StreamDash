import { enable, disable } from '@tauri-apps/plugin-autostart'
import { getVersion } from '@tauri-apps/api/app'
import { Download, LoaderCircle, RefreshCw, Save, ShieldCheck } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Button, Card, PageHeader } from '../components/ui'
import { useAppStore } from '../stores/app-store'
import { saveSetting } from '../services/native'
import { useRuntime } from '../services/runtime-context'
import { useUpdater } from '../services/updater-context'
import { errorMessage, isTauri } from '../lib/utils'
import type { AppSettings } from '../types'

function Toggle({ value, onChange }: { value: boolean; onChange: (value: boolean) => void }) {
  return <button role="switch" aria-checked={value} onClick={() => onChange(!value)} className={`relative h-5 w-9 rounded-full transition ${value ? 'bg-accent' : 'bg-zinc-700'}`}><span className={`absolute top-0.5 size-4 rounded-full bg-white transition ${value ? 'left-[18px]' : 'left-0.5'}`}/></button>
}
function Row({ label, detail, children }: { label: string; detail: string; children: ReactNode }) {
  return <div className="flex items-center justify-between gap-6 border-b border-line py-4 last:border-0"><div><div className="text-sm">{label}</div><div className="mt-1 text-xs text-muted">{detail}</div></div>{children}</div>
}

function UpdatePanel({ currentVersion }: { currentVersion: string }) {
  const updater = useUpdater()
  const busy = updater.phase === 'checking' || updater.phase === 'downloading' || updater.phase === 'installing'
  const detail = updater.phase === 'checking' ? 'Checking GitHub for a signed update…'
    : updater.phase === 'current' ? 'You are running the latest version.'
      : updater.phase === 'available' ? `Version ${updater.version} is ready to download.`
        : updater.phase === 'downloading' ? `Downloading update${updater.progress == null ? '…' : ` — ${updater.progress}%`}`
          : updater.phase === 'installing' ? 'Starting the installer. StreamDash will close automatically…'
            : updater.phase === 'error' ? updater.error || 'The update check failed.'
              : 'Updates are signed and downloaded from the official GitHub release.'

  return <Card className="overflow-hidden"><div className="flex items-center justify-between gap-6 px-5 py-4"><div><div className="text-sm">StreamDash {currentVersion}</div><div className={`mt-1 text-xs ${updater.phase === 'error' ? 'text-red-300' : 'text-muted'}`}>{detail}</div></div><div className="flex shrink-0 gap-2"><Button disabled={busy} onClick={() => updater.checkForUpdates()}>{updater.phase === 'checking' ? <LoaderCircle size={14} className="animate-spin"/> : <RefreshCw size={14}/>}Check for updates</Button>{updater.phase === 'available' && <Button variant="primary" onClick={updater.installUpdate}><Download size={14}/>Install {updater.version}</Button>}</div></div>{updater.phase === 'available' && updater.notes && <div className="border-t border-line px-5 py-3 text-xs leading-5 text-muted whitespace-pre-line">{updater.notes}</div>}{updater.phase === 'downloading' && updater.progress != null && <div className="h-1 bg-white/5"><div className="h-full bg-accent transition-[width]" style={{ width: `${updater.progress}%` }}/></div>}</Card>
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
    } catch (error) { toast.error('Einstellung konnte nicht gespeichert werden', { description: errorMessage(error) }) }
  }
  const saveClientId = async () => {
    const value = clientId.trim()
    if (!/^[a-zA-Z0-9]{10,}$/.test(value)) { toast.error('Die Twitch Client ID sieht ungültig aus'); return }
    const changed = value !== settings.twitchClientId
    await update('twitchClientId', value)
    if (changed) await runtime.disconnectTwitch()
    toast.success('Twitch Client ID gespeichert', { description: changed ? 'Verbinde Twitch jetzt auf der Verbindungen-Seite neu.' : undefined })
  }

  return <><PageHeader title="Einstellungen" description="StreamDash und die Dienstverbindungen auf diesem Computer einrichten."/><div className="space-y-4">
    <section><h2 className="mb-2 px-1 text-[10px] font-bold tracking-[.14em] text-zinc-600">TWITCH</h2><Card className="p-5"><label className="label" htmlFor="twitch-client-id">Twitch Client ID</label><p className="mt-1 text-xs leading-5 text-muted">Die öffentliche Client ID deiner Twitch-Entwickleranwendung. Sie wird lokal in der StreamDash-Datenbank gespeichert.</p><div className="mt-3 flex max-w-2xl gap-2"><input id="twitch-client-id" className="input font-mono" autoComplete="off" spellCheck={false} placeholder="Client ID aus der Twitch Developer Console" value={clientId} onChange={(event) => setClientId(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void saveClientId() }}/><Button variant="primary" onClick={saveClientId}><Save size={14}/>Speichern</Button></div><div className="mt-3 flex items-center gap-2 text-[11px] text-zinc-600"><ShieldCheck size={13}/>Die Client ID ist laut Twitch öffentlich. Zugriffstoken bleiben geschützt im Windows-Anmeldeinformationsmanager.</div></Card></section>
    <section><h2 className="mb-2 px-1 text-[10px] font-bold tracking-[.14em] text-zinc-600">ALLGEMEIN</h2><Card className="px-5"><Row label="Mit Windows starten" detail="StreamDash nach der Anmeldung automatisch öffnen."><Toggle value={settings.launchAtStartup} onChange={(value) => update('launchAtStartup', value)}/></Row><Row label="In den Infobereich minimieren" detail="Realtime-Verbindungen beim Schließen des Fensters aktiv halten."><Toggle value={settings.minimizeToTray} onChange={(value) => update('minimizeToTray', value)}/></Row><Row label="Windows-Benachrichtigungen" detail="Wichtige Ereignisse als native Benachrichtigung anzeigen."><Toggle value={settings.notifications} onChange={(value) => update('notifications', value)}/></Row><Row label="Benutzerdaten bei Deinstallation behalten" detail="Standardmäßig aktiv. Ausschalten, um Datenbank, Einstellungen und Zugangsdaten beim Deinstallieren vollständig zu löschen."><Toggle value={settings.keepUserData} onChange={(value) => update('keepUserData', value)}/></Row></Card></section>
    <section><h2 className="mb-2 px-1 text-[10px] font-bold tracking-[.14em] text-zinc-600">DARSTELLUNG & AKTIVITÄT</h2><Card className="px-5"><Row label="Kompakter Aktivitätsfeed" detail="Weniger vertikalen Abstand zwischen Ereignissen verwenden."><Toggle value={settings.compactFeed} onChange={(value) => update('compactFeed', value)}/></Row><Row label="Animationen" detail="Neue Ereignisse weich einblenden."><Toggle value={settings.animations} onChange={(value) => update('animations', value)}/></Row><Row label="Maximal gespeicherte Ereignisse" detail="Ältere Einträge werden nach diesem Limit automatisch entfernt."><select className="input w-32" value={settings.maximumEvents} onChange={(event) => update('maximumEvents', Number(event.target.value))}><option value={1000}>1.000</option><option value={5000}>5.000</option><option value={10000}>10.000</option><option value={50000}>50.000</option></select></Row></Card></section>
    <section><h2 className="mb-2 px-1 text-[10px] font-bold tracking-[.14em] text-zinc-600">UPDATES</h2><UpdatePanel currentVersion={version}/></section>
    <section><h2 className="mb-2 px-1 text-[10px] font-bold tracking-[.14em] text-zinc-600">ÜBER</h2><Card className="px-5"><Row label="StreamDash" detail="Tauri Desktop-Anwendung"><span className="text-xs text-muted">Version {version}</span></Row></Card></section>
  </div></>
}
