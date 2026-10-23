import { createContext, useContext } from 'react'

export interface DeviceAuth { code: string; url: string; expiresAt: number }
export interface RuntimeValue {
  deviceAuth?: DeviceAuth
  connectTwitch: () => Promise<void>
  disconnectTwitch: () => Promise<void>
  connectStreamElements: (token: string) => Promise<void>
  disconnectStreamElements: () => Promise<void>
  sendChatMessage: (text: string) => Promise<void>
  reconnect: () => Promise<void>
}
export const RuntimeContext = createContext<RuntimeValue | null>(null)
export const useRuntime = () => {
  const runtime = useContext(RuntimeContext)
  if (!runtime) throw new Error('RuntimeProvider is missing')
  return runtime
}
