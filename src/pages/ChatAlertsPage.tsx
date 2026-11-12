import { BellRing, Info, RotateCcw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import {
  Badge,
  Button,
  Card,
  PageHeader,
  Toggle,
} from "../components/ui";
import { defaultChatAlerts, useAppStore } from "../stores/app-store";
import { cn } from "../lib/utils";
import type { ChatAlertItem, ChatAlertsConfig } from "../types";

type AlertTab = "subscriptions" | "gifted" | "engagement" | "stream";

function AlertItemEditor({
  title,
  item,
  onChange,
}: {
  title: string;
  item: ChatAlertItem;
  onChange: (next: ChatAlertItem) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-semibold text-zinc-100">{title}</span>
        <Toggle
          value={item.enabled}
          onChange={(enabled) => onChange({ ...item, enabled })}
          label={title}
        />
      </div>
      <div>
        <div className="mb-1 text-[11px] font-medium text-zinc-400">
          {t("chatAlerts.alertMessage")}
        </div>
        <input
          className="input w-full text-xs"
          maxLength={500}
          value={item.message}
          onChange={(event) =>
            onChange({ ...item, message: event.target.value })
          }
        />
        <div className="mt-1 text-[10.5px] tabular-nums text-muted">
          {t("commands.charactersUsed", {
            count: item.message.length,
            max: 500,
          })}
        </div>
      </div>
    </div>
  );
}

export function ChatAlertsPage() {
  const { t } = useTranslation();
  const chatAlerts = useAppStore((s) => s.chatAlerts);
  const setChatAlerts = useAppStore((s) => s.setChatAlerts);
  const [tab, setTab] = useState<AlertTab>("subscriptions");

  const updateAlert = <K extends keyof ChatAlertsConfig>(
    key: K,
    value: ChatAlertsConfig[K],
  ) => {
    setChatAlerts({ [key]: value });
  };

  const activeCount = Object.values(chatAlerts).filter(
    (item) => item.enabled,
  ).length;

  const tabs: Array<{ id: AlertTab; label: string; count: number }> = [
    {
      id: "subscriptions",
      label: t("chatAlerts.tabs.subscriptions"),
      count: [
        chatAlerts.subTier1,
        chatAlerts.subTier2,
        chatAlerts.subTier3,
        chatAlerts.subPrime,
        chatAlerts.resubTier1,
        chatAlerts.resubTier2,
        chatAlerts.resubTier3,
        chatAlerts.resubPrime,
      ].filter((a) => a.enabled).length,
    },
    {
      id: "gifted",
      label: t("chatAlerts.tabs.gifted"),
      count: [
        chatAlerts.giftTier1,
        chatAlerts.giftTier2,
        chatAlerts.giftTier3,
        chatAlerts.massGiftTier1,
        chatAlerts.massGiftTier2,
        chatAlerts.massGiftTier3,
      ].filter((a) => a.enabled).length,
    },
    {
      id: "engagement",
      label: t("chatAlerts.tabs.engagement"),
      count: [chatAlerts.raid, chatAlerts.bits, chatAlerts.follower].filter(
        (a) => a.enabled,
      ).length,
    },
    {
      id: "stream",
      label: t("chatAlerts.tabs.stream"),
      count: [
        chatAlerts.goLive,
        chatAlerts.gameChange,
        chatAlerts.titleChange,
      ].filter((a) => a.enabled).length,
    },
  ];

  return (
    <>
      <PageHeader
        icon={BellRing}
        title={t("nav.chatAlerts")}
        description={t("pageDescriptions.chatAlerts")}
        titleActions={
          <Badge tone={activeCount > 0 ? "green" : "neutral"}>
            {t("chatAlerts.activeCount", { count: activeCount })}
          </Badge>
        }
        actions={
          <Button
            variant="default"
            onClick={() => {
              setChatAlerts(defaultChatAlerts);
              toast.success(t("chatAlerts.resetSuccess"));
            }}
          >
            <RotateCcw size={14} />
            {t("common.reset")}
          </Button>
        }
      />

      <div
        role="tablist"
        aria-label={t("nav.chatAlerts")}
        className="mb-3 flex shrink-0 flex-wrap items-center gap-1.5 rounded-xl border border-line bg-black/20 p-1"
      >
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            onClick={() => setTab(item.id)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition",
              tab === item.id
                ? "bg-accent/20 text-accent"
                : "text-zinc-400 hover:bg-white/4 hover:text-zinc-200",
            )}
          >
            <span>{item.label}</span>
            {item.count > 0 && (
              <span className="rounded-full bg-accent/25 px-1.5 py-0.2 text-[10px] font-semibold text-accent">
                {item.count}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "subscriptions" && (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <Card className="p-4">
              <div className="mb-3 border-b border-line pb-2 text-xs font-semibold tracking-tight text-zinc-200">
                {t("chatAlerts.subscriptionAlerts")}
              </div>
              <div className="space-y-3">
                <AlertItemEditor
                  title={t("chatAlerts.tier1")}
                  item={chatAlerts.subTier1}
                  onChange={(val) => updateAlert("subTier1", val)}
                />
                <AlertItemEditor
                  title={t("chatAlerts.tier2")}
                  item={chatAlerts.subTier2}
                  onChange={(val) => updateAlert("subTier2", val)}
                />
                <AlertItemEditor
                  title={t("chatAlerts.tier3")}
                  item={chatAlerts.subTier3}
                  onChange={(val) => updateAlert("subTier3", val)}
                />
                <AlertItemEditor
                  title={t("chatAlerts.primeGaming")}
                  item={chatAlerts.subPrime}
                  onChange={(val) => updateAlert("subPrime", val)}
                />
              </div>
            </Card>

            <Card className="p-4">
              <div className="mb-3 border-b border-line pb-2 text-xs font-semibold tracking-tight text-zinc-200">
                {t("chatAlerts.resubscriptionAlerts")}
              </div>
              <div className="space-y-3">
                <AlertItemEditor
                  title={t("chatAlerts.tier1")}
                  item={chatAlerts.resubTier1}
                  onChange={(val) => updateAlert("resubTier1", val)}
                />
                <AlertItemEditor
                  title={t("chatAlerts.tier2")}
                  item={chatAlerts.resubTier2}
                  onChange={(val) => updateAlert("resubTier2", val)}
                />
                <AlertItemEditor
                  title={t("chatAlerts.tier3")}
                  item={chatAlerts.resubTier3}
                  onChange={(val) => updateAlert("resubTier3", val)}
                />
                <AlertItemEditor
                  title={t("chatAlerts.primeGaming")}
                  item={chatAlerts.resubPrime}
                  onChange={(val) => updateAlert("resubPrime", val)}
                />
              </div>
            </Card>
          </div>
        )}

        {tab === "gifted" && (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <Card className="p-4">
              <div className="mb-3 border-b border-line pb-2 text-xs font-semibold tracking-tight text-zinc-200">
                {t("chatAlerts.giftedSubAlerts")}
              </div>
              <div className="mb-3 flex items-center gap-2 rounded-xl border border-line bg-white/[.02] px-3 py-2 text-xs text-zinc-300">
                <Info size={14} className="shrink-0 text-zinc-400" />
                <span>{t("chatAlerts.giftedSubHint")}</span>
              </div>
              <div className="space-y-3">
                <AlertItemEditor
                  title={t("chatAlerts.tier1")}
                  item={chatAlerts.giftTier1}
                  onChange={(val) => updateAlert("giftTier1", val)}
                />
                <AlertItemEditor
                  title={t("chatAlerts.tier2")}
                  item={chatAlerts.giftTier2}
                  onChange={(val) => updateAlert("giftTier2", val)}
                />
                <AlertItemEditor
                  title={t("chatAlerts.tier3")}
                  item={chatAlerts.giftTier3}
                  onChange={(val) => updateAlert("giftTier3", val)}
                />
              </div>
            </Card>

            <Card className="p-4">
              <div className="mb-3 border-b border-line pb-2 text-xs font-semibold tracking-tight text-zinc-200">
                {t("chatAlerts.massGiftSubAlerts")}
              </div>
              <div className="mb-3 flex items-center gap-2 rounded-xl border border-line bg-white/[.02] px-3 py-2 text-xs text-zinc-300">
                <Info size={14} className="shrink-0 text-zinc-400" />
                <span>{t("chatAlerts.massGiftSubHint")}</span>
              </div>
              <div className="space-y-3">
                <AlertItemEditor
                  title={t("chatAlerts.tier1")}
                  item={chatAlerts.massGiftTier1}
                  onChange={(val) => updateAlert("massGiftTier1", val)}
                />
                <AlertItemEditor
                  title={t("chatAlerts.tier2")}
                  item={chatAlerts.massGiftTier2}
                  onChange={(val) => updateAlert("massGiftTier2", val)}
                />
                <AlertItemEditor
                  title={t("chatAlerts.tier3")}
                  item={chatAlerts.massGiftTier3}
                  onChange={(val) => updateAlert("massGiftTier3", val)}
                />
              </div>
            </Card>
          </div>
        )}

        {tab === "engagement" && (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <Card className="p-4">
              <div className="mb-3 border-b border-line pb-2 text-xs font-semibold tracking-tight text-zinc-200">
                {t("chatAlerts.raidAlerts")}
              </div>
              <div className="space-y-3">
                <AlertItemEditor
                  title={t("channelPoints.enabled")}
                  item={chatAlerts.raid}
                  onChange={(val) =>
                    updateAlert("raid", {
                      ...chatAlerts.raid,
                      ...val,
                    })
                  }
                />
                <div>
                  <label
                    htmlFor="raid-min-viewers"
                    className="mb-1 block text-xs font-semibold text-zinc-200"
                  >
                    {t("chatAlerts.minimumViewers")}
                  </label>
                  <div className="relative">
                    <input
                      id="raid-min-viewers"
                      type="number"
                      min={1}
                      className="input w-full pr-20 tabular-nums"
                      value={chatAlerts.raid.minimum}
                      onChange={(event) =>
                        updateAlert("raid", {
                          ...chatAlerts.raid,
                          minimum: Math.max(
                            1,
                            Number(event.target.value) || 1,
                          ),
                        })
                      }
                    />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted">
                      {t("donations.viewers")}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-muted">
                    {t("chatAlerts.minimumViewersHint")}
                  </p>
                </div>
              </div>
            </Card>

            <Card className="p-4">
              <div className="mb-3 border-b border-line pb-2 text-xs font-semibold tracking-tight text-zinc-200">
                {t("chatAlerts.bitsAlerts")}
              </div>
              <div className="space-y-3">
                <AlertItemEditor
                  title={t("channelPoints.enabled")}
                  item={chatAlerts.bits}
                  onChange={(val) =>
                    updateAlert("bits", {
                      ...chatAlerts.bits,
                      ...val,
                    })
                  }
                />
                <div>
                  <label
                    htmlFor="bits-min-amount"
                    className="mb-1 block text-xs font-semibold text-zinc-200"
                  >
                    {t("chatAlerts.minimumBits")}
                  </label>
                  <div className="relative">
                    <input
                      id="bits-min-amount"
                      type="number"
                      min={1}
                      className="input w-full pr-16 tabular-nums"
                      value={chatAlerts.bits.minimum}
                      onChange={(event) =>
                        updateAlert("bits", {
                          ...chatAlerts.bits,
                          minimum: Math.max(
                            1,
                            Number(event.target.value) || 1,
                          ),
                        })
                      }
                    />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted">
                      {t("donations.bits")}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-muted">
                    {t("chatAlerts.minimumBitsHint")}
                  </p>
                </div>
              </div>
            </Card>

            <Card className="p-4 lg:col-span-2">
              <div className="mb-3 border-b border-line pb-2 text-xs font-semibold tracking-tight text-zinc-200">
                {t("chatAlerts.followerAlerts")}
              </div>
              <AlertItemEditor
                title={t("channelPoints.enabled")}
                item={chatAlerts.follower}
                onChange={(val) => updateAlert("follower", val)}
              />
            </Card>
          </div>
        )}

        {tab === "stream" && (
          <Card className="p-4">
            <div className="mb-3 border-b border-line pb-2 text-xs font-semibold tracking-tight text-zinc-200">
              {t("chatAlerts.streamAlerts")}
            </div>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <AlertItemEditor
                title={t("chatAlerts.goLive")}
                item={chatAlerts.goLive}
                onChange={(val) => updateAlert("goLive", val)}
              />
              <AlertItemEditor
                title={t("chatAlerts.gameChanges")}
                item={chatAlerts.gameChange}
                onChange={(val) => updateAlert("gameChange", val)}
              />
              <AlertItemEditor
                title={t("chatAlerts.titleChanges")}
                item={chatAlerts.titleChange}
                onChange={(val) => updateAlert("titleChange", val)}
              />
            </div>
          </Card>
        )}
      </div>
    </>
  );
}
