import { MessageSquare, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Badge, Button, Card, EmptyState, PageHeader } from '../components/ui'
import { useAppStore } from '../stores/app-store'
import type { ChatMessage, ChatPart, ConnectionPhase } from '../types'

function tone(phase: ConnectionPhase) {
  return phase === 'connected' ? 'green' : phase === 'connecting' || phase === 'reconnecting' ? 'amber' : phase === 'error' || phase === 'expired' ? 'red' : 'neutral' as const
}

function formatTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function Parts({ parts }: { parts: ChatPart[] }) {
  return <>{parts.map((part, index) => part.type === 'text'
    ? <span key={index}>{part.text}</span>
    : <span key={index} className="relative mx-0.5 inline-flex items-center align-middle">
        {part.layers.map((layer, layerIndex) => <img key={layerIndex} src={layer.url} alt={layer.name} title={layer.name} draggable={false} loading="lazy" className={layerIndex === 0 ? 'h-7 w-auto' : 'absolute left-1/2 top-1/2 h-full max-h-full max-w-none -translate-x-1/2 -translate-y-1/2'}/>)}
      </span>)}</>
}

function ChatRow({ message }: { message: ChatMessage }) {
  return <div className="flex gap-2 px-3 py-[3px] leading-6 hover:bg-white/[.03]">
    <span className="shrink-0 pt-0.5 text-[10px] tabular-nums text-zinc-600">{formatTime(message.timestamp)}</span>
    <div className="min-w-0 whitespace-pre-wrap break-words text-[13px]">
      {message.badges.map((badge) => <img key={`${badge.id}/${badge.version}`} src={`https://static-cdn.jtvnw.net/badges/v1/${badge.id}/${badge.version}/1`} alt={badge.id} title={badge.id} loading="lazy" className="mr-1 inline-block h-4 w-auto align-[-3px]"/>)}
      <span className="font-semibold" style={{ color: message.color }} title={message.login}>{message.displayName}</span>
      <span className="text-zinc-500">: </span>
      <Parts parts={message.parts}/>
    </div>
  </div>
}

export function ChatPage() {
  const { chat, chatMessages, clearChat, setPage, twitch } = useAppStore()
  const listRef = useRef<HTMLDivElement>(null)
  const [stick, setStick] = useState(true)

  useEffect(() => {
    const list = listRef.current
    if (list && stick) list.scrollTop = list.scrollHeight
  }, [chatMessages, stick])

  const onScroll = () => {
    const list = listRef.current
    if (list) setStick(list.scrollHeight - list.scrollTop - list.clientHeight < 48)
  }

  const header = <PageHeader title="Chat" description="Live Twitch chat with 7TV emotes, read-only and without extra tokens." actions={<div className="flex items-center gap-2"><Badge tone={tone(chat.phase)}>{chat.phase}</Badge><Button variant="ghost" disabled={chatMessages.length === 0} onClick={() => { setStick(true); clearChat() }}><Trash2 size={14}/>Clear</Button></div>}/>

  if (twitch.phase !== 'connected') return <>{header}<Card><EmptyState icon={<MessageSquare size={22}/>} title="Twitch is not connected" body="Connect your Twitch account first. StreamDash joins your channel chat anonymously, so no chat messages are ever sent from your account." action={<Button variant="primary" onClick={() => setPage('connections')}>Open Connections</Button>}/></Card></>

  return <>{header}
    {chat.detail && chat.phase === 'error' && <p className="mb-3 px-1 text-xs text-red-300">{chat.detail}</p>}
    <Card className="flex h-[calc(100vh-170px)] min-h-72 flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <div className="text-xs text-muted">#{twitch.account} · 7TV channel and global emotes</div>
        {!stick && <button className="text-[11px] text-violet-300 hover:text-violet-200" onClick={() => setStick(true)}>Jump to latest</button>}
      </div>
      <div ref={listRef} onScroll={onScroll} className="flex-1 overflow-y-auto py-1">
        {chatMessages.length === 0
          ? <div className="grid h-full place-items-center px-6 text-center text-sm text-muted">{chat.phase === 'connecting' || chat.phase === 'reconnecting' ? 'Connecting to Twitch chat…' : 'Waiting for the first chat message…'}</div>
          : chatMessages.map((message) => <ChatRow key={message.id} message={message}/>)}
      </div>
    </Card>
  </>
}
