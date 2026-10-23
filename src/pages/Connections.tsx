import { CheckCircle2, ExternalLink, Link2, LoaderCircle, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { openUrl } from '@tauri-apps/plugin-opener'
import { Badge, Button, Card, PageHeader } from '../components/ui'
import { useAppStore } from '../stores/app-store'
import { useRuntime } from '../services/runtime-context'
import { isTauri } from '../lib/utils'
import { needsTwitchPermissionUpdate } from '../services/twitch/client'

function phaseTone(phase: string) { return phase === 'connected' ? 'green' : phase === 'connecting' || phase === 'reconnecting' ? 'amber' : phase === 'error' || phase === 'expired' ? 'red' : 'neutral' as const }

export function Connections() {
  const { twitch, streamElements } = useAppStore(); const runtime = useRuntime(); const [token, setToken] = useState('')
  const twitchBusy = ['connecting', 'reconnecting'].includes(twitch.phase); const seBusy = ['connecting', 'reconnecting'].includes(streamElements.phase)
  const missingModeration = twitch.phase === 'connected' && needsTwitchPermissionUpdate(twitch.scopes)
  return <><PageHeader title="Connections"/><div className="space-y-4">
    <Card className="p-5"><div className="flex items-start justify-between gap-5"><div className="flex gap-4"><div className="grid size-11 place-items-center rounded-xl bg-[#9146ff]/10 text-[#a66cff]"><span className="text-lg font-bold">T</span></div><div><div className="flex items-center gap-2"><h2 className="font-semibold">Twitch</h2><Badge tone={phaseTone(twitch.phase)}>{twitch.phase}</Badge></div>{twitch.account && <p className="mt-1 text-sm text-muted">{twitch.account}</p>}{twitch.detail && <p className="mt-2 text-xs text-red-300">{twitch.detail}</p>}{missingModeration && <p className="mt-2 text-xs text-amber-300">Reconnect once to enable all moderation features.</p>}</div></div><div className="flex shrink-0 gap-2">{missingModeration && <Button variant="primary" onClick={runtime.reauthorizeTwitch}><ShieldCheck size={14}/>Update permissions</Button>}{twitch.phase === 'connected' ? <Button variant="danger" onClick={runtime.disconnectTwitch}>Disconnect</Button> : <Button variant="primary" disabled={twitchBusy || !isTauri()} onClick={runtime.connectTwitch}>{twitchBusy ? <LoaderCircle className="animate-spin" size={15}/> : <Link2 size={15}/>}Connect Twitch</Button>}</div></div>
      {runtime.deviceAuth && <div className="mt-5 rounded-xl border border-violet-500/30 bg-violet-500/[.06] p-4"><div className="text-xs text-muted">Enter this code in the Twitch page opened in your browser</div><div className="mt-2 font-mono text-2xl font-semibold tracking-[.16em]">{runtime.deviceAuth.code}</div><Button className="mt-3" onClick={() => openUrl(runtime.deviceAuth!.url)}><ExternalLink size={14}/>Open Twitch activation</Button></div>}
    </Card>
    <Card className="p-5"><div className="flex items-start justify-between gap-6"><div className="flex gap-4"><div className="grid size-11 place-items-center rounded-xl bg-cyan-400/10 text-cyan-300"><span className="text-lg font-bold">SE</span></div><div><div className="flex items-center gap-2"><h2 className="font-semibold">StreamElements</h2><Badge tone={phaseTone(streamElements.phase)}>{streamElements.phase}</Badge></div>{streamElements.detail && <p className="mt-2 text-xs text-red-300">{streamElements.detail}</p>}</div></div>{streamElements.phase === 'connected' ? <Button variant="danger" onClick={runtime.disconnectStreamElements}>Disconnect</Button> : null}</div>
      {streamElements.phase !== 'connected' && <div className="mt-5 max-w-2xl"><label className="label" htmlFor="se-token">StreamElements JWT</label><div className="mt-2 flex gap-2"><input id="se-token" className="input" type="password" autoComplete="off" placeholder="Paste your account JWT" value={token} onChange={(event) => setToken(event.target.value)}/><Button variant="primary" disabled={!token.trim() || seBusy || !isTauri()} onClick={async () => { await runtime.connectStreamElements(token); setToken('') }}>{seBusy ? <LoaderCircle className="animate-spin" size={15}/> : <CheckCircle2 size={15}/>}Connect</Button></div><p className="mt-2 text-xs leading-5 text-zinc-600">Dashboard → Account → Channels → JWT</p></div>}
    </Card>
  </div></>
}
