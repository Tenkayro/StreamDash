import { lazy, Suspense, useEffect } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { LoaderCircle } from 'lucide-react'
import { Sidebar } from './components/Sidebar'
import { TitleBar } from './components/TitleBar'
import { Dashboard } from './pages/Dashboard'
import { useAppStore } from './stores/app-store'
import { isTauri } from './lib/utils'

const StreamPage = lazy(() => import('./pages/StreamPage').then((module) => ({ default: module.StreamPage })))
const ChatPage = lazy(() => import('./pages/ChatPage').then((module) => ({ default: module.ChatPage })))
const ActivityPage = lazy(() => import('./pages/ActivityPage').then((module) => ({ default: module.ActivityPage })))
const Statistics = lazy(() => import('./pages/Statistics').then((module) => ({ default: module.Statistics })))
const Goals = lazy(() => import('./pages/Goals').then((module) => ({ default: module.Goals })))
const Connections = lazy(() => import('./pages/Connections').then((module) => ({ default: module.Connections })))
const SettingsPage = lazy(() => import('./pages/SettingsPage').then((module) => ({ default: module.SettingsPage })))
const pages: Record<string, React.ComponentType> = { dashboard: Dashboard, stream: StreamPage, chat: ChatPage, activity: ActivityPage, statistics: Statistics, goals: Goals, connections: Connections, settings: SettingsPage }
const loading = <div className="grid h-[60vh] place-items-center"><div className="flex items-center gap-3 text-sm text-muted"><LoaderCircle size={18} className="animate-spin"/>Preparing StreamDash…</div></div>
export default function App() {
  const { page, ready, settings } = useAppStore(); const Page = pages[page] ?? Dashboard
  useEffect(() => {
    if (!isTauri()) return
    const appWindow = getCurrentWindow(); let unlisten: (()=>void) | undefined
    appWindow.onCloseRequested(async (event) => { if (useAppStore.getState().settings.minimizeToTray) { event.preventDefault(); await appWindow.hide() } }).then((fn)=>unlisten=fn)
    return () => unlisten?.()
  }, [])
  const widths = { compact: 'max-w-[1180px]', wide: 'max-w-[1500px]', full: 'max-w-none' }
  return <div data-accent={settings.accentColor} data-density={settings.uiDensity} className={settings.animations ? '' : '[&_*]:!transition-none [&_.event-enter]:!animate-none'}><div className="flex h-screen flex-col bg-[#0b0c0f]"><TitleBar/><div className="flex min-h-0 flex-1"><Sidebar/><main className="min-w-0 flex-1 overflow-y-auto"><div className={`mx-auto ${widths[settings.contentWidth]} ${settings.uiDensity === 'compact' ? 'p-4' : 'p-6'}`}>{ready ? <Suspense fallback={loading}><Page/></Suspense> : loading}</div></main></div></div></div>
}
