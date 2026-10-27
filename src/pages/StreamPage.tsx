import {
  ExternalLink,
  Flag,
  Gamepad2,
  Languages,
  LoaderCircle,
  RadioTower,
  Save,
  Search,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  LoadingIndicator,
  PageHeader,
} from "../components/ui";
import { errorMessage, isTauri } from "../lib/utils";
import { twitchNative } from "../services/native";
import { TWITCH_CLIENT_ID } from "../services/twitch/config";
import { useRuntime } from "../services/runtime-context";
import { useAppStore } from "../stores/app-store";
import { Trans, useTranslation } from "react-i18next";

const MANAGE_SCOPE = "channel:manage:broadcast";
const LANGUAGES = [
  ["en", "English"],
  ["de", "Deutsch"],
  ["es", "Español"],
  ["fr", "Français"],
  ["it", "Italiano"],
  ["pt", "Português"],
  ["nl", "Nederlands"],
  ["pl", "Polski"],
  ["ru", "Русский"],
  ["tr", "Türkçe"],
  ["sv", "Svenska"],
  ["da", "Dansk"],
  ["fi", "Suomi"],
  ["no", "Norsk"],
  ["cs", "Čeština"],
  ["sk", "Slovenčina"],
  ["hu", "Magyar"],
  ["ro", "Română"],
  ["uk", "Українська"],
  ["el", "Ελληνικά"],
  ["bg", "Български"],
  ["ja", "日本語"],
  ["ko", "한국어"],
  ["zh", "中文"],
  ["th", "ไทย"],
  ["vi", "Tiếng Việt"],
  ["id", "Bahasa Indonesia"],
  ["ar", "العربية"],
  ["hi", "हिन्दी"],
  ["he", "עברית"],
].map(([value, label]) => ({ value, label }));

interface Channel {
  title: string;
  game_id: string;
  game_name: string;
  broadcaster_language: string;
}
interface Category {
  id: string;
  name: string;
  boxArt?: string;
}

function BoxArt({
  category,
  className,
}: {
  category?: Category;
  className: string;
}) {
  if (category?.boxArt)
    return (
      <img
        src={category.boxArt}
        alt=""
        className={`${className} rounded object-cover`}
      />
    );
  return (
    <div
      className={`${className} grid place-items-center rounded bg-white/5 text-zinc-600`}
    >
      <Gamepad2 size={15} />
    </div>
  );
}

