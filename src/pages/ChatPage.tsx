import { useSearchFilter } from "../lib/search-navigation";
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
import { OfflineBanner } from "../components/OfflineBanner";
import { UserCard } from "../components/chat/UserCard";
import { resolveVariables, VARIABLE_DEFINITIONS } from "../lib/variables";
import { errorMessage, isTauri } from "../lib/utils";
import { spotifyOverlayNative, twitchNative } from "../services/native";
import { TWITCH_CLIENT_ID } from "../services/twitch/config";
import { useRuntime } from "../services/runtime-context";
import { useAppStore } from "../stores/app-store";
import { useNetworkStore } from "../stores/network-store";
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
      className={`group relative flex gap-2 border-l-2 px-3 py-1 leading-6 transition-colors ${message.deleted ? "border-transparent opacity-40" : highlighted ? "border-amber-400 bg-amber-400/8 hover:bg-amber-400/12" : message.firstMessage ? "border-sky-500 bg-sky-400/4 hover:bg-sky-400/8" : "border-transparent hover:bg-white/4"}`}
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
          <span className="ml-1 rounded bg-sky-400/10 px-1.5 py-0.5 text-[10px] font-medium text-sky-300">
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
          <span className="ml-2 text-[10px] text-subtle">
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
  source: "7tv" | "twitch" | "user" | "variable" | "custom";
  syntax?: "dollar" | "brace";
  preview?: string;
};
interface Completion {
  kind: "emote" | "user" | "variable";
  start: number;
  end: number;
  items: CompletionItem[];
}

const CHAT_PRIORITY_VARIABLES = new Set([
  "channel",
  "game",
  "title",
  "uptime",
  "viewers",
  "followers",
  "subscribers",
  "song",
  "obs.scene",
  "last.follower",
  "giveaway.status",
  "time",
]);

