import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { listen } from '@tauri-apps/api/event'
import { openUrl } from '@tauri-apps/plugin-opener'
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification'
import { toast } from 'sonner'
import { useAppStore } from '../stores/app-store'
import { errorMessage, isTauri, money } from '../lib/utils'
import { loadEvents, loadSettings, saveEvent, secretDelete, secretGet, secretSet, twitchNative } from './native'
import { loadTwitchSnapshot, TwitchEventSub, twitchClientId, TWITCH_SCOPES } from './twitch/client'
import { StreamElementsClient } from './streamelements/client'
import type { ActivityEvent } from '../types'

interface DeviceAuth { code: string; url: string; expiresAt: number }
interface RuntimeValue {
  deviceAuth?: DeviceAuth; connectTwitch: () => Promise<void>; disconnectTwitch: () => Promise<void>
  connectStreamElements: (token: string) => Promise<void>; disconnectStreamElements: () => Promise<void>; reconnect: () => Promise<void>
}
const RuntimeContext = createContext<RuntimeValue | null>(null)
export const useRuntime = () => useContext(RuntimeContext)!

export function RuntimeProvider({ children }: { children: ReactNode }) {
  const store = useAppStore(); const state = useAppStore.getState
  const twitchRef = useRef<TwitchEventSub>(); const seRef = useRef<StreamElementsClient>()
  const [deviceAuth, setDeviceAuth] = useState<DeviceAuth>()

  const ingest = useCallback(async (event: ActivityEvent) => {
    const current = state(); if (current.settings.disabledEventTypes.includes(event.eventType)) return
    if (!(await saveEvent(event, current.settings.maximumEvents))) return
    current.pushEvent(event)
    if (event.bits) current.setStats({ bits: current.stats.bits + event.bits })
    if (event.amount) current.setStats({ donations: current.stats.donations + event.amount, donationCurrency: event.currency })
    if (event.eventType === 'stream_online') current.setStats({ live: true, startedAt: event.timestamp })
    if (event.eventType === 'stream_offline') current.setStats({ live: false, viewers: 0, startedAt: undefined })
    const notify = current.settings.notifications && ((event.eventType === 'donation' && current.settings.notifyDonations) || (event.eventType === 'raid' && current.settings.notifyRaids) || (['gift_subscription','community_gift'].includes(event.eventType) && current.settings.notifyGiftSubs))
    if (notify && isTauri()) {
      let allowed = await isPermissionGranted(); if (!allowed) allowed = (await requestPermission()) === 'granted'
      if (allowed) sendNotification({ title: event.eventType === 'donation' ? `Donation · ${money(event.amount ?? 0, event.currency)}` : event.eventType.replaceAll('_', ' '), body: `${event.displayName || event.username || 'Someone'}${event.message ? ` — ${event.message}` : ''}` })
    }
  }, [state])

  const startTwitch = useCallback(async () => {
    if (!twitchClientId || !isTauri()) return
    try {
      const session = await twitchNative.session(twitchClientId)
      if (!session) { state().setTwitch({ phase: 'disconnected' }); return }
      twitchRef.current?.stop(); state().setTwitch({ phase: 'connecting', account: session.login })
      try { state().setStats(await loadTwitchSnapshot(session)) } catch (error) { toast.error('Some Twitch statistics are unavailable', { description: errorMessage(error) }) }
      twitchRef.current = new TwitchEventSub(session, ingest, (phase, detail) => state().setTwitch({ phase, account: session.login, detail }))
      twitchRef.current.start()
    } catch (error) { state().setTwitch({ phase: 'expired', detail: errorMessage(error) }) }
  }, [ingest, state])

  const startStreamElements = useCallback(async () => {
    if (!isTauri()) return
    try {
      const token = await secretGet('streamelements-token'); if (!token) { state().setStreamElements({ phase: 'disconnected' }); return }
      seRef.current?.stop(); state().setStreamElements({ phase: 'connecting' })
      seRef.current = new StreamElementsClient(token, ingest, (phase, detail) => state().setStreamElements({ phase, detail }))
      seRef.current.start()
    } catch (error) { state().setStreamElements({ phase: 'error', detail: errorMessage(error) }) }
  }, [ingest, state])

  const reconnect = useCallback(async () => { await Promise.all([startTwitch(), startStreamElements()]) }, [startTwitch, startStreamElements])

  useEffect(() => {
    let disposed = false; const unlisten: Array<() => void> = []
    ;(async () => {
      try { const [settings, events] = await Promise.all([loadSettings(), loadEvents()]); if (disposed) return; store.setSettings(settings); store.setEvents(events); store.setReady(true); await reconnect() }
      catch (error) { toast.error('StreamDash could not initialize', { description: errorMessage(error) }); store.setReady(true) }
      if (isTauri()) {
        unlisten.push(await listen('tray-reconnect', reconnect), await listen('tray-settings', () => state().setPage('settings')))
      }
    })()
    return () => { disposed = true; unlisten.forEach((f) => f()); twitchRef.current?.stop(); seRef.current?.stop() }
  }, []) // one application lifecycle

  const connectTwitch = async () => {
    if (!twitchClientId) { toast.error('Twitch Client ID is not configured', { description: 'Create .env from .env.example, then restart StreamDash.' }); return }
    try {
      state().setTwitch({ phase: 'connecting', detail: 'Waiting for authorization' })
      const device = await twitchNative.deviceStart(twitchClientId, TWITCH_SCOPES)
      setDeviceAuth({ code: device.user_code, url: device.verification_uri, expiresAt: Date.now() + device.expires_in * 1000 })
      await openUrl(device.verification_uri)
      let interval = Math.max(device.interval, 1) * 1000
      while (Date.now() < Date.now() + device.expires_in * 1000) {
        await new Promise((r) => setTimeout(r, interval))
        const result = await twitchNative.devicePoll(twitchClientId, device.device_code, TWITCH_SCOPES)
        if (result.status === 'authorized') { setDeviceAuth(undefined); toast.success('Twitch connected'); await startTwitch(); return }
        if (result.status === 'slow_down') interval += 5000
      }
      throw new Error('The Twitch authorization code expired')
    } catch (error) { setDeviceAuth(undefined); state().setTwitch({ phase: 'error', detail: errorMessage(error) }); toast.error('Could not connect Twitch', { description: errorMessage(error) }) }
  }
  const disconnectTwitch = async () => { twitchRef.current?.stop(); await secretDelete('twitch-oauth'); state().setTwitch({ phase: 'disconnected' }); state().setStats({ followers: undefined, subscribers: undefined, viewers: undefined, live: false, startedAt: undefined }) }
  const connectStreamElements = async (token: string) => { if (!token.trim()) return; await secretSet('streamelements-token', token.trim()); await startStreamElements() }
  const disconnectStreamElements = async () => { seRef.current?.stop(); await secretDelete('streamelements-token'); state().setStreamElements({ phase: 'disconnected' }) }

  return <RuntimeContext.Provider value={{ deviceAuth, connectTwitch, disconnectTwitch, connectStreamElements, disconnectStreamElements, reconnect }}>{children}</RuntimeContext.Provider>
}