export function StreamPage() {
  const { t, i18n } = useTranslation();
  const { stats, statsLoading, twitch, setStats } = useAppStore();
  const runtime = useRuntime();
  const clientId = TWITCH_CLIENT_ID;
  const connected =
    twitch.phase === "connected" && Boolean(twitch.userId);
  const busy = twitch.phase === "connecting" || twitch.phase === "reconnecting";
  const missingScope = connected && !twitch.scopes?.includes(MANAGE_SCOPE);

  const [saving, setSaving] = useState(false);
  const [marking, setMarking] = useState(false);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<Category>();
  const [language, setLanguage] = useState("en");
  const [query, setQuery] = useState("");
  const [lookup, setLookup] = useState<{ term: string; items: Category[] }>({
    term: "",
    items: [],
  });
  const [loadedFor, setLoadedFor] = useState<string>();

  const userId = twitch.userId;
  const busyLoading = connected && loadedFor !== userId;
  const term = query.trim();
  const showResults = connected && term.length >= 2;
  const searching = showResults && lookup.term !== term;

  useEffect(() => {
    if (!connected || !userId) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await twitchNative.helix<{ data: Channel[] }>(
          clientId,
          "channels",
          [["broadcaster_id", userId]],
        );
        if (cancelled) return;
        const channel = data[0];
        if (channel) {
          setTitle(channel.title);
          setCategory({ id: channel.game_id, name: channel.game_name });
          setLanguage(channel.broadcaster_language || "en");
        }
      } catch (error) {
        if (!cancelled)
          toast.error(t("stream.loadError"), {
            description: errorMessage(error),
          });
      } finally {
        if (!cancelled) setLoadedFor(userId);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clientId, connected, t, userId]);

  useEffect(() => {
    if (!connected || term.length < 2) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const { data } = await twitchNative.helix<{
          data: Array<{ id: string; name: string; box_art_url?: string }>;
        }>(clientId, "search/categories", [
          ["query", term],
          ["first", "8"],
        ]);
        if (!cancelled)
          setLookup({
            term,
            items: data.map((item) => ({
              id: item.id,
              name: item.name,
              boxArt: item.box_art_url?.replace("{width}x{height}", "46x62"),
            })),
          });
      } catch {
        if (!cancelled) setLookup({ term, items: [] });
      }
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [clientId, connected, term]);

  const save = async () => {
    if (!connected || !userId) return;
    const value = title.trim();
    if (!value) {
      toast.error(t("stream.enterTitle"));
      return;
    }
    if (value.length > 140) {
      toast.error(t("stream.titleTooLong"));
      return;
    }
    setSaving(true);
    try {
      await twitchNative.helixPatch(
        clientId,
        "channels",
        [["broadcaster_id", userId]],
        {
          title: value,
          ...(category ? { game_id: category.id } : {}),
          ...(language ? { broadcaster_language: language } : {}),
        },
      );
      setStats({ title: value, category: category?.name });
      toast.success(t("stream.updated"), {
        description: t("stream.updatedDetail"),
      });
    } catch (error) {
      toast.error(t("stream.updateError"), {
        description: errorMessage(error),
      });
    } finally {
      setSaving(false);
    }
  };

  const markStream = async () => {
    if (!connected || !userId || !stats.live || marking) return;
    setMarking(true);
    try {
      const result = await twitchNative.helixPost<{
        data?: Array<{ position_seconds?: number }>;
      }>(clientId, "streams/markers", [], { user_id: userId });
      const position = result.data?.[0]?.position_seconds;
      toast.success(t("stream.markerAdded"), {
        description:
          position == null
            ? t("stream.markerSaved")
            : t("stream.markerPosition", { position: `${Math.floor(position / 60)}:${String(position % 60).padStart(2, "0")}` }),
      });
    } catch (error) {
      toast.error(t("stream.markerError"), {
        description: errorMessage(error),
      });
    } finally {
      setMarking(false);
    }
  };

  const header = (
    <PageHeader
      icon={RadioTower}
      title={t("stream.title")}
      actions={
        <div className="flex items-center gap-1.5">
          {connected && (
            <Button
              variant="ghost"
              title={
                stats.live
                  ? t("stream.markMoment")
                  : t("stream.markersWhileLive")
              }
              disabled={statsLoading || !stats.live || marking || missingScope}
              onClick={() => void markStream()}
            >
              {marking ? (
                <LoaderCircle size={14} className="animate-spin" />
              ) : (
                <Flag size={14} />
              )}
              {t("stream.addMarker")}
            </Button>
          )}
          {statsLoading ? (
            <LoadingIndicator className="h-6 w-14" />
          ) : (
            <Badge tone={stats.live ? "green" : "neutral"}>
              {stats.live ? t("stream.live") : t("stream.offline")}
            </Badge>
          )}
        </div>
      }
    />
  );

  if (!connected)
    return (
      <>
        {header}
        <Card>
          {runtime.deviceAuth ? (
            <div className="p-5">
              <div className="text-xs text-muted">
                {t("connections.enterCode")}
              </div>
              <div className="mt-2 font-mono text-2xl font-semibold tracking-[.16em]">
                {runtime.deviceAuth.code}
              </div>
              <Button
                className="mt-3"
                onClick={() => openUrl(runtime.deviceAuth!.url)}
              >
                <ExternalLink size={14} />
                {t("connections.openActivation")}
              </Button>
            </div>
          ) : busy ? (
            <div className="flex min-h-52 items-center justify-center gap-2 text-sm text-muted">
              <LoaderCircle size={16} className="animate-spin" />
              {t("stream.waitingAuthorization")}
            </div>
          ) : (
            <EmptyState
              icon={<RadioTower size={22} />}
              title={t("stream.notConnected")}
              body={t("stream.notConnectedDetail")}
              action={
                <Button
                  variant="primary"
                  disabled={!isTauri()}
                  onClick={runtime.connectTwitch}
                >
                  {t("connections.connectTwitch")}
                </Button>
              }
            />
          )}
        </Card>
        {twitch.detail && (
          <p className="mt-3 px-1 text-xs text-red-300">{twitch.detail}</p>
        )}
      </>
    );

  return (
    <>
      {header}
      {missingScope && (
        <Card className="mb-4 flex items-start gap-3 border-amber-500/30 bg-amber-400/6 p-4">
          <TriangleAlert size={16} className="mt-0.5 shrink-0 text-amber-300" />
          <div className="flex-1">
            <div className="text-sm font-medium text-amber-200">
              {t("stream.permissionMissing")}
            </div>
            <p className="mt-1 text-xs leading-5 text-muted">
              <Trans i18nKey="stream.permissionDetail" components={{ scope: <span className="font-mono" /> }} />
            </p>
          </div>
          <Button onClick={runtime.connectTwitch}>
            <RadioTower size={14} />
            {t("stream.reconnectTwitch")}
          </Button>
        </Card>
      )}
      <div className="grid grid-cols-[1fr_300px] gap-4">
        <Card className="p-5">
          <label className="label" htmlFor="stream-title">
            {t("stream.streamTitle")}
          </label>
          <p className="mt-1 text-xs leading-5 text-muted">
            {t("stream.streamTitleDetail")}
          </p>
          <div className="relative mt-3">
            {busyLoading ? (
              <LoadingIndicator className="h-[34px] w-full" />
            ) : (
              <>
                <input
                  id="stream-title"
                  className="input input-trailing-wide"
                  maxLength={140}
                  autoComplete="off"
                  placeholder={t("stream.titlePlaceholder")}
                  value={title}
                  disabled={missingScope}
                  onChange={(event) => setTitle(event.target.value)}
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] tabular-nums text-zinc-600">
                  {title.length}/140
                </span>
              </>
            )}
          </div>

          <div className="mt-6">
            <label
              className="label inline-flex items-center gap-1.5"
              htmlFor="stream-category"
            >
              <Gamepad2 size={13} />
              {t("stream.category")}
            </label>
            <p className="mt-1 text-xs leading-5 text-muted">
              {t("stream.categoryDetail")}
            </p>
            {busyLoading ? (
              <div className="mt-3 flex items-center gap-3 rounded-xl border border-line bg-[#101116] p-2.5">
                <LoadingIndicator className="h-12 w-9 shrink-0" />
                <div className="flex-1">
                  <LoadingIndicator className="h-3.5 w-32" />
                  <LoadingIndicator className="mt-2 h-2.5 w-20" />
                </div>
              </div>
            ) : category && (
              <div className="mt-3 flex items-center gap-3 rounded-xl border border-line bg-[#101116] p-2.5">
                <BoxArt category={category} className="h-12 w-9" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">{category.name}</div>
                  <div className="mt-0.5 text-[11px] text-zinc-600">
                    {t("stream.currentCategory")}
                  </div>
                </div>
              </div>
            )}
            <div className="relative mt-3">
              {busyLoading ? (
                <LoadingIndicator className="h-[34px] w-full" />
              ) : (
                <>
              <Search
                size={14}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600"
              />
              <input
                id="stream-category"
                className="input input-leading-icon"
                autoComplete="off"
                spellCheck={false}
                placeholder={t("stream.categoryPlaceholder")}
                value={query}
                disabled={missingScope}
                onChange={(event) => setQuery(event.target.value)}
              />
              {showResults && (
                <div className="absolute z-10 mt-1 max-h-80 w-full overflow-y-auto rounded-xl border border-line bg-[#14151b] p-1 shadow-2xl shadow-black/40">
                  {searching && (
                    <div className="space-y-2 px-2 py-2">
                      {[0, 1, 2].map((item) => (
                        <div key={item} className="flex items-center gap-3">
                          <LoadingIndicator className="h-9 w-7 shrink-0" />
                          <LoadingIndicator
                            className={`h-3 ${item === 1 ? "w-28" : "w-40"}`}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                  {!searching && lookup.items.length === 0 && (
                    <div className="px-3 py-2 text-xs text-muted">
                      {t("stream.noCategories")}
                    </div>
                  )}
                  {!searching &&
                    lookup.items.map((item) => (
                      <button
                        key={item.id}
                        className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-white/6"
                        onClick={() => {
                          setCategory(item);
                          setQuery("");
                          setLookup({ term: "", items: [] });
                        }}
                      >
                        <BoxArt category={item} className="h-9 w-7" />
                        <span className="truncate text-sm">{item.name}</span>
                      </button>
                    ))}
                </div>
              )}
                </>
              )}
            </div>
          </div>

          <div className="mt-6">
            <label
              className="label inline-flex items-center gap-1.5"
              htmlFor="stream-language"
            >
              <Languages size={13} />
              {t("stream.language")}
            </label>
            <p className="mt-1 text-xs leading-5 text-muted">
              {t("stream.languageDetail")}
            </p>
            {busyLoading ? (
              <LoadingIndicator className="mt-3 h-[34px] w-full max-w-xs" />
            ) : (
            <select
              id="stream-language"
              className="input mt-3 max-w-xs"
              value={language}
              disabled={missingScope}
              onChange={(event) => setLanguage(event.target.value)}
            >
              {!LANGUAGES.some((item) => item.value === language) && (
                <option value={language}>{language}</option>
              )}
              {LANGUAGES.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
            )}
          </div>

          <div className="mt-6 flex items-center justify-between gap-4 border-t border-line pt-5">
            <p className="text-[11px] leading-5 text-zinc-600">
              {t("stream.changesImmediate")}
            </p>
            <Button
              variant="primary"
              disabled={saving || busyLoading || missingScope || !title.trim()}
              onClick={save}
            >
              {saving ? (
                <LoaderCircle size={15} className="animate-spin" />
              ) : (
                <Save size={15} />
              )}
              {t("stream.saveChanges")}
            </Button>
          </div>
        </Card>

        <Card className="h-fit p-4">
          <h2 className="text-sm font-semibold">{t("stream.channelPreview")}</h2>
          <div className="mt-4 flex gap-3">
            {busyLoading ? (
              <LoadingIndicator className="h-24 w-16 shrink-0" />
            ) : (
              <BoxArt category={category} className="h-24 w-16 shrink-0" />
            )}
            <div className="min-w-0">
              {busyLoading ? (
                <>
                  <LoadingIndicator className="h-3.5 w-44 max-w-full" />
                  <LoadingIndicator className="mt-2 h-3 w-28" />
                  <LoadingIndicator className="mt-2 h-2.5 w-16" />
                </>
              ) : (
                <>
                  <div className="line-clamp-3 text-sm font-medium leading-5">
                    {title.trim() || t("stream.noTitle")}
                  </div>
                  <div className="mt-1 truncate text-xs text-muted">
                    {category?.name || t("stream.noCategory")}
                  </div>
                  <div className="mt-0.5 text-[11px] text-zinc-600">
                    {LANGUAGES.find((item) => item.value === language)?.label ??
                      language}
                  </div>
                </>
              )}
            </div>
          </div>
          <div className="mt-4 space-y-2 border-t border-line pt-3 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-muted">{t("stream.status")}</span>
              {statsLoading ? (
                <LoadingIndicator className="h-3 w-12" />
              ) : (
                <span>{stats.live ? t("stream.live") : t("stream.offline")}</span>
              )}
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted">{t("stream.viewers")}</span>
              <span className="tabular-nums">
                {statsLoading ? (
                  <LoadingIndicator className="h-3 w-8" />
                ) : (
                  stats.viewers?.toLocaleString(i18n.language) ?? "—"
                )}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted">{t("stream.account")}</span>
              <span className="truncate pl-3">{twitch.account ?? "—"}</span>
            </div>
          </div>
        </Card>
      </div>
    </>
  );
}