function getCompletion(
  value: string,
  cursor: number,
  emotes: ChatEmote[],
  users: string[],
  storeState: ReturnType<typeof useAppStore.getState>,
  songPreview?: string,
): Completion | undefined {
  const before = value.slice(0, cursor);
  const start = Math.max(before.lastIndexOf(" "), before.lastIndexOf("\n")) + 1;
  const token = before.slice(start);

  if (token.startsWith(":") || token.startsWith("@")) {
    const kind: Completion["kind"] = token.startsWith(":") ? "emote" : "user";
    const query =
      kind === "emote" ? token.slice(1).replace(/:$/, "") : token.slice(1);
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

  let varStart = -1;
  let syntax: "dollar" | "brace" | undefined;
  let query = "";

  const lastDollarParen = token.lastIndexOf("$(");
  const lastOpenBrace = token.lastIndexOf("{");

  if (lastDollarParen >= 0 && !token.slice(lastDollarParen).includes(")")) {
    varStart = start + lastDollarParen;
    syntax = "dollar";
    query = token.slice(lastDollarParen + 2);
  } else if (
    token.startsWith("$") &&
    !token.startsWith("$$") &&
    !/^\$\d/.test(token) &&
    !token.includes("(") &&
    !token.includes(")")
  ) {
    varStart = start;
    syntax = "dollar";
    query = token.slice(1);
  } else if (lastOpenBrace >= 0 && !token.slice(lastOpenBrace).includes("}")) {
    varStart = start + lastOpenBrace;
    syntax = "brace";
    query = token.slice(lastOpenBrace + 1);
  }

  if (!syntax || varStart < 0) return undefined;

  const lower = query.trim().toLocaleLowerCase();
  const varCtx = {
    state: storeState,
    user: storeState.twitch.account,
    userLogin: storeState.twitch.account,
    songText: songPreview,
    deterministicPreview: true,
  };
  const formatName = (key: string) =>
    syntax === "brace" ? `{${key}}` : `$(${key})`;

  const customCandidates = storeState.customVariables.map((custom) => {
    const tokenName = formatName(custom.name);
    return {
      key: custom.name,
      searchTerms: [custom.name.toLowerCase(), `custom.${custom.name.toLowerCase()}`],
      priority: 0,
      item: {
        name: tokenName,
        source: "custom" as const,
        syntax,
        preview: custom.value || "0",
      },
    };
  });

  const builtinCandidates = VARIABLE_DEFINITIONS.map((def) => {
    const tokenName = formatName(def.key);
    const preview = resolveVariables(def.token, varCtx);
    return {
      key: def.key,
      searchTerms: [
        def.key.toLowerCase(),
        ...(def.aliases?.map((alias) => alias.toLowerCase()) ?? []),
      ],
      priority: CHAT_PRIORITY_VARIABLES.has(def.key) ? 1 : 2,
      item: {
        name: tokenName,
        source: "variable" as const,
        syntax,
        preview: preview !== def.token ? preview : undefined,
      },
    };
  });

  const allCandidates = [...customCandidates, ...builtinCandidates];
  const matched = (
    lower
      ? allCandidates.filter((entry) =>
          entry.searchTerms.some((term) => term.includes(lower)),
        )
      : allCandidates
  )
    .sort((left, right) => {
      if (lower) {
        const leftPrefix = left.key.toLowerCase().startsWith(lower) ? 0 : 1;
        const rightPrefix = right.key.toLowerCase().startsWith(lower) ? 0 : 1;
        if (leftPrefix !== rightPrefix) return leftPrefix - rightPrefix;
      }
      if (left.priority !== right.priority) return left.priority - right.priority;
      return left.key.length - right.key.length || left.key.localeCompare(right.key);
    })
    .slice(0, 10)
    .map((entry) => entry.item);

  if (!matched.length) return undefined;
  const closingChar = syntax === "dollar" ? ")" : "}";
  const end = value[cursor] === closingChar ? cursor + 1 : cursor;
  return { kind: "variable", start: varStart, end, items: matched };
}

export function ChatPage() {
  const { t } = useTranslation();
  const networkOnline = useNetworkStore((state) => state.online);
  const storeState = useAppStore();
  const {
    chat,
    chatEmotes,
    chatMessages,
    clearChat,
    setPage,
    settings,
    twitch,
  } = storeState;
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
  const [searchHit, setSearchHit] = useState<string>();
  const [searchOpen, setSearchOpen] = useState(false);
  const [selected, setSelected] = useState(0);
  const [dismissedDraft, setDismissedDraft] = useState<string>();
  const [songPreview, setSongPreview] = useState<string>();
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [selectedUser, setSelectedUser] = useState<string>();
  const [shield, setShield] = useState<{
    account?: string;
    active: boolean;
  }>();
  const [shieldBusy, setShieldBusy] = useState(false);
  useSearchFilter("chat", (value, itemId) => { setSearch(value); setSearchHit(itemId); setSearchOpen(true); });
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
        : getCompletion(
            draft,
            cursor,
            chatEmotes,
            users,
            storeState,
            songPreview,
          ),
    [chatEmotes, cursor, dismissedDraft, draft, songPreview, storeState, users],
  );
  const activeSelected = completion
    ? Math.min(selected, completion.items.length - 1)
    : 0;
  const needsSongPreview =
    completion?.kind === "variable" ||
    /\$\((?:spotify\.)?song\)|\{song\}/i.test(draft);
  const resolvedDraft = useMemo(() => {
    if (!/\$\([^)]+\)|\{[^}]+\}/.test(draft)) return undefined;
    const resolved = resolveVariables(draft, {
      state: storeState,
      user: twitch.account,
      userLogin: twitch.account,
      songText: songPreview,
      deterministicPreview: true,
    });
    return resolved !== draft ? resolved : undefined;
  }, [draft, songPreview, storeState, twitch.account]);
  const visibleMessages = useMemo(
    () =>
      chatMessages.filter(
        (message) =>
          !settings.chatHiddenUsers.includes(message.login) &&
          (searchHit ? message.id === searchHit : !search ||
            includesIgnoreCase(
              `${message.displayName} ${message.login} ${message.text}`,
              search,
            )),
      ),
    [chatMessages, search, searchHit, settings.chatHiddenUsers],
  );

  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  useEffect(() => {
    if (!needsSongPreview) return;
    let active = true;
    void spotifyOverlayNative
      .status()
      .then((song) => {
        if (!active) return;
        setSongPreview(
          song.available && song.title
            ? song.artist
              ? `${song.artist} — ${song.title}`
              : song.title
            : undefined,
        );
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [needsSongPreview]);
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
      else chooseCompletion(completion.items[activeSelected] ?? completion.items[0]);
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
              disabled={!networkOnline || shieldBusy || (canManageShield && shieldActive == null)}
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
  if (twitch.phase !== "connected" && !chatMessages.length)
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
      <OfflineBanner className="mb-3 shrink-0" />
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
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
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
                onChange={(event) => { setSearch(event.target.value); setSearchHit(undefined); }}
              />
              {search && (
                <button
                  className="absolute right-2 top-2 text-zinc-600 hover:text-zinc-300"
                  onClick={() => { setSearch(""); setSearchHit(undefined); }}
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
        <ScrollFade className="flex min-h-0 flex-1 flex-col" color="#242526" size={36}>
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
            className="mx-auto -mb-3 flex -translate-y-4 items-center gap-1.5 rounded-full border border-rule-strong bg-raised px-3 py-1.5 text-[11px] shadow-md hover:border-accent-border"
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
              color="#2c2d2e"
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
                    className={`flex h-9 w-full items-center gap-2 rounded-md px-2 text-left text-xs ${index === activeSelected ? "bg-accent-soft text-white" : "text-zinc-400 hover:bg-white/5"}`}
                  >
                    {item.url ? (
                      <img
                        src={item.url}
                        alt=""
                        className="size-7 object-contain"
                      />
                    ) : item.source === "variable" || item.source === "custom" ? (
                      <span
                        className={`grid size-7 shrink-0 place-items-center rounded-md border font-mono text-[10px] ${
                          item.source === "custom"
                            ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
                            : "border-accent/30 bg-accent/10 text-accent"
                        }`}
                      >
                        {item.syntax === "brace" ? "{ }" : "$()"}
                      </span>
                    ) : (
                      <span className="grid size-7 place-items-center">
                        <AtSign size={15} />
                      </span>
                    )}
                    <span
                      className={`truncate font-medium ${
                        item.source === "variable" || item.source === "custom"
                          ? "shrink-0 font-mono"
                          : "min-w-0 flex-1"
                      }`}
                    >
                      {item.name}
                    </span>
                    {item.preview && (
                      <span className="min-w-0 flex-1 truncate text-[11px] text-muted">
                        {item.preview}
                      </span>
                    )}
                    <span className="shrink-0 text-[10px] text-subtle">
                      {item.source === "custom"
                        ? t("chat.variableCustom")
                        : item.source === "variable"
                          ? t("chat.variableSource")
                          : item.source}
                    </span>
                  </button>
                ))}
              </div>
            </ScrollFade>
          )}
          {resolvedDraft && (
            <div className="mb-2 flex items-center gap-2 rounded-lg border border-line/70 bg-black/25 px-2.5 py-1.5 text-xs">
              <span className="shrink-0 text-[11px] font-medium text-accent">
                {t("chat.variablePreview")}
              </span>
              <span className="min-w-0 flex-1 truncate text-zinc-200" title={resolvedDraft}>
                {resolvedDraft}
              </span>
            </div>
          )}
          <form className="flex gap-2" onSubmit={submit}>
            <input
              ref={inputRef}
              className="input"
              placeholder={t("chat.messagePlaceholder", { account: twitch.account })}
              value={draft}
              maxLength={500}
              autoComplete="off"
              disabled={!networkOnline || !isTauri() || twitch.phase !== "connected" || chat.phase !== "connected"}
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
              onKeyUp={(event) => {
                if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
                  setCursor(event.currentTarget.selectionStart ?? draft.length);
                }
              }}
              onKeyDown={onInputKeyDown}
            />
            <Button
              variant="primary"
              type="submit"
              disabled={!networkOnline || !draft.trim() || sending || !isTauri() || twitch.phase !== "connected" || chat.phase !== "connected"}
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
            <span>{(resolvedDraft ?? draft).length}/500</span>
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
