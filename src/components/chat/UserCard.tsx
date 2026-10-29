import {
  Ban,
  Crown,
  ExternalLink,
  MessageSquare,
  ShieldCheck,
  ShieldOff,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { errorMessage } from "../../lib/utils";
import { saveSetting } from "../../services/native";
import { useRuntime } from "../../services/runtime-context";
import { useAppStore } from "../../stores/app-store";
import type { ChatMessage, ChatUserProfile } from "../../types";
import { LoadingIndicator, ScrollFade } from "../ui";
import { useTranslation } from "react-i18next";

const timeouts = [
  { label: "1s", seconds: 1 },
  { label: "30s", seconds: 30 },
  { label: "1m", seconds: 60 },
  { label: "5m", seconds: 300 },
  { label: "30m", seconds: 1800 },
  { label: "1h", seconds: 3600 },
  { label: "1d", seconds: 86400 },
  { label: "1w", seconds: 604800 },
];
function date(value: string | undefined, locale: string, unknown: string) {
  return value
    ? new Date(value).toLocaleDateString(locale, {
        year: "numeric",
        month: "short",
        day: "2-digit",
      })
    : unknown;
}

export function UserCard({
  login,
  messages,
  onClose,
  onMention,
}: {
  login: string;
  messages: ChatMessage[];
  onClose: () => void;
  onMention?: (name: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const runtime = useRuntime();
  const { settings, setSettings, twitch } = useAppStore();
  const [profile, setProfile] = useState<ChatUserProfile>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string>();
  const [reason, setReason] = useState("");
  const [openedAt] = useState(() => Date.now());
  const [note, setNote] = useState(settings.chatUserNotes[login] ?? "");
  const userMessages = useMemo(
    () => messages.filter((message) => message.login === login),
    [login, messages],
  );
  const badges =
    [...userMessages].reverse().find((message) => message.badges.length)
      ?.badges ?? [];
  const canBan = twitch.scopes?.includes("moderator:manage:banned_users");
  const canDelete = twitch.scopes?.includes("moderator:manage:chat_messages");
  const isSelf = login === twitch.account?.toLocaleLowerCase();
  const canManageModerators = twitch.scopes?.includes(
    "channel:manage:moderators",
  );
  const canManageVips = twitch.scopes?.includes("channel:manage:vips");
  const permanentlyBanned = Boolean(profile?.banned && !profile.bannedUntil);
  const hidden = settings.chatHiddenUsers.includes(login);
  const highlightsIgnored = settings.chatHighlightIgnoredUsers.includes(login);
  useEffect(() => {
    let active = true;
    void runtime
      .getChatUserProfile(login)
      .then((value) => {
        if (active) setProfile(value);
      })
      .catch((error) => {
        if (active)
          toast.error(t("userCard.profileLoadError"), {
            description: errorMessage(error),
          });
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [login, runtime, t]);
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);
  const updateList = async (
    key: "chatHiddenUsers" | "chatHighlightIgnoredUsers",
    enabled: boolean,
  ) => {
    const current = settings[key];
    const next = enabled
      ? [...new Set([...current, login])]
      : current.filter((item) => item !== login);
    setSettings({ [key]: next });
    try {
      await saveSetting(key, next);
    } catch (error) {
      setSettings({ [key]: current });
      toast.error(t("userCard.preferenceSaveError"), {
        description: errorMessage(error),
      });
    }
  };
  const saveNote = async () => {
    const previous = settings.chatUserNotes;
    const notes = { ...previous };
    if (note.trim()) notes[login] = note.trim();
    else delete notes[login];
    setSettings({ chatUserNotes: notes });
    try {
      await saveSetting("chatUserNotes", notes);
    } catch (error) {
      setSettings({ chatUserNotes: previous });
      toast.error(t("userCard.noteSaveError"), {
        description: errorMessage(error),
      });
    }
  };
  const moderate = async (
    action: "ban" | "unban" | "timeout",
    seconds?: number,
  ) => {
    if (!profile || busy) return;
    if (
      action === "ban" &&
      !confirm(t("userCard.banConfirm", { name: profile.displayName }))
    )
      return;
    setBusy(action);
    try {
      if (action === "unban") await runtime.unbanChatUser(profile.id);
      else await runtime.moderateChatUser(profile.id, seconds, reason);
      toast.success(
        action === "ban"
          ? t("userCard.bannedSuccess", { name: profile.displayName })
          : action === "unban"
            ? t("userCard.unbannedSuccess", { name: profile.displayName })
            : t("userCard.timeoutSuccess", { name: profile.displayName, duration: timeouts.find((item) => item.seconds === seconds)?.label }),
      );
      setProfile(await runtime.getChatUserProfile(login));
    } catch (error) {
      toast.error(t("userCard.moderationError", { action: t(`userCard.actions.${action}`) }), {
        description: errorMessage(error),
      });
    } finally {
      setBusy(undefined);
    }
  };
  const removeMessage = async (message: ChatMessage) => {
    if (message.deleted || message.id.startsWith("local-")) return;
    try {
      await runtime.deleteChatMessage(message.id);
      toast.success(t("userCard.messageDeleted"));
    } catch (error) {
      toast.error(t("userCard.messageDeleteError"), {
        description: errorMessage(error),
      });
    }
  };
  const changeRole = async (role: "moderator" | "vip", enabled: boolean) => {
    if (!profile || busy || isSelf) return;
    setBusy(role);
    let removedRole: "moderator" | "vip" | undefined;
    try {
      if (enabled && role === "moderator" && profile.vip) {
        await runtime.setChatUserRole(profile.id, "vip", false);
        removedRole = "vip";
      }
      if (enabled && role === "vip" && profile.moderator) {
        await runtime.setChatUserRole(profile.id, "moderator", false);
        removedRole = "moderator";
      }
      await runtime.setChatUserRole(profile.id, role, enabled);
      toast.success(
        t(enabled ? "userCard.roleAdded" : "userCard.roleRemoved", { name: profile.displayName, role: t(role === "vip" ? "userCard.vipRole" : "userCard.moderatorRole") }),
      );
      setProfile(await runtime.getChatUserProfile(login));
    } catch (error) {
      if (removedRole) {
        try {
          await runtime.setChatUserRole(profile.id, removedRole, true);
        } catch {
          /* best-effort rollback */
        }
      }
      toast.error(t("userCard.roleError"), {
        description: errorMessage(error),
      });
    } finally {
      setBusy(undefined);
    }
  };
  const canRemove = (message: ChatMessage) =>
    canDelete &&
    !isSelf &&
    !message.id.startsWith("local-") &&
    openedAt - message.timestamp < 6 * 60 * 60 * 1000 &&
    !message.badges.some(
      (badge) => badge.id === "broadcaster" || badge.id === "moderator",
    );

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/65 p-2 backdrop-blur-[2px] sm:p-5"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={t("userCard.dialogLabel", { login })}
        className="flex max-h-[calc(100vh-1rem)] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-zinc-700 bg-[#101115] shadow-2xl sm:max-h-[86vh]"
      >
        <header className="flex items-start gap-3 border-b border-line p-3 sm:gap-4 sm:p-4">
          {loading ? (
            <LoadingIndicator className="size-20 shrink-0" />
          ) : profile?.avatarUrl ? (
            <img
              src={profile.avatarUrl}
              alt=""
              className="size-14 rounded-lg object-cover sm:size-20"
            />
          ) : (
            <div className="grid size-14 shrink-0 place-items-center rounded-lg bg-white/5 text-zinc-600 sm:size-20">
              <UserRound size={28} />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-lg font-semibold">
                {loading ? (
                  <LoadingIndicator className="h-5 w-32" />
                ) : (
                  profile?.displayName || login
                )}
              </h2>
              {badges.map((badge) => (
                <img
                  key={`${badge.id}/${badge.version}`}
                  src={badge.url}
                  title={badge.id}
                  alt={badge.id}
                  className="h-4 w-auto"
                />
              ))}
              {profile?.moderator && (
                <span className="rounded bg-emerald-400/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300">
                  {t("userCard.moderator")}
                </span>
              )}
              {profile?.vip && (
                <span className="rounded bg-fuchsia-400/10 px-1.5 py-0.5 text-[10px] font-semibold text-fuchsia-300">
                  VIP
                </span>
              )}
              {profile?.banned && (
                <span className="rounded bg-red-400/10 px-1.5 py-0.5 text-[10px] font-semibold text-red-300">
                  {profile.bannedUntil
                    ? t("userCard.timedOutUntil", { time: new Date(profile.bannedUntil).toLocaleTimeString(i18n.language) })
                    : t("userCard.banned")}
                </span>
              )}
            </div>
            <div className="mt-0.5 text-xs text-muted">
              {loading ? (
                <LoadingIndicator className="h-3 w-20" />
              ) : (
                <>@{profile?.login || login}</>
              )}
            </div>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-zinc-500">
              <span>
                ID:{" "}
                {loading ? (
                  <LoadingIndicator className="h-2.5 w-20 align-middle" />
                ) : (
                  <span className="text-zinc-300">{profile?.id || "—"}</span>
                )}
              </span>
              <span>
                {t("userCard.created")}: {" "}
                {loading ? (
                  <LoadingIndicator className="h-2.5 w-16 align-middle" />
                ) : (
                  <span className="text-zinc-300">
                    {date(profile?.createdAt, i18n.language, t("userCard.unknown"))}
                  </span>
                )}
              </span>
              <span>
                {t("userCard.followsYou")}: {" "}
                {loading ? (
                  <LoadingIndicator className="h-2.5 w-14 align-middle" />
                ) : (
                  <span className="text-zinc-300">
                    {profile?.followedAt
                      ? t("userCard.since", { date: date(profile.followedAt, i18n.language, t("userCard.unknown")) })
                      : t("userCard.no")}
                  </span>
                )}
              </span>
              <span>
                {t("userCard.messages")}: {" "}
                <span className="text-zinc-300">{userMessages.length}</span>
              </span>
            </div>
            {profile?.banReason && (
              <div className="mt-2 text-[10px] text-red-300/70">
                {t("userCard.reason")}: {profile.banReason}
              </div>
            )}
          </div>
          <button
            aria-label={t("userCard.openProfile")}
            title={t("userCard.openProfile")}
            onClick={() => void openUrl(`https://www.twitch.tv/${login}`)}
            className="grid size-8 place-items-center rounded-lg text-zinc-500 hover:bg-white/5 hover:text-zinc-200"
          >
            <ExternalLink size={15} />
          </button>
          <button
            aria-label={t("userCard.close")}
            onClick={onClose}
            className="grid size-8 place-items-center rounded-lg text-zinc-500 hover:bg-white/5 hover:text-zinc-200"
          >
            <X size={17} />
          </button>
        </header>
        <div className="border-b border-line px-4 py-3">
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={hidden}
                onChange={(event) =>
                  void updateList("chatHiddenUsers", event.target.checked)
                }
              />
              {t("userCard.hideInChat")}
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={highlightsIgnored}
                onChange={(event) =>
                  void updateList(
                    "chatHighlightIgnoredUsers",
                    event.target.checked,
                  )
                }
              />
              {t("userCard.ignoreHighlights")}
            </label>
            {onMention && (
              <>
                <button
                  className="text-accent hover:brightness-125"
                  onClick={() => {
                    onMention(profile?.displayName || login);
                    onClose();
                  }}
                >
                  {t("userCard.mention")}
                </button>
                <span className="h-4 w-px bg-line" />
              </>
            )}
            <button
              disabled={!canManageVips || isSelf || Boolean(busy)}
              onClick={() => void changeRole("vip", !profile?.vip)}
              className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-medium disabled:opacity-30 ${profile?.vip ? "bg-fuchsia-400/15 text-fuchsia-300" : "bg-white/5 text-zinc-400 hover:text-fuchsia-300"}`}
            >
              <Crown size={13} />
              {profile?.vip ? t("userCard.removeVip") : t("userCard.makeVip")}
            </button>
            <button
              disabled={!canManageModerators || isSelf || Boolean(busy)}
              onClick={() => void changeRole("moderator", !profile?.moderator)}
              className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-medium disabled:opacity-30 ${profile?.moderator ? "bg-emerald-400/15 text-emerald-300" : "bg-white/5 text-zinc-400 hover:text-emerald-300"}`}
            >
              <ShieldCheck size={13} />
              {profile?.moderator ? t("userCard.removeMod") : t("userCard.makeMod")}
            </button>
          </div>
          <textarea
            className="input mt-3 min-h-16 resize-y py-2 text-xs"
            placeholder={t("userCard.notesPlaceholder")}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            onBlur={() => void saveNote()}
          />
        </div>
        <div className="border-b border-line p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-[.12em] text-zinc-600">
              {t("userCard.moderation")}
            </span>
            {(!canBan ||
              !canDelete ||
              !canManageModerators ||
              !canManageVips) && (
              <button
                className="text-[10px] text-amber-300"
                onClick={() => {
                  onClose();
                  useAppStore.getState().setPage("connections");
                }}
              >
                {t("userCard.reconnectPermissions")}
              </button>
            )}
          </div>
          <input
            className="input mb-2"
            maxLength={500}
            placeholder={t("userCard.reasonPlaceholder")}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
          <div className="flex items-end gap-2">
            <div className="text-center">
              <div className="mb-1 text-[10px] text-zinc-600">{t("userCard.unban")}</div>
              <button
                aria-label={t("userCard.unbanUser")}
                disabled={
                  !canBan || !profile?.banned || Boolean(busy) || isSelf
                }
                onClick={() => void moderate("unban")}
                className="grid h-9 w-10 place-items-center rounded-lg border border-line text-emerald-400 hover:bg-emerald-400/10 disabled:opacity-30"
              >
                <ShieldOff size={16} />
              </button>
            </div>
            <div className="flex-1">
              <div className="mb-1 text-center text-[10px] text-zinc-600">
                {t("userCard.timeouts")}
              </div>
              <div className="grid grid-cols-8">
                {timeouts.map((timeout) => (
                  <button
                    key={timeout.seconds}
                    disabled={
                      !canBan || Boolean(busy) || isSelf || permanentlyBanned
                    }
                    onClick={() => void moderate("timeout", timeout.seconds)}
                    className="h-9 border border-line text-xs text-zinc-300 first:rounded-l-lg last:rounded-r-lg hover:border-amber-500/50 hover:bg-amber-400/10 disabled:opacity-30"
                  >
                    {timeout.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="text-center">
              <div className="mb-1 text-[10px] text-zinc-600">{t("userCard.ban")}</div>
              <button
                aria-label={t("userCard.banUser")}
                disabled={
                  !canBan || Boolean(busy) || isSelf || permanentlyBanned
                }
                onClick={() => void moderate("ban")}
                className="grid h-9 w-10 place-items-center rounded-lg border border-line text-red-400 hover:bg-red-400/10 disabled:opacity-30"
              >
                <Ban size={16} />
              </button>
            </div>
          </div>
        </div>
        <div className="flex min-h-40 flex-1 flex-col overflow-hidden">
          <div className="border-b border-line px-4 py-2.5">
            <div className="flex items-center gap-2 text-xs font-semibold">
              <MessageSquare size={14} />
              {t("userCard.recentMessages")}
            </div>
          </div>
          <ScrollFade className="flex min-h-0 flex-1 flex-col" color="#101115" size={32}>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {userMessages.length ? (
                userMessages.map((message) => (
                  <div
                    key={message.id}
                    className={`group flex items-start gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-white/[.035] ${message.deleted ? "opacity-45" : ""}`}
                  >
                    <span className="shrink-0 text-[10px] tabular-nums text-zinc-600">
                      {new Date(message.timestamp).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    <span
                      className={`min-w-0 flex-1 wrap-break-word ${message.deleted ? "line-through" : ""}`}
                    >
                      {message.text}
                    </span>
                    {message.deleted ? (
                      <span className="text-[9px] uppercase text-zinc-600">
                        {t("userCard.deleted")}
                      </span>
                    ) : (
                      canRemove(message) && (
                        <button
                          title={t("userCard.deleteMessage")}
                          onClick={() => void removeMessage(message)}
                          className="invisible text-zinc-600 hover:text-red-300 group-hover:visible"
                        >
                          <Trash2 size={13} />
                        </button>
                      )
                    )}
                  </div>
                ))
              ) : (
                <div className="grid h-full place-items-center text-xs text-zinc-600">
                  {t("userCard.noMessages")}
                </div>
              )}
            </div>
          </ScrollFade>
        </div>
      </section>
    </div>
  );
}
