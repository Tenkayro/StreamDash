import {
  ChevronDown,
  Dices,
  Gift,
  LoaderCircle,
  MessageSquare,
  Play,
  RotateCcw,
  Send,
  Settings2,
  ShieldAlert,
  Square,
  Trash2,
  Trophy,
  UserRound,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { UserCard } from "../components/chat/UserCard";
import { resolveLanguage } from "../i18n";
import {
  Badge,
  Button,
  Card,
  LoadingIndicator,
  PageHeader,
  ScrollFade,
  Toggle,
} from "../components/ui";
import { cn, errorMessage, isTauri } from "../lib/utils";
import { useRuntime } from "../services/runtime-context";
import { useAppStore } from "../stores/app-store";
import type {
  ChatMessage,
  ChatPart,
  ChatUserProfile,
  GiveawayEntry,
} from "../types";

function formatTimeWithSeconds(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function formatFullDateTime(value: string | undefined, locale: string, fallback: string) {
  if (!value) return fallback;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return fallback;
  return parsed.toLocaleString(locale, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function ChatParts({
  parts,
  emoteSize,
}: {
  parts: ChatPart[];
  emoteSize: number;
}) {
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

function pickWeightedWinner(
  entries: GiveawayEntry[],
  subscriberLuck: number,
  excludeLogin?: string,
): GiveawayEntry | undefined {
  if (!entries.length) return undefined;
  const pool =
    entries.length > 1 && excludeLogin
      ? entries.filter((entry) => entry.login !== excludeLogin.toLowerCase())
      : entries;
  const candidates = pool.length ? pool : entries;
  const multiplier = Math.max(1, subscriberLuck);
  const weights = candidates.map((entry) => (entry.subscriber ? multiplier : 1));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  let random = Math.random() * totalWeight;
  for (let index = 0; index < candidates.length; index++) {
    random -= weights[index];
    if (random <= 0) return candidates[index];
  }
  return candidates[candidates.length - 1];
}

export function GiveawaysPage() {
  const { t, i18n } = useTranslation();
  const runtime = useRuntime();
  const {
    chat,
    chatMessages,
    giveaway,
    setGiveaway,
    removeGiveawayEntry,
    clearGiveawayEntries,
    pruneInactiveGiveawayEntries,
    settings,
    twitch,
    setPage,
  } = useAppStore();

  const [userSearch, setUserSearch] = useState("");
  const [view, setView] = useState<"settings" | "winner">(() =>
    giveaway.winner ? "winner" : "settings",
  );
  const prevWinnerLoginRef = useRef<string | undefined>(giveaway.winner?.login);
  useEffect(() => {
    const nextLogin = giveaway.winner?.login;
    if (nextLogin === prevWinnerLoginRef.current) return;
    prevWinnerLoginRef.current = nextLogin;
    setView(nextLogin ? "winner" : "settings");
  }, [giveaway.winner?.login]);
  const [winnerProfile, setWinnerProfile] = useState<ChatUserProfile>();
  const [winnerProfileLoading, setWinnerProfileLoading] = useState(false);
  const [selectedUser, setSelectedUser] = useState<string>();
  const [chatDraft, setChatDraft] = useState("");
  const [chatSending, setChatSending] = useState(false);
  const [chatStick, setChatStick] = useState(true);
  const chatListRef = useRef<HTMLDivElement>(null);
  const winnerMessagesRef = useRef<HTMLDivElement>(null);

  const filteredEntries = useMemo(() => {
    const query = userSearch.trim().toLocaleLowerCase();
    if (!query) return giveaway.entries;
    return giveaway.entries.filter(
      (entry) =>
        entry.displayName.toLocaleLowerCase().includes(query) ||
        entry.login.toLocaleLowerCase().includes(query),
    );
  }, [giveaway.entries, userSearch]);

  const visibleChatMessages = useMemo(
    () =>
      chatMessages.filter(
        (message) =>
          !message.deleted && !settings.chatHiddenUsers.includes(message.login),
      ),
    [chatMessages, settings.chatHiddenUsers],
  );

  const winnerMessages = useMemo(() => {
    const winnerLogin = giveaway.winner?.login.toLowerCase();
    if (!winnerLogin) return [];
    return chatMessages.filter(
      (message) =>
        !message.deleted && message.login.toLowerCase() === winnerLogin,
    );
  }, [chatMessages, giveaway.winner?.login]);

  useEffect(() => {
    const list = chatListRef.current;
    if (list && chatStick) {
      list.scrollTop = list.scrollHeight;
    }
  }, [visibleChatMessages, chatStick]);

  useEffect(() => {
    const box = winnerMessagesRef.current;
    if (box) {
      box.scrollTop = box.scrollHeight;
    }
  }, [winnerMessages]);

  useEffect(() => {
    const winnerLogin = giveaway.winner?.login;
    if (!winnerLogin || twitch.phase !== "connected") {
      setWinnerProfile(undefined);
      setWinnerProfileLoading(false);
      return;
    }
    let active = true;
    setWinnerProfileLoading(true);
    void runtime
      .getChatUserProfile(winnerLogin)
      .then((profile) => {
        if (active) setWinnerProfile(profile);
      })
      .catch(() => {
        if (active) setWinnerProfile(undefined);
      })
      .finally(() => {
        if (active) setWinnerProfileLoading(false);
      });
    return () => {
      active = false;
    };
  }, [giveaway.winner?.login, runtime, twitch.phase]);

  const toggleRunning = async () => {
    const nextRunning = !giveaway.running;
    setGiveaway({ running: nextRunning });
    if (nextRunning && giveaway.chatAnnouncements && twitch.phase === "connected") {
      const lng = resolveLanguage(settings.language);
      const announcement =
        giveaway.type === "keyword" && giveaway.keyword.trim()
          ? t("giveaways.startAnnouncementKeyword", {
              lng,
              keyword: giveaway.keyword.trim(),
            })
          : t("giveaways.startAnnouncementActive", { lng });
      await runtime.sendBotChatMessage(announcement).catch(() => undefined);
    }
  };

  const rollWinner = async (isReroll = false) => {
    pruneInactiveGiveawayEntries();
    const currentEntries = useAppStore.getState().giveaway.entries;
    if (!currentEntries.length) {
      toast.error(t("giveaways.noEntriesError"));
      return;
    }
    const picked = pickWeightedWinner(
      currentEntries,
      giveaway.subscriberLuck,
      isReroll ? giveaway.winner?.login : undefined,
    );
    if (!picked) return;
    setGiveaway({ winner: picked });
    setView("winner");
    if (giveaway.chatAnnouncements && twitch.phase === "connected") {
      const lng = resolveLanguage(settings.language);
      const announcement = t("giveaways.winnerAnnouncement", {
        lng,
        user: picked.displayName,
      });
      await runtime.sendBotChatMessage(announcement).catch((error) => {
        toast.error(t("chat.sendError"), {
          description: errorMessage(error),
        });
      });
    }
  };

  const onChatScroll = () => {
    const list = chatListRef.current;
    if (!list) return;
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
    setChatStick(atBottom);
  };

  const submitChat = async (event: React.FormEvent) => {
    event.preventDefault();
    const message = chatDraft.trim();
    if (!message || chatSending) return;
    setChatDraft("");
    setChatStick(true);
    setChatSending(true);
    try {
      await runtime.sendChatMessage(message);
    } catch (error) {
      toast.error(t("chat.sendError"), {
        description: errorMessage(error),
      });
      setChatDraft((current) => current || message);
    } finally {
      setChatSending(false);
    }
  };

  const isMessageHighlighted = (message: ChatMessage) => {
    if (
      giveaway.winner &&
      message.login.toLowerCase() === giveaway.winner.login.toLowerCase()
    ) {
      return true;
    }
    if (
      giveaway.running &&
      giveaway.type === "keyword" &&
      giveaway.keyword.trim() &&
      message.text
        .toLocaleLowerCase()
        .includes(giveaway.keyword.trim().toLocaleLowerCase())
    ) {
      return true;
    }
    return false;
  };

  const winnerIsVip =
    winnerProfile?.vip ||
    giveaway.winner?.badges.some((badge) => badge.id === "vip");
  const winnerIsMod =
    winnerProfile?.moderator ||
    giveaway.winner?.badges.some((badge) => badge.id === "moderator");
  const winnerIsBroadcaster = giveaway.winner?.badges.some(
    (badge) => badge.id === "broadcaster",
  );

  return (
    <>
      <PageHeader icon={Gift} title={t("giveaways.title")} />

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-2.5 md:grid-cols-[minmax(210px,0.8fr)_minmax(320px,1.35fr)_minmax(250px,1fr)] md:grid-rows-[minmax(0,1fr)]">
        {/* Left column: Users */}
        <Card className="flex min-h-0 flex-col overflow-hidden">
          <div className="flex h-9 shrink-0 items-center justify-between border-b border-rule bg-shell/70 px-3">
            <h2 className="studio-label">{t("giveaways.users")}</h2>
            <span className="studio-mono text-[11px] font-medium text-muted">
              {t("giveaways.userCount", { count: giveaway.entries.length })}
            </span>
          </div>

          <div className="border-b border-rule bg-shell/40 p-2">
            <div className="flex items-center gap-1.5">
              <input
                id="giveaway-user-search"
                aria-label={t("giveaways.searchUsers")}
                className="input h-8 min-h-8 min-w-0 flex-1 text-xs"
                placeholder={t("giveaways.searchUsers")}
                value={userSearch}
                onChange={(event) => setUserSearch(event.target.value)}
              />
              <button
                type="button"
                title={t("giveaways.resetUsers")}
                aria-label={t("giveaways.resetUsers")}
                disabled={
                  giveaway.entries.length === 0 &&
                  giveaway.disqualifiedUsers.length === 0 &&
                  !giveaway.winner
                }
                onClick={() => {
                  clearGiveawayEntries();
                  setView("settings");
                }}
                className="grid size-8 shrink-0 place-items-center rounded-lg border border-rule bg-well text-muted transition hover:border-rule-strong hover:text-ink-strong disabled:pointer-events-none disabled:opacity-40"
              >
                <RotateCcw size={13} />
              </button>
            </div>
          </div>

          <ScrollFade
            className="flex min-h-0 flex-1 flex-col"
            color="var(--color-panel)"
            size={24}
          >
            <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
              {filteredEntries.length === 0 ? (
                <div className="grid h-full place-items-center px-3 py-6 text-center text-xs text-muted">
                  {giveaway.entries.length === 0
                    ? t("giveaways.emptyUsers")
                    : t("giveaways.noMatchingUsers")}
                </div>
              ) : (
                <div className="space-y-0.5">
                  {filteredEntries.map((entry) => {
                    const isWinner =
                      giveaway.winner?.login.toLowerCase() === entry.login;
                    return (
                      <div
                        key={entry.login}
                        className={cn(
                          "flex items-center justify-between gap-2 rounded-lg border px-2 py-1 text-xs transition",
                          isWinner
                            ? "border-accent-border bg-accent-soft"
                            : "border-transparent hover:bg-well",
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => setSelectedUser(entry.login)}
                          className="flex min-w-0 flex-1 items-center gap-1.5 text-left font-medium hover:underline"
                        >
                          <span className="truncate text-ink-strong">
                            {entry.displayName}
                          </span>
                          {entry.subscriber && (
                            <span className="studio-mono shrink-0 rounded border border-accent-border bg-accent-soft px-1.5 py-0.5 text-[9.5px] font-semibold uppercase text-accent">
                              Sub
                            </span>
                          )}
                        </button>
                        <button
                          type="button"
                          title={t("giveaways.removeUser", {
                            name: entry.displayName,
                          })}
                          aria-label={t("giveaways.removeUser", {
                            name: entry.displayName,
                          })}
                          onClick={() => removeGiveawayEntry(entry.login)}
                          className="grid size-6 shrink-0 place-items-center rounded-md border border-rule bg-well text-red-400 transition hover:border-red-500/40 hover:bg-red-500/15 hover:text-red-300"
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </ScrollFade>
        </Card>

        {/* Middle column: Settings or Winner */}
        <Card className="flex min-h-0 flex-col overflow-hidden">
          <div className="flex h-9 shrink-0 items-center justify-between border-b border-rule bg-shell/70 px-3.5">
            <h2 className="studio-label">
              {view === "winner" && giveaway.winner
                ? t("giveaways.winnerTitle")
                : t("giveaways.settings")}
            </h2>
            {giveaway.winner && (
              <button
                type="button"
                onClick={() =>
                  setView(view === "winner" ? "settings" : "winner")
                }
                className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-medium text-accent transition hover:bg-accent-soft"
              >
                {view === "winner" ? (
                  <>
                    <Settings2 size={12} />
                    {t("giveaways.settings")}
                  </>
                ) : (
                  <>
                    <Trophy size={12} />
                    {giveaway.winner.displayName}
                  </>
                )}
              </button>
            )}
          </div>

          {view === "winner" && giveaway.winner ? (
            <div className="flex min-h-0 flex-1 flex-col p-3">
              <div className="flex items-center justify-between gap-3 rounded-[10px] border border-accent-border bg-accent-soft/75 p-3">
                <div className="flex min-w-0 items-center gap-3">
                  {winnerProfileLoading ? (
                    <LoadingIndicator className="size-11 shrink-0 rounded-full" />
                  ) : winnerProfile?.avatarUrl ? (
                    <img
                      src={winnerProfile.avatarUrl}
                      alt={giveaway.winner.displayName}
                      className="size-11 shrink-0 rounded-full border border-rule-strong object-cover"
                    />
                  ) : (
                    <div className="grid size-11 shrink-0 place-items-center rounded-full border border-rule bg-well text-subtle">
                      <UserRound size={20} />
                    </div>
                  )}

                  <div className="min-w-0 flex-1">
                    <div className="studio-label text-accent">
                      {t("giveaways.theWinnerIs")}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setSelectedUser(giveaway.winner!.login)}
                        className="truncate text-sm font-semibold text-ink-strong hover:underline"
                      >
                        {giveaway.winner.displayName}
                      </button>
                      {winnerIsBroadcaster && (
                        <Badge tone="red">STREAMER</Badge>
                      )}
                      {winnerIsVip && <Badge tone="purple">VIP</Badge>}
                      {winnerIsMod && <Badge tone="green">MOD</Badge>}
                      {giveaway.winner.subscriber && (
                        <Badge tone="amber">SUB</Badge>
                      )}
                    </div>

                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted">
                      <span>
                        {t("giveaways.accountAge", {
                          date: formatFullDateTime(
                            winnerProfile?.createdAt,
                            i18n.language,
                            t("userCard.unknown"),
                          ),
                        })}
                      </span>
                      <span>
                        {t("giveaways.followAge", {
                          date: winnerProfile?.followedAt
                            ? formatFullDateTime(
                                winnerProfile.followedAt,
                                i18n.language,
                                t("userCard.unknown"),
                              )
                            : t("giveaways.notFollowing"),
                        })}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-2.5 flex items-center justify-between text-[11px] font-medium text-muted">
                <span className="studio-label">{t("giveaways.messages")}</span>
                <span className="studio-mono">{winnerMessages.length}</span>
              </div>

              <div
                ref={winnerMessagesRef}
                className="mt-1 min-h-0 flex-1 overflow-y-auto rounded-[10px] border border-rule bg-well p-2.5 font-sans text-xs"
              >
                {winnerMessages.length === 0 ? (
                  <div className="grid h-full place-items-center text-xs text-muted">
                    {t("giveaways.noWinnerMessages")}
                  </div>
                ) : (
                  <div className="space-y-1">
                    {winnerMessages.map((message) => (
                      <div
                        key={message.id}
                        className="flex items-baseline gap-2 leading-5"
                      >
                        <span className="studio-mono shrink-0 text-[11px] text-subtle">
                          {formatTimeWithSeconds(message.timestamp)}
                        </span>
                        <span className="min-w-0 flex-1 wrap-break-word text-ink">
                          <ChatParts
                            parts={message.parts}
                            emoteSize={settings.chatEmoteSize}
                          />
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <Button
                variant="primary"
                className="mt-2.5 h-8 min-h-8 w-full shrink-0 justify-center text-xs font-semibold"
                disabled={giveaway.entries.length === 0}
                onClick={() => void rollWinner(true)}
              >
                <Dices size={14} />
                {t("giveaways.reroll")}
              </Button>
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col justify-between p-2.5">
              <div className="space-y-1.5">
                {/* Status + Chat Announcements row */}
                <div className="flex items-center justify-between gap-2 rounded-[10px] border border-rule bg-well/80 px-2.5 py-1.5">
                  <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-medium text-ink-strong">
                    <Toggle
                      value={giveaway.chatAnnouncements}
                      onChange={(chatAnnouncements) =>
                        setGiveaway({ chatAnnouncements })
                      }
                      label={t("giveaways.chatAnnouncements")}
                    />
                    <span>{t("giveaways.chatAnnouncements")}</span>
                  </label>

                  <Button
                    variant={giveaway.running ? "primary" : "default"}
                    onClick={() => void toggleRunning()}
                    className="h-7 min-h-7 px-3 text-xs font-semibold"
                  >
                    {giveaway.running ? (
                      <>
                        <Square size={11} />
                        {t("giveaways.running")}
                      </>
                    ) : (
                      <>
                        <Play size={11} />
                        {t("giveaways.stopped")}
                      </>
                    )}
                  </Button>
                </div>

                {/* Mode + Keyword Phrase combined block */}
                <div className="rounded-[10px] border border-rule bg-well/80 px-2.5 py-2">
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center">
                    <div>
                      <div className="studio-label mb-1">
                        {t("giveaways.giveawayType")}
                      </div>
                      <div className="inline-flex rounded-lg border border-rule bg-panel p-0.5">
                        {(["active", "keyword"] as const).map((mode) => {
                          const active = giveaway.type === mode;
                          return (
                            <button
                              key={mode}
                              type="button"
                              onClick={() => setGiveaway({ type: mode })}
                              className={cn(
                                "rounded-md px-2.5 py-1 text-xs font-medium transition",
                                active
                                  ? "bg-accent text-white shadow-xs"
                                  : "text-muted hover:text-ink",
                              )}
                            >
                              {mode === "active"
                                ? t("giveaways.activeUsers")
                                : t("giveaways.keyword")}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div>
                      <label
                        htmlFor="giveaway-keyword"
                        className="studio-label mb-1 block"
                      >
                        {t("giveaways.keywordPhrase")}
                      </label>
                      <input
                        id="giveaway-keyword"
                        className="input studio-mono h-7 min-h-7 w-full text-xs disabled:opacity-45"
                        placeholder="!enter"
                        disabled={giveaway.type !== "keyword"}
                        value={giveaway.keyword}
                        onChange={(event) =>
                          setGiveaway({ keyword: event.target.value })
                        }
                      />
                    </div>
                  </div>
                </div>

                {/* Anti-spam slider */}
                <div className="rounded-[10px] border border-rule bg-well/80 px-2.5 py-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <label
                      htmlFor="giveaway-antispam"
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-strong"
                    >
                      <ShieldAlert size={12} className="text-accent" />
                      {t("giveaways.antiSpam")}
                    </label>
                    <span className="truncate text-[10px] text-muted">
                      {giveaway.disqualifiedUsers.length > 0
                        ? t("giveaways.disqualifiedCount", {
                            count: giveaway.disqualifiedUsers.length,
                          })
                        : giveaway.antiSpamLimit < 2
                          ? t("giveaways.antiSpamDisabled")
                          : t("giveaways.antiSpamEnabled", {
                              count: giveaway.antiSpamLimit,
                            })}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <input
                      type="range"
                      min={0}
                      max={10}
                      step={1}
                      disabled={giveaway.type !== "keyword"}
                      aria-label={t("giveaways.antiSpam")}
                      value={Math.min(10, giveaway.antiSpamLimit)}
                      onChange={(event) => {
                        const raw = Number(event.target.value) || 0;
                        const next =
                          raw === 1
                            ? giveaway.antiSpamLimit === 0
                              ? 2
                              : 0
                            : Math.max(0, Math.min(20, raw));
                        setGiveaway({ antiSpamLimit: next });
                      }}
                      className="h-1.5 min-w-0 flex-1 cursor-pointer appearance-none rounded-full bg-raised accent-accent disabled:cursor-not-allowed disabled:opacity-40"
                    />
                    <div className="flex h-6 w-15 shrink-0 items-center rounded-md border border-rule bg-panel px-1.5 text-xs">
                      <input
                        id="giveaway-antispam"
                        type="number"
                        min={0}
                        max={20}
                        disabled={giveaway.type !== "keyword"}
                        value={giveaway.antiSpamLimit}
                        onChange={(event) => {
                          const raw = Math.max(
                            0,
                            Math.min(20, Number(event.target.value) || 0),
                          );
                          setGiveaway({
                            antiSpamLimit: raw === 1 ? 2 : raw,
                          });
                        }}
                        className="studio-mono min-w-0 flex-1 bg-transparent text-right font-semibold text-ink-strong outline-none disabled:opacity-40"
                      />
                      <span className="studio-mono ml-1 text-[11px] text-subtle">×</span>
                    </div>
                  </div>
                </div>

                {/* Inactivity timeout */}
                <div className="rounded-[10px] border border-rule bg-well/80 px-2.5 py-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <label
                      htmlFor="giveaway-timeout"
                      className="text-xs font-semibold text-ink-strong"
                    >
                      {t("giveaways.inactivityTimeout")}
                    </label>
                    <span className="truncate text-[10px] text-muted">
                      {giveaway.inactivityTimeout === 0
                        ? t("giveaways.inactivityDisabled")
                        : t("giveaways.inactivityEnabled", {
                            seconds: giveaway.inactivityTimeout,
                          })}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <input
                      type="range"
                      min={0}
                      max={600}
                      step={5}
                      aria-label={t("giveaways.inactivityTimeout")}
                      value={Math.min(600, giveaway.inactivityTimeout)}
                      onChange={(event) =>
                        setGiveaway({
                          inactivityTimeout: Math.max(
                            0,
                            Number(event.target.value) || 0,
                          ),
                        })
                      }
                      className="h-1.5 min-w-0 flex-1 cursor-pointer appearance-none rounded-full bg-raised accent-accent"
                    />
                    <div className="flex h-6 w-15 shrink-0 items-center rounded-md border border-rule bg-panel px-1.5 text-xs">
                      <input
                        id="giveaway-timeout"
                        type="number"
                        min={0}
                        max={3600}
                        value={giveaway.inactivityTimeout}
                        onChange={(event) =>
                          setGiveaway({
                            inactivityTimeout: Math.max(
                              0,
                              Math.min(3600, Number(event.target.value) || 0),
                            ),
                          })
                        }
                        className="studio-mono min-w-0 flex-1 bg-transparent text-right font-semibold text-ink-strong outline-none"
                      />
                      <span className="studio-mono ml-1 text-[11px] text-subtle">s</span>
                    </div>
                  </div>
                </div>

                {/* Subscriber luck multiplier */}
                <div className="rounded-[10px] border border-rule bg-well/80 px-2.5 py-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <label
                      htmlFor="giveaway-luck"
                      className="text-xs font-semibold text-ink-strong"
                    >
                      {t("giveaways.subscriberLuck")}
                    </label>
                    <span className="truncate text-[10px] text-muted">
                      {giveaway.subscriberLuck <= 1
                        ? t("giveaways.subscriberLuckNormal")
                        : t("giveaways.subscriberLuckBoosted", {
                            multiplier: giveaway.subscriberLuck,
                          })}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <input
                      type="range"
                      min={1}
                      max={10}
                      step={1}
                      aria-label={t("giveaways.subscriberLuck")}
                      value={giveaway.subscriberLuck}
                      onChange={(event) =>
                        setGiveaway({
                          subscriberLuck: Math.max(
                            1,
                            Math.min(10, Number(event.target.value) || 1),
                          ),
                        })
                      }
                      className="h-1.5 min-w-0 flex-1 cursor-pointer appearance-none rounded-full bg-raised accent-accent"
                    />
                    <div className="flex h-6 w-15 shrink-0 items-center rounded-md border border-rule bg-panel px-1.5 text-xs">
                      <input
                        id="giveaway-luck"
                        type="number"
                        min={1}
                        max={10}
                        value={giveaway.subscriberLuck}
                        onChange={(event) =>
                          setGiveaway({
                            subscriberLuck: Math.max(
                              1,
                              Math.min(10, Number(event.target.value) || 1),
                            ),
                          })
                        }
                        className="studio-mono min-w-0 flex-1 bg-transparent text-right font-semibold text-ink-strong outline-none"
                      />
                      <span className="studio-mono ml-1 text-[11px] text-subtle">×</span>
                    </div>
                  </div>
                </div>
              </div>

              <Button
                variant="primary"
                className="mt-1.5 h-8 min-h-8 w-full shrink-0 justify-center text-xs font-semibold"
                disabled={giveaway.entries.length === 0}
                onClick={() => void rollWinner(false)}
              >
                <Dices size={14} />
                {t("giveaways.rollIt")}
              </Button>
            </div>
          )}
        </Card>

        {/* Right column: Minimalist Embedded Live Chat */}
        <Card className="flex min-h-0 flex-col overflow-hidden">
          <div className="flex h-9 shrink-0 items-center justify-between border-b border-rule bg-shell/70 px-3">
            <div className="flex items-center gap-2">
              <h2 className="studio-label">{t("chat.title")}</h2>
              {twitch.account && (
                <span className="studio-mono text-[11px] text-subtle">
                  #{twitch.account}
                </span>
              )}
            </div>
            <Badge
              tone={
                chat.phase === "connected"
                  ? "green"
                  : chat.phase === "connecting" || chat.phase === "reconnecting"
                    ? "amber"
                    : chat.phase === "error"
                      ? "red"
                      : "neutral"
              }
            >
              {t(`connectionPhases.${chat.phase}`)}
            </Badge>
          </div>

          {twitch.phase !== "connected" && visibleChatMessages.length === 0 ? (
            <div className="grid flex-1 place-items-center p-6 text-center">
              <div>
                <MessageSquare size={20} className="mx-auto mb-2 text-subtle" />
                <div className="text-xs font-medium text-ink-strong">
                  {t("stream.notConnected")}
                </div>
                <p className="mt-1 text-[11px] leading-4 text-muted">
                  {t("chat.notConnectedDetail")}
                </p>
                <Button
                  variant="primary"
                  className="mt-3"
                  onClick={() => setPage("connections")}
                >
                  {t("chat.openConnections")}
                </Button>
              </div>
            </div>
          ) : (
            <>
              <ScrollFade
                className="flex min-h-0 flex-1 flex-col"
                color="var(--color-panel)"
                size={28}
              >
                <div
                  ref={chatListRef}
                  onScroll={onChatScroll}
                  className="min-h-0 flex-1 overflow-y-auto py-1.5"
                >
                  {visibleChatMessages.length === 0 ? (
                    <div className="grid h-full place-items-center px-4 text-center text-xs text-muted">
                      {chat.phase === "connecting" ||
                      chat.phase === "reconnecting"
                        ? t("chat.connecting")
                        : t("chat.waitingFirstMessage")}
                    </div>
                  ) : (
                    visibleChatMessages.map((message) => {
                      const highlighted = isMessageHighlighted(message);
                      return (
                        <div
                          key={message.id}
                          className={cn(
                            "border-l-2 px-3 py-1 text-xs leading-5 transition-colors",
                            highlighted
                              ? "border-accent bg-accent-soft/70"
                              : "border-transparent hover:bg-well/70",
                          )}
                        >
                          {settings.chatBadges &&
                            message.badges.map((badge) => (
                              <img
                                key={`${badge.id}/${badge.version}`}
                                src={badge.url}
                                alt={badge.id}
                                title={badge.id}
                                loading="lazy"
                                className="mr-1 inline-block h-3.5 w-auto align-[-2px]"
                              />
                            ))}
                          <button
                            type="button"
                            onClick={() => setSelectedUser(message.login)}
                            style={{ color: message.color }}
                            className="font-semibold hover:underline"
                          >
                            {message.displayName}
                          </button>
                          <span className="text-subtle">
                            {message.action ? " " : ": "}
                          </span>
                          <span
                            className={cn(
                              "wrap-break-word text-ink",
                              message.action && "italic",
                            )}
                          >
                            <ChatParts
                              parts={message.parts}
                              emoteSize={Math.min(22, settings.chatEmoteSize)}
                            />
                          </span>
                        </div>
                      );
                    })
                  )}
                </div>
              </ScrollFade>

              {!chatStick && (
                <button
                  type="button"
                  onClick={() => {
                    setChatStick(true);
                    requestAnimationFrame(() => {
                      if (chatListRef.current) {
                        chatListRef.current.scrollTop =
                          chatListRef.current.scrollHeight;
                      }
                    });
                  }}
                  className="mx-auto -mb-2 flex -translate-y-3 items-center gap-1 rounded-full border border-rule-strong bg-raised px-2.5 py-1 text-[10px] font-medium text-ink shadow-lg hover:border-accent-border"
                >
                  <ChevronDown size={12} />
                  {t("chat.jumpLatest")}
                </button>
              )}

              <form
                onSubmit={submitChat}
                className="flex gap-1.5 border-t border-rule bg-shell/70 p-2"
              >
                <input
                  className="input h-8 min-h-8 min-w-0 flex-1 text-xs"
                  placeholder={t("giveaways.chatPlaceholder")}
                  value={chatDraft}
                  maxLength={500}
                  autoComplete="off"
                  disabled={
                    !isTauri() ||
                    twitch.phase !== "connected" ||
                    chat.phase !== "connected"
                  }
                  onChange={(event) => setChatDraft(event.target.value)}
                />
                <Button
                  variant="primary"
                  type="submit"
                  disabled={
                    !chatDraft.trim() ||
                    chatSending ||
                    !isTauri() ||
                    twitch.phase !== "connected" ||
                    chat.phase !== "connected"
                  }
                  className="h-8 min-h-8 shrink-0 px-3 text-xs"
                >
                  {chatSending ? (
                    <LoaderCircle size={13} className="animate-spin" />
                  ) : (
                    <Send size={13} />
                  )}
                  {t("chat.send")}
                </Button>
              </form>
            </>
          )}
        </Card>
      </div>

      {selectedUser && (
        <UserCard
          login={selectedUser}
          messages={chatMessages}
          onClose={() => setSelectedUser(undefined)}
        />
      )}
    </>
  );
}
