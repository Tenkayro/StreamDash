import {
  ArrowLeft,
  ChevronRight,
  ExternalLink,
  LoaderCircle,
  Palette,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  PageHeader,
  ScrollFade,
  Toggle,
} from "../components/ui";
import { useAppStore } from "../stores/app-store";
import { twitchNative } from "../services/native";
import { TWITCH_CLIENT_ID } from "../services/twitch/config";
import { useRuntime } from "../services/runtime-context";
import { cn, errorMessage } from "../lib/utils";
import type { ChannelPointReward } from "../types";

const MANAGE_REDEMPTIONS_SCOPE = "channel:manage:redemptions";
const READ_REDEMPTIONS_SCOPE = "channel:read:redemptions";
const TWITCH_REWARDS_DASHBOARD_URL =
  "https://dashboard.twitch.tv/viewer-rewards/channel-points/rewards";

const PRESET_COLORS = [
  "#3B82F6",
  "#9146FF",
  "#10B981",
  "#F97316",
  "#EC4899",
  "#EAB308",
  "#06B6D4",
  "#EF4444",
];

interface HelixCustomReward {
  id: string;
  title: string;
  prompt: string;
  cost: number;
  background_color: string;
  is_enabled: boolean;
  is_paused: boolean;
  is_user_input_required: boolean;
  should_redemptions_skip_request_queue: boolean;
  max_per_stream_setting?: {
    is_enabled: boolean;
    max_per_stream: number;
  };
  max_per_user_per_stream_setting?: {
    is_enabled: boolean;
    max_per_user_per_stream: number;
  };
  global_cooldown_setting?: {
    is_enabled: boolean;
    global_cooldown_seconds: number;
  };
  image?: {
    url_1x?: string;
    url_2x?: string;
    url_4x?: string;
  } | null;
  default_image?: {
    url_1x?: string;
    url_2x?: string;
    url_4x?: string;
  };
}

function createEmptyReward(): ChannelPointReward {
  return {
    id: "",
    title: "",
    prompt: "",
    cost: 1000,
    backgroundColor: "#3B82F6",
    enabled: true,
    paused: false,
    enabledWhenOffline: true,
    enabledWhenOnline: true,
    userInputRequired: false,
    skipRequestQueue: false,
    maxPerStreamEnabled: false,
    maxPerStream: 100,
    maxPerUserPerStreamEnabled: false,
    maxPerUserPerStream: 10,
    globalCooldownEnabled: true,
    globalCooldownSeconds: 300,
    manageable: true,
  };
}

function ChannelPointIcon({
  color,
  imageUrl,
  size = "md",
}: {
  color: string;
  imageUrl?: string;
  size?: "sm" | "md" | "lg";
}) {
  const dimensions =
    size === "lg" ? "size-13 rounded-xl" : size === "sm" ? "size-9 rounded-lg" : "size-10 rounded-xl";
  return (
    <div
      style={{ backgroundColor: color || "#3B82F6" }}
      className={cn(
        "grid shrink-0 place-items-center shadow-inner shadow-white/15 transition-colors",
        dimensions,
      )}
    >
      {imageUrl ? (
        <img src={imageUrl} alt="" className="size-6 object-contain" />
      ) : (
        <svg
          viewBox="0 0 24 24"
          className={size === "lg" ? "size-7 text-white" : "size-5 text-white"}
          fill="none"
           aria-hidden="true"
        >
          <circle
            cx="12"
            cy="11"
            r="5.5"
            stroke="currentColor"
            strokeWidth="2.2"
          />
          <path
            d="M6.5 18.5C8.2 19.6 10 20 12 20C14 20 15.8 19.6 17.5 18.5"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            opacity="0.7"
          />
        </svg>
      )}
    </div>
  );
}

