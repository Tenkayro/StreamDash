import {
  AtSign,
  ChevronDown,
  LoaderCircle,
  MessageSquare,
  Search,
  Send,
  Shield,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge, Button, Card, EmptyState, PageHeader, ScrollFade } from "../components/ui";
import { UserCard } from "../components/chat/UserCard";
import { errorMessage, isTauri } from "../lib/utils";
import { twitchNative } from "../services/native";
import { TWITCH_CLIENT_ID } from "../services/twitch/config";
import { useRuntime } from "../services/runtime-context";
import { useAppStore } from "../stores/app-store";
import type {
  AppSettings,
  ChatEmote,
  ChatMessage,
  ChatPart,
  ConnectionPhase,
} from "../types";
import { Trans, useTranslation } from "react-i18next";

function tone(phase: ConnectionPhase) {
  return phase === "connected"
    ? "green"
    : phase === "connecting" || phase === "reconnecting"
      ? "amber"
      : phase === "error" || phase === "expired"
        ? "red"
        : ("neutral" as const);
}
function formatTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}
function includesIgnoreCase(value: string, query: string) {
  return value.toLocaleLowerCase().includes(query.toLocaleLowerCase());
}
function isHighlighted(
  message: ChatMessage,
  account: string | undefined,
  settings: AppSettings,
) {
  if (settings.chatHighlightIgnoredUsers.includes(message.login)) return false;
  if (
    settings.chatHighlightMentions &&
    account &&
    new RegExp(
      `(^|\\W)@?${account.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=\\W|$)`,
      "i",
    ).test(message.text)
  )
    return true;
  return settings.chatHighlightWords.some(
    (word) => word && includesIgnoreCase(message.text, word),
  );
}

function Parts({ parts, emoteSize }: { parts: ChatPart[]; emoteSize: number }) {
  return (
    <>
      {parts.map((part, index) =>
        part.type === "text" ? (
          <span key={index}>{part.text}</span>
        ) : (
          <span
            key={index}
            className="relative mx-0.5 inline-flex items-center align-middle"
            style={{ height: emoteSize }}
          >
            {part.layers.map((layer, layerIndex) => (
              <img
                key={layerIndex}
                src={layer.url}
                alt={layer.name}
                title={layer.name}
                draggable={false}
                loading="lazy"
                className={
                  layerIndex === 0
                    ? "h-full w-auto"
                    : "absolute left-1/2 top-1/2 h-full max-h-full max-w-none -translate-x-1/2 -translate-y-1/2"
                }
              />
            ))}
          </span>
        ),
      )}
    </>
  );
}

function ChatRow({
  message,
  account,
  settings,
  onUser,
}: {
  message: ChatMessage;
  account?: string;
  settings: AppSettings;
  onUser: (login: string) => void;
}) {
  const { t } = useTranslation();
  const highlighted = isHighlighted(message, account, settings);
  return (
    <div
      className={`group relative flex gap-2 border-l-2 px-3 py-1 leading-6 transition-colors ${message.deleted ? "border-transparent opacity-40" : highlighted ? "border-amber-400 bg-amber-400/8 hover:bg-amber-400/12" : message.firstMessage ? "border-sky-500 bg-sky-400/[.035] hover:bg-sky-400/[.07]" : "border-transparent hover:bg-white/[.035]"}`}
    >
      {settings.chatTimestamps && (
        <span className="w-10 shrink-0 pt-0.5 text-right text-[10px] tabular-nums text-zinc-600">
          {formatTime(message.timestamp)}
        </span>
      )}
      <div
        className="min-w-0 flex-1 whitespace-pre-wrap wrap-break-word"
        style={{ fontSize: settings.chatFontSize }}
      >
        {message.reply && (
          <div className="mb-0.5 truncate border-l border-zinc-700 pl-2 text-[10px] leading-4 text-zinc-600">
            {t("chat.replyingTo")}{" "}
            <span className="text-zinc-400">{message.reply.displayName}</span>:{" "}
            {message.reply.body}
          </div>
        )}
        {settings.chatBadges &&
          message.badges.map((badge) => (
            <img
              key={`${badge.id}/${badge.version}`}
              src={badge.url}
              alt={badge.id}
              title={badge.id}
              loading="lazy"
              className="mr-1 inline-block h-4 w-auto align-[-3px]"
            />
          ))}
        <button
          className="font-semibold hover:underline"
          style={{ color: message.color }}
          title={t("activity.openUser", { name: message.login })}
          onClick={() => onUser(message.login)}
        >
          {message.displayName}
        </button>
        {message.firstMessage && (
          <span className="ml-1 rounded bg-sky-400/10 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-sky-300">
            {t("chat.first")}
          </span>
        )}
        <span className="text-zinc-500">{message.action ? " " : ": "}</span>
        <span
          className={`${message.action ? "italic " : ""}${message.deleted ? "line-through" : ""}`}
        >
          <Parts parts={message.parts} emoteSize={settings.chatEmoteSize} />
        </span>
        {message.deleted && (
          <span className="ml-2 text-[9px] uppercase text-zinc-600">
            {t("userCard.deleted")}
          </span>
        )}
      </div>
    </div>
  );
}

