import { useEffect } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { LoaderCircle } from 'lucide-react'
import { Sidebar } from './components/Sidebar'
import { TitleBar } from './components/TitleBar'
import { Dashboard } from './pages/Dashboard'
import { ActivityPage } from './pages/ActivityPage'
import { Statistics } from './pages/Statistics'
import { Goals } from './pages/Goals'
import { Connections } from './pages/Connections'
import { SettingsPage } from './pages/SettingsPage'
import { StreamPage } from './pages/StreamPage'
import { ChatPage } from './pages/ChatPage'
import { useAppStore } from './stores/app-store'
import { isTauri } from './lib/utils'

const pages: Record<string, React.ComponentType> = { dashboard: Dashboard, stream: StreamPage, chat: ChatPage, activity: ActivityPage, statistics: Statistics, goals: Goals, connections: Connections, settings: SettingsPage }
export default function App() {
  const { page, ready, settings } = useAppStore(); const Page = pages[page] ?? Dashboard
  useEffect(() => {
    if (!isTauri()) return
    const appWindow = getCurrentWindow(); let unlisten: (()=>void) | undefined
    appWindow.onCloseRequested(async (event) => { if (useAppStore.getState().settings.minimizeToTray) { event.preventDefault(); await appWindow.hide() } }).then((fn)=>unlisten=fn)
    return () => unlisten?.()
  }, [])
  return <div className={settings.animations ? '' : '[&_*]:!transition-none [&_.event-enter]:!animate-none'}><div className="flex h-screen flex-col bg-[#0c0d10]"><TitleBar/><div className="flex min-h-0 flex-1"><Sidebar/><main className="min-w-0 flex-1 overflow-y-auto"><div className="mx-auto max-w-[1500px] p-6">{ready ? <Page/> : <div className="grid h-[60vh] place-items-center"><div className="flex items-center gap-3 text-sm text-muted"><LoaderCircle size={18} className="animate-spin"/>Preparing StreamDash…</div></div>}</div></main></div></div></div>
}