export function ChannelPointsPage() {
  const { t, i18n } = useTranslation();
  const runtime = useRuntime();
  const twitch = useAppStore((s) => s.twitch);
  const stats = useAppStore((s) => s.stats);
  const channelRewards = useAppStore((s) => s.channelRewards);
  const setChannelRewards = useAppStore((s) => s.setChannelRewards);
  const upsertChannelReward = useAppStore((s) => s.upsertChannelReward);
  const deleteChannelReward = useAppStore((s) => s.deleteChannelReward);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editing, setEditing] = useState<ChannelPointReward | null>(null);
  const [isNew, setIsNew] = useState(false);

  const connected = twitch.phase === "connected" && Boolean(twitch.userId);
  const canRead =
    connected &&
    (twitch.scopes?.includes(READ_REDEMPTIONS_SCOPE) ||
      twitch.scopes?.includes(MANAGE_REDEMPTIONS_SCOPE));
  const canManage =
    connected && Boolean(twitch.scopes?.includes(MANAGE_REDEMPTIONS_SCOPE));

  const formatPoints = (cost: number) =>
    new Intl.NumberFormat(i18n.language).format(cost);

  const syncFromTwitch = useCallback(
    async (silent = false) => {
      if (!connected || !twitch.userId || !canRead) return;
      setLoading(true);
      try {
        const [allResult, manageableResult] = await Promise.allSettled([
          twitchNative.helix<{ data: HelixCustomReward[] }>(
            TWITCH_CLIENT_ID,
            "channel_points/custom_rewards",
            [["broadcaster_id", twitch.userId]],
          ),
          canManage
            ? twitchNative.helix<{ data: HelixCustomReward[] }>(
                TWITCH_CLIENT_ID,
                "channel_points/custom_rewards",
                [
                  ["broadcaster_id", twitch.userId],
                  ["only_manageable_rewards", "true"],
                ],
              )
            : Promise.resolve({ data: [] as HelixCustomReward[] }),
        ]);

        if (allResult.status === "rejected") {
          throw allResult.reason;
        }

        const manageableIds = new Set(
          manageableResult.status === "fulfilled"
            ? (manageableResult.value.data ?? []).map((item) => item.id)
            : [],
        );
        const existingMap = new Map(
          useAppStore
            .getState()
            .channelRewards.map((item) => [item.id, item] as const),
        );

        const mapped: ChannelPointReward[] = (allResult.value.data ?? []).map(
          (item) => {
            const local = existingMap.get(item.id);
            return {
              id: item.id,
              title: item.title,
              prompt: item.prompt ?? "",
              cost: item.cost,
              backgroundColor: item.background_color || "#3B82F6",
              enabled: item.is_enabled,
              paused: item.is_paused,
              enabledWhenOffline: local?.enabledWhenOffline ?? true,
              enabledWhenOnline: local?.enabledWhenOnline ?? true,
              userInputRequired: item.is_user_input_required,
              skipRequestQueue: item.should_redemptions_skip_request_queue,
              maxPerStreamEnabled:
                item.max_per_stream_setting?.is_enabled ?? false,
              maxPerStream:
                item.max_per_stream_setting?.max_per_stream ||
                local?.maxPerStream ||
                100,
              maxPerUserPerStreamEnabled:
                item.max_per_user_per_stream_setting?.is_enabled ?? false,
              maxPerUserPerStream:
                item.max_per_user_per_stream_setting?.max_per_user_per_stream ||
                local?.maxPerUserPerStream ||
                10,
              globalCooldownEnabled:
                item.global_cooldown_setting?.is_enabled ?? false,
              globalCooldownSeconds:
                item.global_cooldown_setting?.global_cooldown_seconds ||
                local?.globalCooldownSeconds ||
                300,
              imageUrl:
                item.image?.url_2x ||
                item.image?.url_1x ||
                undefined,
              manageable: manageableIds.has(item.id),
            };
          },
        );
        setChannelRewards(mapped);
      } catch (error) {
        if (!silent) {
          toast.error(t("channelPoints.loadError"), {
            description: errorMessage(error),
          });
        }
      } finally {
        setLoading(false);
      }
    },
    [canManage, canRead, connected, setChannelRewards, t, twitch.userId],
  );

  useEffect(() => {
    if (connected && canRead) {
      void syncFromTwitch(true);
    }
  }, [canRead, connected, syncFromTwitch]);

  const openCreate = () => {
    setIsNew(true);
    setEditing(createEmptyReward());
  };

  const openEdit = (reward: ChannelPointReward) => {
    setIsNew(false);
    setEditing({ ...reward });
  };

  const handleSave = async () => {
    if (!editing) return;
    const title = editing.title.trim();
    if (!title) {
      toast.error(t("channelPoints.enterTitle"));
      return;
    }
    const cost = Math.max(1, Math.round(Number(editing.cost) || 1));
    const maxPerStream = Math.max(1, Math.round(Number(editing.maxPerStream) || 1));
    const maxPerUser = Math.max(
      1,
      Math.round(Number(editing.maxPerUserPerStream) || 1),
    );
    const cooldownSeconds = Math.max(
      1,
      Math.round(Number(editing.globalCooldownSeconds) || 1),
    );
    const shouldPauseNow = stats.live
      ? !editing.enabledWhenOnline
      : !editing.enabledWhenOffline;

    setSaving(true);
    try {
      if (connected && twitch.userId && canManage) {
        const body: Record<string, unknown> = {
          title: title.slice(0, 45),
          prompt: editing.prompt.trim().slice(0, 200),
          cost,
          background_color: editing.backgroundColor || "#3B82F6",
          is_enabled: editing.enabled,
          is_user_input_required: editing.userInputRequired,
          should_redemptions_skip_request_queue: editing.skipRequestQueue,
          is_max_per_stream_enabled: editing.maxPerStreamEnabled,
          ...(editing.maxPerStreamEnabled
            ? { max_per_stream: maxPerStream }
            : {}),
          is_max_per_user_per_stream_enabled:
            editing.maxPerUserPerStreamEnabled,
          ...(editing.maxPerUserPerStreamEnabled
            ? { max_per_user_per_stream: maxPerUser }
            : {}),
          is_global_cooldown_enabled: editing.globalCooldownEnabled,
          ...(editing.globalCooldownEnabled
            ? { global_cooldown_seconds: cooldownSeconds }
            : {}),
        };

        if (isNew || !editing.manageable) {
          const res = await twitchNative.helixPost<{
            data?: HelixCustomReward[];
          }>(
            TWITCH_CLIENT_ID,
            "channel_points/custom_rewards",
            [["broadcaster_id", twitch.userId]],
            body,
          );
          const created = res.data?.[0];
          const savedReward: ChannelPointReward = {
            ...editing,
            id: created?.id ?? `local-${Date.now()}`,
            title: created?.title ?? title,
            prompt: created?.prompt ?? editing.prompt.trim(),
            cost: created?.cost ?? cost,
            backgroundColor:
              created?.background_color || editing.backgroundColor,
            enabled: created?.is_enabled ?? editing.enabled,
            paused: shouldPauseNow,
            maxPerStream,
            maxPerUserPerStream: maxPerUser,
            globalCooldownSeconds: cooldownSeconds,
            manageable: true,
          };
          if (created?.id && shouldPauseNow) {
            await twitchNative
              .helixPatch(
                TWITCH_CLIENT_ID,
                "channel_points/custom_rewards",
                [
                  ["broadcaster_id", twitch.userId],
                  ["id", created.id],
                ],
                { is_paused: true },
              )
              .catch(() => undefined);
          }
          upsertChannelReward(savedReward);
          toast.success(
            isNew
              ? t("channelPoints.createdSuccess")
              : t("channelPoints.updatedSuccess"),
          );
          setEditing(null);
          return;
        }

        const res = await twitchNative.helixPatch<{
          data?: HelixCustomReward[];
        }>(
          TWITCH_CLIENT_ID,
          "channel_points/custom_rewards",
          [
            ["broadcaster_id", twitch.userId],
            ["id", editing.id],
          ],
          { ...body, is_paused: shouldPauseNow },
        );
        const updated = res.data?.[0];
        upsertChannelReward({
          ...editing,
          title: updated?.title ?? title,
          prompt: updated?.prompt ?? editing.prompt.trim(),
          cost: updated?.cost ?? cost,
          backgroundColor:
            updated?.background_color || editing.backgroundColor,
          enabled: updated?.is_enabled ?? editing.enabled,
          paused: updated?.is_paused ?? shouldPauseNow,
          maxPerStream,
          maxPerUserPerStream: maxPerUser,
          globalCooldownSeconds: cooldownSeconds,
          manageable: true,
        });
        toast.success(t("channelPoints.updatedSuccess"));
        setEditing(null);
        return;
      }

      const fallbackReward: ChannelPointReward = {
        ...editing,
        id: editing.id || `local-${Date.now()}`,
        title: title.slice(0, 45),
        prompt: editing.prompt.trim().slice(0, 200),
        cost,
        paused: shouldPauseNow,
        maxPerStream,
        maxPerUserPerStream: maxPerUser,
        globalCooldownSeconds: cooldownSeconds,
        manageable: true,
      };
      upsertChannelReward(fallbackReward);
      toast.success(
        isNew
          ? t("channelPoints.createdSuccess")
          : t("channelPoints.updatedSuccess"),
      );
      setEditing(null);
    } catch (error) {
      toast.error(t("channelPoints.saveError"), {
        description: errorMessage(error),
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (reward: ChannelPointReward) => {
    setDeleting(true);
    try {
      if (
        connected &&
        twitch.userId &&
        canManage &&
        reward.manageable &&
        !reward.id.startsWith("local-")
      ) {
        await twitchNative.helixDelete(
          TWITCH_CLIENT_ID,
          "channel_points/custom_rewards",
          [
            ["broadcaster_id", twitch.userId],
            ["id", reward.id],
          ],
        );
      }
      deleteChannelReward(reward.id);
      toast.success(t("channelPoints.deletedSuccess"));
      if (editing?.id === reward.id) setEditing(null);
    } catch (error) {
      toast.error(t("channelPoints.deleteError"), {
        description: errorMessage(error),
      });
    } finally {
      setDeleting(false);
    }
  };

  const handleQuickToggle = async (
    reward: ChannelPointReward,
    enabled: boolean,
  ) => {
    const previous = reward.enabled;
    upsertChannelReward({ ...reward, enabled });
    if (
      !connected ||
      !twitch.userId ||
      !canManage ||
      !reward.manageable ||
      reward.id.startsWith("local-")
    ) {
      return;
    }
    try {
      await twitchNative.helixPatch(
        TWITCH_CLIENT_ID,
        "channel_points/custom_rewards",
        [
          ["broadcaster_id", twitch.userId],
          ["id", reward.id],
        ],
        { is_enabled: enabled },
      );
    } catch (error) {
      upsertChannelReward({ ...reward, enabled: previous });
      toast.error(t("channelPoints.saveError"), {
        description: errorMessage(error),
      });
    }
  };

  if (editing) {
    return (
      <>
        <div className="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setEditing(null)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white/3 px-2.5 py-1.5 text-xs font-medium text-zinc-400 transition hover:bg-white/6 hover:text-zinc-200"
            >
              <ArrowLeft size={13} />
              {t("nav.channelPoints")}
            </button>
            <ChevronRight size={13} className="shrink-0 text-zinc-600" />
            <h1 className="truncate text-base font-semibold text-zinc-100">
              {isNew ? t("channelPoints.newReward") : editing.title || t("channelPoints.editReward")}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            {!isNew && (
              <Button
                variant="danger"
                disabled={deleting || saving}
                onClick={() => void handleDelete(editing)}
              >
                {deleting ? (
                  <LoaderCircle size={14} className="animate-spin" />
                ) : (
                  <Trash2 size={14} />
                )}
                {t("channelPoints.delete")}
              </Button>
            )}
            <Button
              variant="default"
              disabled={saving}
              onClick={() => setEditing(null)}
            >
              {t("dashboard.cancel")}
            </Button>
            <Button
              variant="primary"
              disabled={saving || !editing.title.trim()}
              onClick={() => void handleSave()}
            >
              {saving ? (
                <LoaderCircle size={14} className="animate-spin" />
              ) : (
                <Save size={14} />
              )}
              {isNew
                ? t("channelPoints.createReward")
                : t("channelPoints.saveReward")}
            </Button>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-y-auto lg:grid-cols-2 lg:overflow-hidden">
          <div className="flex min-h-0 flex-col gap-3">
            <Card className="p-3.5">
              <div className="mb-2.5 border-b border-line pb-2 text-xs font-semibold tracking-tight text-zinc-200">
                {t("channelPoints.general")}
              </div>
              <div className="space-y-3">
                <div>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <label
                      htmlFor="reward-title"
                      className="text-xs font-medium text-zinc-200"
                    >
                      {t("channelPoints.rewardTitle")}
                    </label>
                    <span className="text-[11px] tabular-nums text-zinc-500">
                      {editing.title.length}/45
                    </span>
                  </div>
                  <input
                    id="reward-title"
                    className="input w-full"
                    maxLength={45}
                    placeholder={t("channelPoints.titlePlaceholder")}
                    value={editing.title}
                    onChange={(event) =>
                      setEditing({ ...editing, title: event.target.value })
                    }
                  />
                </div>

                <div>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <label
                      htmlFor="reward-prompt"
                      className="text-xs font-medium text-zinc-200"
                    >
                      {t("channelPoints.description")}
                    </label>
                    <span className="text-[11px] tabular-nums text-zinc-500">
                      {editing.prompt.length}/200
                    </span>
                  </div>
                  <textarea
                    id="reward-prompt"
                    rows={3}
                    maxLength={200}
                    placeholder={t("channelPoints.descriptionPlaceholder")}
                    value={editing.prompt}
                    onChange={(event) =>
                      setEditing({ ...editing, prompt: event.target.value })
                    }
                    className="w-full resize-none rounded-lg border border-line bg-black/25 px-3 py-2 text-xs leading-5 text-zinc-100 outline-none transition focus:border-accent/45"
                  />
                </div>
              </div>
            </Card>

            <Card className="p-3.5">
              <div className="mb-2.5 border-b border-line pb-2 text-xs font-semibold tracking-tight text-zinc-200">
                {t("channelPoints.preview")}
              </div>
              <div className="flex flex-wrap items-center gap-3.5 rounded-xl border border-line bg-white/2 p-3">
                <ChannelPointIcon
                  color={editing.backgroundColor}
                  imageUrl={editing.imageUrl}
                  size="lg"
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-zinc-100">
                    {editing.title.trim() || t("channelPoints.titlePlaceholder")}
                  </div>
                  <div className="mt-0.5 text-xs text-muted">
                    {t("channelPoints.pointsCost", {
                      points: formatPoints(editing.cost || 0),
                    })}
                  </div>
                </div>
                <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-line bg-white/4 px-2.5 py-1.5 text-xs font-medium text-zinc-200 transition hover:border-accent/35 hover:bg-white/7">
                  <Palette size={13} className="text-accent" />
                  <span>{t("channelPoints.selectColor")}</span>
                  <input
                    type="color"
                    aria-label={t("channelPoints.backgroundColor")}
                    value={editing.backgroundColor || "#3B82F6"}
                    onChange={(event) =>
                      setEditing({
                        ...editing,
                        backgroundColor: event.target.value,
                      })
                    }
                    className="sr-only"
                  />
                </label>
              </div>

              <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                <span className="mr-1 text-[11px] text-muted">
                  {t("channelPoints.backgroundColor")}:
                </span>
                {PRESET_COLORS.map((hex) => (
                  <button
                    key={hex}
                    type="button"
                    aria-label={hex}
                    onClick={() =>
                      setEditing({ ...editing, backgroundColor: hex })
                    }
                    style={{ backgroundColor: hex }}
                    className={cn(
                      "size-5 rounded-md border transition-transform hover:scale-110",
                      editing.backgroundColor.toLowerCase() ===
                        hex.toLowerCase()
                        ? "border-white ring-2 ring-accent/50"
                        : "border-white/15",
                    )}
                  />
                ))}
                <span className="ml-auto font-mono text-[11px] uppercase text-zinc-500">
                  {editing.backgroundColor}
                </span>
              </div>

              <div className="mt-2.5 flex items-center justify-end border-t border-line pt-2 text-[11px]">
                <button
                  type="button"
                  onClick={() => void openUrl(TWITCH_REWARDS_DASHBOARD_URL)}
                  className="inline-flex items-center gap-1 text-accent hover:brightness-125"
                >
                  {t("channelPoints.openTwitchDashboard")}
                  <ExternalLink size={11} />
                </button>
              </div>
            </Card>
          </div>

          <div className="flex min-h-0 flex-col gap-3">
            <Card className="p-3.5">
              <div className="mb-2.5 border-b border-line pb-2 text-xs font-semibold tracking-tight text-zinc-200">
                {t("channelPoints.conditions")}
              </div>
              <div className="space-y-2.5">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-medium text-zinc-200">
                    {t("channelPoints.enabled")}
                  </span>
                  <Toggle
                    value={editing.enabled}
                    onChange={(enabled) => setEditing({ ...editing, enabled })}
                    label={t("channelPoints.enabled")}
                  />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-medium text-zinc-200">
                    {t("channelPoints.enabledWhenOffline")}
                  </span>
                  <Toggle
                    value={editing.enabledWhenOffline}
                    onChange={(enabledWhenOffline) =>
                      setEditing({ ...editing, enabledWhenOffline })
                    }
                    label={t("channelPoints.enabledWhenOffline")}
                  />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-medium text-zinc-200">
                    {t("channelPoints.enabledWhenOnline")}
                  </span>
                  <Toggle
                    value={editing.enabledWhenOnline}
                    onChange={(enabledWhenOnline) =>
                      setEditing({ ...editing, enabledWhenOnline })
                    }
                    label={t("channelPoints.enabledWhenOnline")}
                  />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-medium text-zinc-200">
                    {t("channelPoints.userInputRequired")}
                  </span>
                  <Toggle
                    value={editing.userInputRequired}
                    onChange={(userInputRequired) =>
                      setEditing({ ...editing, userInputRequired })
                    }
                    label={t("channelPoints.userInputRequired")}
                  />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-medium text-zinc-200">
                    {t("channelPoints.skipQueue")}
                  </span>
                  <Toggle
                    value={editing.skipRequestQueue}
                    onChange={(skipRequestQueue) =>
                      setEditing({ ...editing, skipRequestQueue })
                    }
                    label={t("channelPoints.skipQueue")}
                  />
                </div>
              </div>
            </Card>

            <Card className="p-3.5">
              <div className="mb-2.5 border-b border-line pb-2 text-xs font-semibold tracking-tight text-zinc-200">
                {t("channelPoints.redemptionLimits")}
              </div>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label
                    htmlFor="reward-cost"
                    className="mb-1 block text-xs font-medium text-zinc-200"
                  >
                    {t("channelPoints.cost")}
                  </label>
                  <div className="relative">
                    <input
                      id="reward-cost"
                      type="number"
                      min={1}
                      max={1000000000}
                      className="input w-full pr-16 tabular-nums"
                      value={editing.cost}
                      onChange={(event) =>
                        setEditing({
                          ...editing,
                          cost: Math.max(1, Number(event.target.value) || 1),
                        })
                      }
                    />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted">
                      {t("channelPoints.pointsUnit")}
                    </span>
                  </div>
                </div>

                <div className="rounded-xl border border-line bg-white/2 p-2.5">
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <label
                      htmlFor="reward-max-stream"
                      className="text-xs font-medium text-zinc-200"
                    >
                      {t("channelPoints.maxPerStream")}
                    </label>
                    <Toggle
                      value={editing.maxPerStreamEnabled}
                      onChange={(maxPerStreamEnabled) =>
                        setEditing({ ...editing, maxPerStreamEnabled })
                      }
                      label={t("channelPoints.maxPerStream")}
                    />
                  </div>
                  <input
                    id="reward-max-stream"
                    type="number"
                    min={1}
                    disabled={!editing.maxPerStreamEnabled}
                    className="input w-full tabular-nums disabled:opacity-45"
                    value={editing.maxPerStream}
                    onChange={(event) =>
                      setEditing({
                        ...editing,
                        maxPerStream: Math.max(
                          1,
                          Number(event.target.value) || 1,
                        ),
                      })
                    }
                  />
                </div>

                <div className="rounded-xl border border-line bg-white/2 p-2.5">
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <label
                      htmlFor="reward-max-user"
                      className="text-xs font-medium text-zinc-200"
                    >
                      {t("channelPoints.maxPerUser")}
                    </label>
                    <Toggle
                      value={editing.maxPerUserPerStreamEnabled}
                      onChange={(maxPerUserPerStreamEnabled) =>
                        setEditing({ ...editing, maxPerUserPerStreamEnabled })
                      }
                      label={t("channelPoints.maxPerUser")}
                    />
                  </div>
                  <input
                    id="reward-max-user"
                    type="number"
                    min={1}
                    disabled={!editing.maxPerUserPerStreamEnabled}
                    className="input w-full tabular-nums disabled:opacity-45"
                    value={editing.maxPerUserPerStream}
                    onChange={(event) =>
                      setEditing({
                        ...editing,
                        maxPerUserPerStream: Math.max(
                          1,
                          Number(event.target.value) || 1,
                        ),
                      })
                    }
                  />
                </div>

                <div className="rounded-xl border border-line bg-white/2 p-2.5 sm:col-span-2">
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <label
                      htmlFor="reward-cooldown"
                      className="text-xs font-medium text-zinc-200"
                    >
                      {t("channelPoints.globalCooldown")}
                    </label>
                    <Toggle
                      value={editing.globalCooldownEnabled}
                      onChange={(globalCooldownEnabled) =>
                        setEditing({ ...editing, globalCooldownEnabled })
                      }
                      label={t("channelPoints.globalCooldown")}
                    />
                  </div>
                  <div className="relative">
                    <input
                      id="reward-cooldown"
                      type="number"
                      min={1}
                      disabled={!editing.globalCooldownEnabled}
                      className="input w-full pr-20 tabular-nums disabled:opacity-45"
                      value={editing.globalCooldownSeconds}
                      onChange={(event) =>
                        setEditing({
                          ...editing,
                          globalCooldownSeconds: Math.max(
                            1,
                            Number(event.target.value) || 1,
                          ),
                        })
                      }
                    />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted">
                      {t("channelPoints.secondsUnit")}
                    </span>
                  </div>
                </div>
              </div>
            </Card>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        icon={Sparkles}
        title={t("nav.channelPoints")}
        description={t("pageDescriptions.channelPoints")}
        actions={
          <>
            {connected && (
              <Button
                variant="default"
                disabled={loading}
                onClick={() => void syncFromTwitch(false)}
              >
                <RefreshCw
                  size={14}
                  className={loading ? "animate-spin" : undefined}
                />
                {t("channelPoints.sync")}
              </Button>
            )}
            <Button variant="primary" onClick={openCreate}>
              <Plus size={15} />
              {t("channelPoints.create")}
            </Button>
          </>
        }
      />

      {connected && !canManage && (
        <Card className="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-3 border-amber-400/25 bg-amber-400/8 px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-2.5 text-xs text-amber-200">
            <TriangleAlert size={15} className="shrink-0 text-amber-300" />
            <span>{t("channelPoints.permissionNotice")}</span>
          </div>
          <Button
            variant="primary"
            onClick={() => void runtime.reauthorizeTwitch()}
          >
            {t("connections.updatePermissions")}
          </Button>
        </Card>
      )}

      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line bg-white/2 px-4 py-2.5">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-zinc-200">
              {t("channelPoints.rewardsList")}
            </span>
            <Badge tone="neutral">
              {t("channelPoints.rewardCount", { count: channelRewards.length })}
            </Badge>
          </div>
          {connected && (
            <button
              type="button"
              onClick={() => void openUrl(TWITCH_REWARDS_DASHBOARD_URL)}
              className="inline-flex items-center gap-1 text-xs text-muted transition hover:text-zinc-200"
            >
              {t("channelPoints.openTwitchDashboard")}
              <ExternalLink size={12} />
            </button>
          )}
        </div>

        {!channelRewards.length ? (
          <div className="grid min-h-0 flex-1 place-items-center">
            <EmptyState
              icon={<Sparkles size={26} />}
              title={t("channelPoints.emptyTitle")}
              body={t("channelPoints.emptyBody")}
              action={
                <Button variant="primary" onClick={openCreate}>
                  <Plus size={15} />
                  {t("channelPoints.create")}
                </Button>
              }
            />
          </div>
        ) : (
          <ScrollFade className="flex min-h-0 flex-1 flex-col" color="#242526" size={32}>
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
              {channelRewards.map((reward) => (
                <div
                  key={reward.id}
                  onClick={() => openEdit(reward)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      openEdit(reward);
                    }
                  }}
                  className="group flex cursor-pointer items-center gap-3.5 rounded-xl border border-line bg-white/2 px-3.5 py-2.5 transition hover:border-accent/35 hover:bg-white/4"
                >
                  <ChannelPointIcon
                    color={reward.backgroundColor}
                    imageUrl={reward.imageUrl}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-semibold text-zinc-100">
                        {reward.title}
                      </span>
                      {!reward.enabled && (
                        <Badge tone="neutral">
                          {t("channelPoints.disabledBadge")}
                        </Badge>
                      )}
                      {reward.paused && (
                        <Badge tone="amber">
                          {t("channelPoints.pausedBadge")}
                        </Badge>
                      )}
                      {reward.userInputRequired && (
                        <Badge tone="purple">
                          {t("channelPoints.inputBadge")}
                        </Badge>
                      )}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted">
                      <span>
                        {t("channelPoints.pointsCost", {
                          points: formatPoints(reward.cost),
                        })}
                      </span>
                      {reward.prompt && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="max-w-md truncate text-zinc-500">
                            {reward.prompt}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  <div
                    className="flex shrink-0 items-center gap-3"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <Toggle
                      value={reward.enabled}
                      onChange={(enabled) =>
                        void handleQuickToggle(reward, enabled)
                      }
                      label={reward.title}
                    />
                    <ChevronRight
                      size={16}
                      className="text-zinc-500 transition group-hover:translate-x-0.5 group-hover:text-zinc-200"
                    />
                  </div>
                </div>
              ))}
            </div>
          </ScrollFade>
        )}
      </Card>
    </>
  );
}
