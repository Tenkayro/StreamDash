import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { listen } from '@tauri-apps/api/event'
import { openUrl } from '@tauri-apps/plugin-opener'
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification'
import { toast } from 'sonner'
import { useAppStore } from '../stores/app-store'
import { errorMessage, isTauri, money } from '../lib/utils'
import { loadEvents, loadSettings, saveEvent, secretDelete, secretGet, secretSet, twitchNative } from './native'
import { loadTwitchSnapshot, TwitchEventSub, TWITCH_SCOPES } from './twitch/client'
import { StreamElementsClient } from './streamelements/client'
import type { ActivityEvent } from '../types'
import { RuntimeContext, type DeviceAuth } from './runtime-context'

export function RuntimeProvider({ children }: { children: ReactNode }) {
  const setSettings = useAppStore((s) => s.setSettings); const setEvents = useAppStore((s) => s.setEvents); const setReady = useAppStore((s) => s.setReady); const state = useAppStore.getState
  const twitchRef = useRef<TwitchEventSub | undefined>(undefined); const seRef = useRef<StreamElementsClient | undefined>(undefined)
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
    const clientId = state().settings.twitchClientId.trim()
    if (!clientId || !isTauri()) { state().setTwitch({ phase: 'disconnected', detail: clientId ? undefined : 'Client ID nicht eingerichtet' }); return }
    try {
      const session = await twitchNative.session(clientId)
      if (!session) { state().setTwitch({ phase: 'disconnected' }); return }
      twitchRef.current?.stop(); state().setTwitch({ phase: 'connecting', account: session.login, userId: session.userId, scopes: session.scopes })
      try { state().setStats(await loadTwitchSnapshot(clientId, session)) } catch (error) { toast.error('Some Twitch statistics are unavailable', { description: errorMessage(error) }) }
      twitchRef.current = new TwitchEventSub(clientId, session, ingest, (phase, detail) => state().setTwitch({ phase, account: session.login, userId: session.userId, scopes: session.scopes, detail }))
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
      try { const settings = await loadSettings(); const events = await loadEvents(settings.maximumEvents ?? 5000); if (disposed) return; setSettings(settings); setEvents(events); const bits = events.reduce((n,e)=>n+(e.bits??0),0); const donations = events.reduce((n,e)=>n+(e.amount??0),0); state().setStats({ bits, donations, donationCurrency: events.find((e)=>e.currency)?.currency }); setReady(true); await reconnect() }
      catch (error) { toast.error('StreamDash could not initialize', { description: errorMessage(error) }); setReady(true) }
      if (isTauri()) {
        unlisten.push(await listen('tray-reconnect', reconnect), await listen('tray-settings', () => state().setPage('settings')))
      }
    })()
    return () => { disposed = true; unlisten.forEach((f) => f()); twitchRef.current?.stop(); seRef.current?.stop() }
  }, [reconnect, setEvents, setReady, setSettings, state])

  const connectTwitch = async () => {
    const clientId = state().settings.twitchClientId.trim()
    if (!clientId) { state().setPage('settings'); toast.error('Twitch Client ID ist nicht eingerichtet', { description: 'Trage sie unter Einstellungen → Twitch ein.' }); return }
    try {
      state().setTwitch({ phase: 'connecting', detail: 'Waiting for authorization' })
      const device = await twitchNative.deviceStart(clientId, TWITCH_SCOPES)
      setDeviceAuth({ code: device.user_code, url: device.verification_uri, expiresAt: Date.now() + device.expires_in * 1000 })
      await openUrl(device.verification_uri)
      let interval = Math.max(device.interval, 1) * 1000
      const expiresAt = Date.now() + device.expires_in * 1000
      while (Date.now() < expiresAt) {
        await new Promise((r) => setTimeout(r, interval))
        const result = await twitchNative.devicePoll(clientId, device.device_code, TWITCH_SCOPES)
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