type CompletionItem = {
  name: string;
  url?: string;
  source: "7tv" | "twitch" | "user";
};
interface Completion {
  kind: "emote" | "user";
  start: number;
  end: number;
  items: CompletionItem[];
}
function getCompletion(
  value: string,
  cursor: number,
  emotes: ChatEmote[],
  users: string[],
): Completion | undefined {
  const before = value.slice(0, cursor);
  const start = Math.max(before.lastIndexOf(" "), before.lastIndexOf("\n")) + 1;
  const token = before.slice(start);
  let kind: Completion["kind"];
  let query: string;
  if (token.startsWith(":")) {
    kind = "emote";
    query = token.slice(1).replace(/:$/, "");
  } else if (token.startsWith("@")) {
    kind = "user";
    query = token.slice(1);
  } else return undefined;
  if (!query) return undefined;
  const lower = query.toLocaleLowerCase();
  const candidates: CompletionItem[] =
    kind === "emote"
      ? emotes.map((emote) => ({
          name: emote.name,
          url: emote.url,
          source: emote.source,
        }))
      : users.map((name) => ({ name, source: "user" as const }));
  const items = candidates
    .filter((item) => item.name.toLocaleLowerCase().includes(lower))
    .sort((left, right) => {
      const leftPrefix = left.name.toLocaleLowerCase().startsWith(lower)
        ? 0
        : 1;
      const rightPrefix = right.name.toLocaleLowerCase().startsWith(lower)
        ? 0
        : 1;
      return (
        leftPrefix - rightPrefix ||
        left.name.length - right.name.length ||
        left.name.localeCompare(right.name)
      );
    })
    .slice(0, 8);
  return items.length ? { kind, start, end: cursor, items } : undefined;
}

export function ChatPage() {
  const { t } = useTranslation();
  const {
    chat,
    chatEmotes,
    chatMessages,
    clearChat,
    setPage,
    settings,
    twitch,
  } = useAppStore();
  const runtime = useRuntime();
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const previousCount = useRef(chatMessages.length);
  const [stick, setStick] = useState(true);
  const [unread, setUnread] = useState(0);
  const [draft, setDraft] = useState("");
  const [cursor, setCursor] = useState(0);
  const [sending, setSending] = useState(false);
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [selected, setSelected] = useState(0);
  const [dismissedDraft, setDismissedDraft] = useState<string>();
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [selectedUser, setSelectedUser] = useState<string>();
  const [shield, setShield] = useState<{
    account?: string;
    active: boolean;
  }>();
  const [shieldBusy, setShieldBusy] = useState(false);
  const missingScope = Boolean(
    twitch.phase === "connected" &&
    !["chat:read", "chat:edit"].every((scope) =>
      twitch.scopes?.includes(scope),
    ),
  );
  const canManageShield = Boolean(
    twitch.scopes?.includes("moderator:manage:shield_mode"),
  );
  const shieldActive =
    shield && shield.account === twitch.account ? shield.active : undefined;
  const users = useMemo(
    () =>
      [
        ...new Set(
          [...chatMessages].reverse().map((message) => message.displayName),
        ),
      ].slice(0, 250),
    [chatMessages],
  );
  const completion = useMemo(
    () =>
      dismissedDraft === draft
        ? undefined
        : getCompletion(draft, cursor, chatEmotes, users),
    [chatEmotes, cursor, dismissedDraft, draft, users],
  );
  const visibleMessages = useMemo(
    () =>
      chatMessages.filter(
        (message) =>
          !settings.chatHiddenUsers.includes(message.login) &&
          (!search ||
            includesIgnoreCase(
              `${message.displayName} ${message.login} ${message.text}`,
              search,
            )),
      ),
    [chatMessages, search, settings.chatHiddenUsers],
  );

  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  useEffect(() => {
    if (
      twitch.phase !== "connected" ||
      !twitch.userId ||
      !canManageShield
    )
      return;
    let active = true;
    void twitchNative
      .helix<{ data?: Array<{ is_active?: boolean }> }>(
        TWITCH_CLIENT_ID,
        "moderation/shield_mode",
        [
          ["broadcaster_id", twitch.userId],
          ["moderator_id", twitch.userId],
        ],
      )
      .then((response) => {
        if (active)
          setShield({
            account: twitch.account,
            active: Boolean(response.data?.[0]?.is_active),
          });
      })
      .catch(() => {
        /* The action itself still reports useful API errors when used. */
      });
    return () => {
      active = false;
    };
  }, [canManageShield, twitch]);
  useEffect(() => {
    const added = Math.max(0, chatMessages.length - previousCount.current);
    previousCount.current = chatMessages.length;
    const list = listRef.current;
    if (list && stick) {
      list.scrollTop = list.scrollHeight;
      setUnread(0);
    } else if (added) setUnread((count) => count + added);
  }, [chatMessages, stick]);

  const onScroll = () => {
    const list = listRef.current;
    if (!list) return;
    const atBottom =
      list.scrollHeight - list.scrollTop - list.clientHeight < 48;
    setStick(atBottom);
    if (atBottom) setUnread(0);
  };
  const jumpToLatest = () => {
    setStick(true);
    setUnread(0);
    requestAnimationFrame(() => {
      if (listRef.current)
        listRef.current.scrollTop = listRef.current.scrollHeight;
    });
  };
  const mention = (name: string) => {
    const prefix = draft && !draft.endsWith(" ") ? `${draft} ` : draft;
    const next = `${prefix}@${name} `;
    setDraft(next);
    setCursor(next.length);
    inputRef.current?.focus();
  };
  const chooseCompletion = (item: CompletionItem) => {
    if (!completion) return;
    const insertion =
      completion.kind === "user" ? `@${item.name} ` : `${item.name} `;
    const next =
      draft.slice(0, completion.start) +
      insertion +
      draft.slice(completion.end);
    const nextCursor = completion.start + insertion.length;
    setDraft(next);
    setCursor(nextCursor);
    setDismissedDraft(undefined);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(nextCursor, nextCursor);
    });
  };

  const submit = async (event?: React.FormEvent) => {
    event?.preventDefault();
    const message = draft.trim();
    if (!message || sending) return;
    setDraft("");
    setCursor(0);
    setDismissedDraft(undefined);
    setHistory((items) =>
      [message, ...items.filter((item) => item !== message)].slice(0, 50),
    );
    setHistoryIndex(-1);
    inputRef.current?.focus();
    setStick(true);
    setSending(true);
    try {
      await runtime.sendChatMessage(message);
    } catch (error) {
      toast.error(t("chat.sendError"), {
        description: errorMessage(error),
      });
      setDraft((current) => current || message);
      setCursor(message.length);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };
  const onInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (
      completion &&
      ["ArrowDown", "ArrowUp", "Tab", "Enter", "Escape"].includes(event.key)
    ) {
      event.preventDefault();
      if (event.key === "ArrowDown")
        setSelected((index) => (index + 1) % completion.items.length);
      else if (event.key === "ArrowUp")
        setSelected(
          (index) =>
            (index - 1 + completion.items.length) % completion.items.length,
        );
      else if (event.key === "Escape") setDismissedDraft(draft);
      else chooseCompletion(completion.items[selected] ?? completion.items[0]);
      return;
    }
    if (event.key === "ArrowUp" && history.length) {
      event.preventDefault();
      const index = Math.min(history.length - 1, historyIndex + 1);
      setHistoryIndex(index);
      setDraft(history[index]);
      setCursor(history[index].length);
    } else if (event.key === "ArrowDown" && historyIndex >= 0) {
      event.preventDefault();
      const index = historyIndex - 1;
      setHistoryIndex(index);
      const value = index >= 0 ? history[index] : "";
      setDraft(value);
      setCursor(value.length);
    }
  };

  const toggleShield = async () => {
    if (!canManageShield) {
      setPage("connections");
      return;
    }
    if (!twitch.userId || shieldActive == null || shieldBusy) return;
    const next = !shieldActive;
    setShieldBusy(true);
    try {
      const response = await twitchNative.helixPut<{
        data?: Array<{ is_active?: boolean }>;
      }>(
        TWITCH_CLIENT_ID,
        "moderation/shield_mode",
        [
          ["broadcaster_id", twitch.userId],
          ["moderator_id", twitch.userId],
        ],
        { is_active: next },
      );
      const active = response.data?.[0]?.is_active ?? next;
      setShield({ account: twitch.account, active });
      toast.success(active ? t("chat.shieldEnabled") : t("chat.shieldDisabled"));
    } catch (error) {
      toast.error(t("chat.shieldError"), {
        description: errorMessage(error),
      });
    } finally {
      setShieldBusy(false);
    }
  };

  const header = (
    <PageHeader
      icon={MessageSquare}
      title={t("chat.title")}
      actions={
        <div className="flex items-center gap-1.5">
      <Badge tone={tone(chat.phase)}>{t(`connectionPhases.${chat.phase}`)}</Badge>
          {twitch.phase === "connected" && (
            <Button
              variant={shieldActive ? "danger" : "ghost"}
              title={
                canManageShield
                  ? shieldActive
                    ? t("chat.disableShield")
                    : t("chat.enableShield")
                  : t("chat.reconnectShield")
              }
              onClick={() => void toggleShield()}
              disabled={shieldBusy || (canManageShield && shieldActive == null)}
            >
              {shieldBusy || (canManageShield && shieldActive == null) ? (
                <LoaderCircle size={14} className="animate-spin" />
              ) : (
                <Shield size={14} />
              )}
              {shieldActive ? t("chat.shieldOn") : t("chat.shield")}
            </Button>
          )}
          <Button
            variant={searchOpen ? "primary" : "ghost"}
            onClick={() => setSearchOpen((open) => !open)}
          >
            <Search size={14} />
          </Button>
          <Button
            variant="ghost"
            disabled={chatMessages.length === 0}
            onClick={() => {
              setStick(true);
              setUnread(0);
              clearChat();
            }}
          >
            <Trash2 size={14} />
            {t("chat.clear")}
          </Button>
        </div>
      }
    />
  );
  if (twitch.phase !== "connected")
    return (
      <>
        {header}
        <Card>
          <EmptyState
            icon={<MessageSquare size={22} />}
            title={t("stream.notConnected")}
            body={t("chat.notConnectedDetail")}
            action={
              <Button variant="primary" onClick={() => setPage("connections")}>
                {t("chat.openConnections")}
              </Button>
            }
          />
        </Card>
      </>
    );

  return (
    <>
      {header}
      {missingScope && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-400/6 px-3 py-2 text-xs leading-5 text-amber-200">
          <span className="min-w-0 flex-1 basis-72">
            <Trans i18nKey="chat.permissions" components={{ read: <span className="font-mono" />, edit: <span className="font-mono" /> }} />
          </span>
          <Button onClick={() => setPage("connections")}>{t("chat.reconnect")}</Button>
        </div>
      )}
      {chat.detail && chat.phase === "error" && (
        <p className="mb-3 px-1 text-xs text-red-300">{chat.detail}</p>
      )}
      <Card className="flex h-[calc(100vh-145px)] min-h-72 flex-col overflow-hidden">
        <div className="flex min-h-10 items-center justify-between gap-3 border-b border-line px-3">
          {searchOpen ? (
            <div className="relative flex-1">
              <Search
                size={13}
                className="absolute left-2.5 top-2.5 text-zinc-600"
              />
              <input
                autoFocus
                className="h-8 w-full bg-transparent pl-8 pr-8 text-xs outline-none"
                placeholder={t("chat.filterPlaceholder")}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              {search && (
                <button
                  className="absolute right-2 top-2 text-zinc-600 hover:text-zinc-300"
                  onClick={() => setSearch("")}
                >
                  <X size={14} />
                </button>
              )}
            </div>
          ) : (
            <div className="text-[11px] text-muted">
              #{twitch.account} <span className="text-zinc-700">•</span>{" "}
              {t("chat.emoteCount", { count: chatEmotes.length })}{" "}
              <span className="text-zinc-700">•</span>{" "}
              {t("chat.messageCount", { count: chatMessages.length })}
            </div>
          )}
          {search && (
            <span className="shrink-0 text-[10px] text-zinc-600">
              {t("chat.matchCount", { count: visibleMessages.length })}
            </span>
          )}
        </div>
        <ScrollFade className="flex min-h-0 flex-1 flex-col" color="#121318" size={36}>
          <div
            ref={listRef}
            onScroll={onScroll}
            className="min-h-0 flex-1 overflow-y-auto py-1"
          >
            {visibleMessages.length === 0 ? (
              <div className="grid h-full place-items-center px-6 text-center text-sm text-muted">
                {search
                  ? t("chat.noMatches")
                  : chat.phase === "connecting" || chat.phase === "reconnecting"
                    ? t("chat.connecting")
                    : t("chat.waitingFirstMessage")}
              </div>
            ) : (
              visibleMessages.map((message) => (
                <ChatRow
                  key={message.id}
                  message={message}
                  account={twitch.account}
                  settings={settings}
                  onUser={setSelectedUser}
                />
              ))
            )}
          </div>
        </ScrollFade>
        {!stick && (
          <button
            className="mx-auto -mb-3 flex -translate-y-4 items-center gap-1.5 rounded-full border border-line bg-raised px-3 py-1.5 text-[11px] shadow-xl hover:border-zinc-600"
            onClick={jumpToLatest}
          >
            <ChevronDown size={13} />
            {unread
              ? t("chat.newMessages", { count: unread })
              : t("chat.jumpLatest")}
          </button>
        )}
        <div className="relative border-t border-line p-2.5">
          {completion && (
            <ScrollFade
              className="absolute bottom-[calc(100%-1px)] left-2.5 right-2.5 z-20 overflow-hidden rounded-lg border border-line bg-raised shadow-2xl"
              color="#17181e"
              size={28}
            >
              <div className="max-h-64 overflow-y-auto p-1">
                {completion.items.map((item, index) => (
                  <button
                    key={`${item.source}-${item.name}`}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      chooseCompletion(item);
                    }}
                    className={`flex h-9 w-full items-center gap-2 rounded-md px-2 text-left text-xs ${index === selected ? "bg-accent-soft text-white" : "text-zinc-400 hover:bg-white/5"}`}
                  >
                    {item.url ? (
                      <img
                        src={item.url}
                        alt=""
                        className="size-7 object-contain"
                      />
                    ) : (
                      <span className="grid size-7 place-items-center">
                        <AtSign size={15} />
                      </span>
                    )}
                    <span className="min-w-0 flex-1 truncate font-medium">
                      {item.name}
                    </span>
                    <span className="text-[9px] uppercase text-zinc-600">
                      {item.source}
                    </span>
                  </button>
                ))}
              </div>
            </ScrollFade>
          )}
          <form className="flex gap-2" onSubmit={submit}>
            <input
              ref={inputRef}
              className="input"
              placeholder={t("chat.messagePlaceholder", { account: twitch.account })}
              value={draft}
              maxLength={500}
              autoComplete="off"
              disabled={!isTauri()}
              onChange={(event) => {
                setDraft(event.target.value);
                setCursor(
                  event.target.selectionStart ?? event.target.value.length,
                );
                setSelected(0);
                setDismissedDraft(undefined);
                setHistoryIndex(-1);
              }}
              onClick={(event) =>
                setCursor(event.currentTarget.selectionStart ?? draft.length)
              }
              onKeyDown={onInputKeyDown}
            />
            <Button
              variant="primary"
              type="submit"
              disabled={!draft.trim() || sending || !isTauri()}
            >
              {sending ? (
                <LoaderCircle size={15} className="animate-spin" />
              ) : (
                <Send size={15} />
              )}
              {t("chat.send")}
            </Button>
          </form>
          <div className="mt-1.5 flex justify-between px-1 text-[9px] text-zinc-700">
            <span>
              {t("chat.inputHint")}
            </span>
            <span>{draft.length}/500</span>
          </div>
        </div>
      </Card>
      {selectedUser && (
        <UserCard
          login={selectedUser}
          messages={chatMessages}
          onClose={() => setSelectedUser(undefined)}
          onMention={mention}
        />
      )}
    </>
  );
}
