import {
  Bell,
  Check,
  Copy,
  Download,
  FileJson,
  History,
  Info,
  Layers,
  LayoutDashboard,
  Link2,
  MessageSquare,
  Pencil,
  Plus,
  RefreshCw,
  Sliders,
  Sparkles,
  Trash2,
  Unlink,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Select } from "../Select";
import { Badge, Button, Card, Toggle } from "../ui";
import { parseImportBundle } from "../../lib/profiles";
import { errorMessage } from "../../lib/utils";
import { useRuntime } from "../../services/runtime-context";
import { useAppStore } from "../../stores/app-store";
import type {
  ProfileExportBundle,
  ProfileExportSections,
  UserProfile,
} from "../../types";

const DEFAULT_EXPORT_SECTIONS: ProfileExportSections = {
  appearance: true,
  dashboard: true,
  chatAndObs: true,
  automation: true,
  history: false,
};

function SectionCheckbox({
  checked,
  disabled,
  icon: Icon,
  label,
  detail,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  icon: typeof Sliders;
  label: string;
  detail: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`flex w-full items-center gap-3 rounded-[10px] border px-3 py-2 text-left transition ${
        disabled
          ? "cursor-not-allowed border-rule bg-well/50 opacity-45"
          : checked
            ? "border-accent-border bg-accent-soft/75 text-ink-strong"
            : "border-rule bg-well text-muted hover:border-rule-strong hover:text-ink"
      }`}
    >
      <span
        className={`grid size-7 shrink-0 place-items-center rounded-lg ${
          checked && !disabled ? "bg-accent/20 text-accent" : "bg-panel text-subtle"
        }`}
      >
        <Icon size={14} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium">{label}</span>
        <span className="block truncate text-[10.5px] text-subtle">{detail}</span>
      </span>
      <span
        className={`grid size-4 shrink-0 place-items-center rounded border ${
          checked && !disabled
            ? "border-accent bg-accent text-black"
            : "border-rule-strong bg-transparent"
        }`}
      >
        {checked && !disabled && <Check size={11} strokeWidth={3} />}
      </span>
    </button>
  );
}

function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-xs"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <Card className="w-full max-w-xl overflow-hidden rounded-[14px] border-rule-strong bg-panel p-0 shadow-2xl">
        <div className="flex items-center justify-between border-b border-rule bg-shell/75 px-5 py-3.5">
          <h3 className="text-sm font-semibold text-ink-strong">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label={title}
            className="grid size-7 place-items-center rounded-lg border border-rule bg-well text-muted transition hover:border-rule-strong hover:text-ink-strong"
          >
            <X size={15} />
          </button>
        </div>
        <div className="max-h-[80vh] overflow-y-auto p-5">{children}</div>
      </Card>
    </div>
  );
}

export function ProfilesSection() {
  const { t } = useTranslation();
  const runtime = useRuntime();
  const profiles = useAppStore((s) => s.profiles);
  const activeProfileId = useAppStore((s) => s.activeProfileId);
  const profilesAutoSwitch = useAppStore((s) => s.profilesAutoSwitch);
  const twitch = useAppStore((s) => s.twitch);
  const eventsCount = useAppStore((s) => s.events.length);
  const chatCount = useAppStore((s) => s.chatMessages.length);

  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string>();
  const [editName, setEditName] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<UserProfile>();

  // Create modal state
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newTemplate, setNewTemplate] = useState<"copy" | "clean">("copy");
  const [newLinkTwitch, setNewLinkTwitch] = useState(false);

  // Export modal state
  const [exportOpen, setExportOpen] = useState(false);
  const [exportScope, setExportScope] = useState<"profile" | "all">("profile");
  const [exportTargetId, setExportTargetId] = useState<string>("");
  const [exportSections, setExportSections] = useState<ProfileExportSections>(
    DEFAULT_EXPORT_SECTIONS,
  );

  // Import modal state
  const [importOpen, setImportOpen] = useState(false);
  const [pasteMode, setPasteMode] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [importError, setImportError] = useState<string>();
  const [parsedBundle, setParsedBundle] = useState<ProfileExportBundle>();
  const [importMode, setImportMode] = useState<
    "new" | "overwrite" | "merge" | "replace_all"
  >("new");
  const [importName, setImportName] = useState("");
  const [activateImported, setActivateImported] = useState(true);
  const [linkImportedTwitch, setLinkImportedTwitch] = useState(false);
  const [mergeCollections, setMergeCollections] = useState(false);
  const [importSections, setImportSections] = useState<ProfileExportSections>(
    DEFAULT_EXPORT_SECTIONS,
  );
  const fileInputRef = useRef<HTMLInputElement>(null);

  const twitchConnected = twitch.phase === "connected" && Boolean(twitch.userId);

  const startRename = (profile: UserProfile) => {
    setEditingId(profile.id);
    setEditName(profile.name);
  };

  const commitRename = async () => {
    if (!editingId) return;
    const targetId = editingId;
    const nextName = editName.trim();
    setEditingId(undefined);
    if (!nextName) return;
    try {
      await runtime.renameProfile(targetId, nextName);
    } catch (error) {
      toast.error(t("settings.saveError"), { description: errorMessage(error) });
    }
  };

  const openExportModal = (targetId?: string) => {
    setExportScope(targetId ? "profile" : "profile");
    setExportTargetId(targetId ?? activeProfileId);
    setExportSections({
      appearance: true,
      dashboard: true,
      chatAndObs: true,
      automation: true,
      history: false,
    });
    setExportOpen(true);
  };

  const openImportModal = () => {
    setParsedBundle(undefined);
    setImportError(undefined);
    setPasteMode(false);
    setPasteText("");
    setImportOpen(true);
  };

  const handleParsedText = (rawText: string) => {
    const result = parseImportBundle(rawText);
    if (!result.bundle) {
      setImportError(t(`profiles.importErrors.${result.error ?? "invalidJson"}`));
      setParsedBundle(undefined);
      return;
    }
    const bundle = result.bundle;
    setImportError(undefined);
    setParsedBundle(bundle);
    const isMulti = bundle.scope === "all" || bundle.profiles.length > 1;
    setImportMode(isMulti ? "merge" : "new");
    setImportName(bundle.profiles[0]?.name ?? t("profiles.defaultName"));
    setActivateImported(true);
    setLinkImportedTwitch(false);
    setMergeCollections(false);
    setImportSections({
      appearance: bundle.included.appearance,
      dashboard: bundle.included.dashboard,
      chatAndObs: bundle.included.chatAndObs,
      automation: bundle.included.automation,
      history:
        Boolean(bundle.events?.length || bundle.chatMessages?.length) &&
        bundle.included.history,
    });
  };

  const readImportFile = async (file?: File | null) => {
    if (!file) return;
    try {
      const text = await file.text();
      handleParsedText(text);
    } catch (error) {
      setImportError(errorMessage(error));
    }
  };

  const importSummary = useMemo(() => {
    if (!parsedBundle) return undefined;
    const first = parsedBundle.profiles[0];
    const commands = parsedBundle.profiles.reduce(
      (sum, p) => sum + p.data.commands.length,
      0,
    );
    const variables = parsedBundle.profiles.reduce(
      (sum, p) => sum + p.data.customVariables.length,
      0,
    );
    const widgets = parsedBundle.profiles.reduce(
      (sum, p) => sum + p.data.settings.dashboardWidgets.length,
      0,
    );
    const browserSources = parsedBundle.profiles.reduce(
      (sum, p) => sum + p.data.settings.dashboardBrowserSources.length,
      0,
    );
    return {
      first,
      commands,
      variables,
      widgets,
      browserSources,
      events: parsedBundle.events?.length ?? 0,
      chatMessages: parsedBundle.chatMessages?.length ?? 0,
    };
  }, [parsedBundle]);

  const anyExportSectionSelected =
    exportSections.appearance ||
    exportSections.dashboard ||
    exportSections.chatAndObs ||
    exportSections.automation ||
    exportSections.history;

  const anyImportSectionSelected =
    importSections.appearance ||
    importSections.dashboard ||
    importSections.chatAndObs ||
    importSections.automation ||
    importSections.history;

  return (
    <section id="profiles" className="scroll-mt-16">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-semibold text-zinc-200">
          <span className="grid size-6 place-items-center rounded-md bg-accent-soft text-accent">
            <Layers size={13} />
          </span>
          <span>{t("settings.profiles")}</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            onClick={() => {
              setNewName("");
              setNewTemplate("copy");
              setNewLinkTwitch(false);
              setCreateOpen(true);
            }}
          >
            <Plus size={13} />
            {t("profiles.newProfile")}
          </Button>
          <Button onClick={openImportModal}>
            <Upload size={13} />
            {t("profiles.import")}
          </Button>
          <Button variant="primary" onClick={() => openExportModal(activeProfileId)}>
            <Download size={13} />
            {t("profiles.export")}
          </Button>
        </div>
      </div>

      <Card className="overflow-hidden">
        <div
          data-search-label={t("settings.profilesAutoSwitch")}
          className="flex flex-wrap items-center justify-between gap-3 border-b border-rule bg-shell/60 px-5 py-3.5"
        >
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-rule bg-well text-muted">
              <RefreshCw size={15} />
            </span>
            <div className="min-w-0">
              <div className="text-sm font-medium text-ink-strong">{t("settings.profilesAutoSwitch")}</div>
              <div className="text-xs text-muted">
                {twitchConnected && twitch.account
                  ? t("profiles.autoSwitchDetailConnected", { account: twitch.account })
                  : t("profiles.autoSwitchDetail")}
              </div>
            </div>
          </div>
          <Toggle
            label={t("settings.profilesAutoSwitch")}
            value={profilesAutoSwitch}
            onChange={(value) => void runtime.setProfilesAutoSwitch(value)}
          />
        </div>

        <div className="divide-y divide-rule">
          {profiles.map((profile) => {
            const isActive = profile.id === activeProfileId;
            const isLinkedCurrent =
              Boolean(profile.twitchUserId) &&
              profile.twitchUserId === twitch.userId;
            const isEditing = editingId === profile.id;

            return (
              <div
                key={profile.id}
                data-search-label={profile.name}
                className={`flex flex-wrap items-center justify-between gap-3 px-5 py-3 transition ${
                  isActive ? "bg-accent-soft/35" : "hover:bg-well/55"
                }`}
              >
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <span
                    className={`grid size-9 shrink-0 place-items-center rounded-lg border ${
                      profile.twitchUserId
                        ? "border-twitch-border bg-twitch-soft text-twitch-ink"
                        : isActive
                          ? "border-accent-border bg-accent-soft text-accent"
                          : "border-rule bg-well text-muted"
                    }`}
                  >
                    <Layers size={15} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {isEditing ? (
                        <input
                          autoFocus
                          aria-label={t("profiles.profileName")}
                          className="input h-7! max-w-52 px-2! text-xs!"
                          value={editName}
                          onChange={(event) => setEditName(event.target.value)}
                          onBlur={() => void commitRename()}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") void commitRename();
                            if (event.key === "Escape") setEditingId(undefined);
                          }}
                        />
                      ) : (
                        <>
                          <span className="truncate text-sm font-semibold text-zinc-100">
                            {profile.name}
                          </span>
                          <button
                            type="button"
                            onClick={() => startRename(profile)}
                            title={t("profiles.rename")}
                            aria-label={t("profiles.rename")}
                            className="grid size-6 place-items-center rounded-md text-zinc-600 transition hover:bg-white/5 hover:text-zinc-200"
                          >
                            <Pencil size={11} />
                          </button>
                        </>
                      )}
                      {isActive && <Badge tone="green">{t("profiles.active")}</Badge>}
                      {profile.twitchLogin && (
                        <Badge tone={isLinkedCurrent ? "purple" : "neutral"}>
                          @{profile.twitchLogin}
                        </Badge>
                      )}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-zinc-500">
                      <span>
                        {t("profiles.summaryCounts", {
                          commands: profile.data.commands.length,
                          variables: profile.data.customVariables.length,
                          widgets: profile.data.settings.dashboardWidgets.length,
                        })}
                      </span>
                      {profile.data.settings.dashboardBrowserSources.length > 0 && (
                        <span>
                          ·{" "}
                          {t("profiles.browserSourcesCount", {
                            count: profile.data.settings.dashboardBrowserSources.length,
                          })}
                        </span>
                      )}
                      <span>
                        ·{" "}
                        {new Date(profile.updatedAt).toLocaleString([], {
                          dateStyle: "short",
                          timeStyle: "short",
                        })}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  {!isActive && (
                    <Button
                      variant="primary"
                      disabled={busy}
                      onClick={() => {
                        setBusy(true);
                        void runtime
                          .switchProfile(profile.id)
                          .finally(() => setBusy(false));
                      }}
                    >
                      {t("profiles.switch")}
                    </Button>
                  )}
                  {twitchConnected && twitch.account && (
                    <Button
                      disabled={busy}
                      title={
                        isLinkedCurrent
                          ? t("profiles.unlinkHint")
                          : t("profiles.linkHint", { account: twitch.account })
                      }
                      onClick={() =>
                        void runtime.linkProfileToTwitch(profile.id, !isLinkedCurrent)
                      }
                    >
                      {isLinkedCurrent ? <Unlink size={13} /> : <Link2 size={13} />}
                      {isLinkedCurrent ? t("profiles.unlink") : t("profiles.linkTwitch")}
                    </Button>
                  )}
                  <Button
                    disabled={busy}
                    title={t("profiles.exportProfile")}
                    aria-label={t("profiles.exportProfile")}
                    onClick={() => openExportModal(profile.id)}
                  >
                    <Download size={13} />
                  </Button>
                  <Button
                    disabled={busy}
                    title={t("profiles.duplicate")}
                    aria-label={t("profiles.duplicate")}
                    onClick={() => void runtime.duplicateProfile(profile.id)}
                  >
                    <Copy size={13} />
                  </Button>
                  {profiles.length > 1 && (
                    <Button
                      disabled={busy}
                      title={t("common.delete")}
                      aria-label={t("common.delete")}
                      onClick={() => setDeleteTarget(profile)}
                      className="hover:border-red-500/30 hover:text-red-300"
                    >
                      <Trash2 size={13} />
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {createOpen && (
        <ModalShell title={t("profiles.newProfileTitle")} onClose={() => setCreateOpen(false)}>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (!newName.trim() || busy) return;
              setBusy(true);
              void runtime
                .createProfile({
                  name: newName.trim(),
                  template: newTemplate,
                  linkCurrentTwitch: newLinkTwitch,
                })
                .then(() => setCreateOpen(false))
                .finally(() => setBusy(false));
            }}
          >
            <div>
              <label className="mb-1.5 block text-xs font-medium text-zinc-300">
                {t("profiles.profileName")}
              </label>
              <input
                autoFocus
                className="input"
                placeholder={t("profiles.profileNamePlaceholder")}
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
              />
            </div>

            <div>
              <span className="mb-1.5 block text-xs font-medium text-zinc-300">
                {t("profiles.baseSetup")}
              </span>
              <div className="grid grid-cols-2 gap-2">
                {(["copy", "clean"] as const).map((tpl) => (
                  <button
                    key={tpl}
                    type="button"
                    onClick={() => setNewTemplate(tpl)}
                    className={`rounded-xl border px-3 py-2.5 text-left text-xs transition ${
                      newTemplate === tpl
                        ? "border-accent/40 bg-accent-soft text-white"
                        : "border-line bg-black/15 text-zinc-400 hover:bg-white/5"
                    }`}
                  >
                    <div className="font-semibold">
                      {t(`profiles.template.${tpl}.title`)}
                    </div>
                    <div className="mt-0.5 text-[10.5px] text-zinc-500">
                      {t(`profiles.template.${tpl}.detail`)}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {twitchConnected && twitch.account && (
              <div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-black/15 px-3.5 py-2.5">
                <div className="min-w-0">
                  <div className="text-xs font-medium text-zinc-200">
                    {t("profiles.linkTwitchAccount", { account: twitch.account })}
                  </div>
                  <div className="text-[10.5px] text-zinc-500">
                    {t("profiles.linkTwitchAccountHint")}
                  </div>
                </div>
                <Toggle
                  label={t("profiles.linkTwitchAccount", { account: twitch.account })}
                  value={newLinkTwitch}
                  onChange={setNewLinkTwitch}
                />
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" onClick={() => setCreateOpen(false)}>
                {t("common.cancel")}
              </Button>
              <Button variant="primary" type="submit" disabled={!newName.trim() || busy}>
                <Plus size={14} />
                {t("profiles.createAction")}
              </Button>
            </div>
          </form>
        </ModalShell>
      )}

      {exportOpen && (
        <ModalShell title={t("profiles.exportTitle")} onClose={() => setExportOpen(false)}>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setExportScope("profile")}
                className={`rounded-xl border px-3 py-2 text-left text-xs transition ${
                  exportScope === "profile"
                    ? "border-accent/40 bg-accent-soft text-white"
                    : "border-line bg-black/15 text-zinc-400 hover:bg-white/5"
                }`}
              >
                <div className="font-semibold">{t("profiles.scopeSingle")}</div>
                <div className="mt-0.5 text-[10.5px] text-zinc-500">
                  {t("profiles.scopeSingleDetail")}
                </div>
              </button>
              <button
                type="button"
                onClick={() => setExportScope("all")}
                className={`rounded-xl border px-3 py-2 text-left text-xs transition ${
                  exportScope === "all"
                    ? "border-accent/40 bg-accent-soft text-white"
                    : "border-line bg-black/15 text-zinc-400 hover:bg-white/5"
                }`}
              >
                <div className="font-semibold">
                  {t("profiles.scopeAll", { count: profiles.length })}
                </div>
                <div className="mt-0.5 text-[10.5px] text-zinc-500">
                  {t("profiles.scopeAllDetail")}
                </div>
              </button>
            </div>

            {exportScope === "profile" && profiles.length > 1 && (
              <div>
                <label className="mb-1.5 block text-xs font-medium text-zinc-300">
                  {t("profiles.selectProfile")}
                </label>
                <Select
                  aria-label={t("profiles.selectProfile")}
                  className="w-full"
                  value={exportTargetId}
                  onChange={(event) => setExportTargetId(event.target.value)}
                >
                  {profiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {p.twitchLogin ? ` (@${p.twitchLogin})` : ""}
                    </option>
                  ))}
                </Select>
              </div>
            )}

            <div className="space-y-1.5">
              <span className="block text-xs font-medium text-zinc-300">
                {t("profiles.includedContent")}
              </span>
              <SectionCheckbox
                checked={exportSections.appearance}
                icon={Bell}
                label={t("profiles.sections.appearance")}
                detail={t("profiles.sections.appearanceDetail")}
                onChange={(checked) =>
                  setExportSections((s) => ({ ...s, appearance: checked }))
                }
              />
              <SectionCheckbox
                checked={exportSections.dashboard}
                icon={LayoutDashboard}
                label={t("profiles.sections.dashboard")}
                detail={t("profiles.sections.dashboardDetail")}
                onChange={(checked) =>
                  setExportSections((s) => ({ ...s, dashboard: checked }))
                }
              />
              <SectionCheckbox
                checked={exportSections.chatAndObs}
                icon={MessageSquare}
                label={t("profiles.sections.chatAndObs")}
                detail={t("profiles.sections.chatAndObsDetail")}
                onChange={(checked) =>
                  setExportSections((s) => ({ ...s, chatAndObs: checked }))
                }
              />
              <SectionCheckbox
                checked={exportSections.automation}
                icon={Sparkles}
                label={t("profiles.sections.automation")}
                detail={t("profiles.sections.automationDetail")}
                onChange={(checked) =>
                  setExportSections((s) => ({ ...s, automation: checked }))
                }
              />
              <SectionCheckbox
                checked={exportSections.history}
                icon={History}
                label={t("profiles.sections.history")}
                detail={t("profiles.sections.historyDetail", {
                  events: eventsCount,
                  chat: chatCount,
                })}
                onChange={(checked) =>
                  setExportSections((s) => ({ ...s, history: checked }))
                }
              />
            </div>

            <div className="flex items-start gap-2 rounded-xl border border-line/80 bg-black/20 px-3 py-2 text-[11px] text-zinc-400">
              <Info size={14} className="mt-0.5 shrink-0 text-accent" />
              <span>{t("profiles.securityNote")}</span>
            </div>

            <div className="flex flex-wrap justify-end gap-2 pt-1">
              <Button type="button" onClick={() => setExportOpen(false)}>
                {t("common.cancel")}
              </Button>
              <Button
                disabled={busy || !anyExportSectionSelected}
                onClick={() => {
                  setBusy(true);
                  void runtime
                    .exportProfiles({
                      scope: exportScope,
                      targetProfileId: exportTargetId,
                      included: exportSections,
                      mode: "clipboard",
                    })
                    .finally(() => setBusy(false));
                }}
              >
                <Copy size={14} />
                {t("profiles.copyJson")}
              </Button>
              <Button
                variant="primary"
                disabled={busy || !anyExportSectionSelected}
                onClick={() => {
                  setBusy(true);
                  void runtime
                    .exportProfiles({
                      scope: exportScope,
                      targetProfileId: exportTargetId,
                      included: exportSections,
                      mode: "file",
                    })
                    .then((res) => {
                      if (res !== "cancelled") setExportOpen(false);
                    })
                    .catch((error) => {
                      toast.error(t("profiles.exportError"), {
                        description: errorMessage(error),
                      });
                    })
                    .finally(() => setBusy(false));
                }}
              >
                <Download size={14} />
                {t("profiles.exportFile")}
              </Button>
            </div>
          </div>
        </ModalShell>
      )}

      {importOpen && (
        <ModalShell title={t("profiles.importTitle")} onClose={() => setImportOpen(false)}>
          <div className="space-y-4">
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(event) => {
                void readImportFile(event.target.files?.[0]);
                event.target.value = "";
              }}
            />

            {!parsedBundle ? (
              <div className="space-y-3">
                <div
                  onDragOver={(event) => {
                    event.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(event) => {
                    event.preventDefault();
                    setDragOver(false);
                    void readImportFile(event.dataTransfer.files?.[0]);
                  }}
                  className={`flex flex-col items-center justify-center rounded-xl border border-dashed px-5 py-7 text-center transition ${
                    dragOver
                      ? "border-accent bg-accent-soft/50"
                      : "border-line bg-black/20 hover:border-white/20"
                  }`}
                >
                  <span className="mb-2.5 grid size-10 place-items-center rounded-xl bg-accent-soft text-accent">
                    <FileJson size={18} />
                  </span>
                  <div className="text-xs font-medium text-zinc-200">
                    {t("profiles.dropzoneTitle")}
                  </div>
                  <div className="mt-1 text-[11px] text-zinc-500">
                    {t("profiles.dropzoneHint")}
                  </div>
                  <div className="mt-4 flex flex-wrap justify-center gap-2">
                    <Button
                      variant="primary"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <Upload size={14} />
                      {t("profiles.chooseFile")}
                    </Button>
                    <Button onClick={() => setPasteMode((v) => !v)}>
                      {t("profiles.pasteJson")}
                    </Button>
                  </div>
                </div>

                {pasteMode && (
                  <div className="space-y-2">
                    <textarea
                      rows={5}
                      className="input h-auto! py-2 font-mono text-[11px]!"
                      placeholder={t("profiles.pasteJsonPlaceholder")}
                      value={pasteText}
                      onChange={(event) => setPasteText(event.target.value)}
                    />
                    <div className="flex justify-end">
                      <Button
                        variant="primary"
                        disabled={!pasteText.trim()}
                        onClick={() => handleParsedText(pasteText)}
                      >
                        {t("profiles.loadJson")}
                      </Button>
                    </div>
                  </div>
                )}

                {importError && (
                  <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                    {importError}
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                <div className="rounded-xl border border-line bg-black/20 p-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge tone="purple">
                        {parsedBundle.profiles.length > 1
                          ? t("profiles.scopeAll", { count: parsedBundle.profiles.length })
                          : t("profiles.scopeSingle")}
                      </Badge>
                      {importSummary?.first?.twitchLogin && (
                        <Badge tone="neutral">@{importSummary.first.twitchLogin}</Badge>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setParsedBundle(undefined);
                        setImportError(undefined);
                      }}
                      className="text-[11px] text-accent hover:brightness-125"
                    >
                      {t("profiles.chooseAnother")}
                    </button>
                  </div>
                  <div className="mt-2 text-xs font-semibold text-zinc-100">
                    {parsedBundle.profiles.map((p) => p.name).join(", ")}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-2.5 gap-y-1 text-[11px] text-zinc-400">
                    <span>
                      {t("profiles.summaryCounts", {
                        commands: importSummary?.commands ?? 0,
                        variables: importSummary?.variables ?? 0,
                        widgets: importSummary?.widgets ?? 0,
                      })}
                    </span>
                    {Boolean(importSummary?.browserSources) && (
                      <span>
                        {t("profiles.browserSourcesCount", {
                          count: importSummary?.browserSources ?? 0,
                        })}
                      </span>
                    )}
                    {Boolean(importSummary?.events || importSummary?.chatMessages) && (
                      <span>
                        {t("profiles.sections.historyDetail", {
                          events: importSummary?.events ?? 0,
                          chat: importSummary?.chatMessages ?? 0,
                        })}
                      </span>
                    )}
                  </div>
                </div>

                <div>
                  <span className="mb-1.5 block text-xs font-medium text-zinc-300">
                    {t("profiles.importModeLabel")}
                  </span>
                  {parsedBundle.profiles.length === 1 ? (
                    <div className="grid grid-cols-2 gap-2">
                      {(["new", "overwrite"] as const).map((mode) => (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => setImportMode(mode)}
                          className={`rounded-xl border px-3 py-2 text-left text-xs transition ${
                            importMode === mode
                              ? "border-accent/40 bg-accent-soft text-white"
                              : "border-line bg-black/15 text-zinc-400 hover:bg-white/5"
                          }`}
                        >
                          <div className="font-semibold">
                            {t(`profiles.importMode.${mode}.title`)}
                          </div>
                          <div className="mt-0.5 text-[10.5px] text-zinc-500">
                            {t(`profiles.importMode.${mode}.detail`)}
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      {(["merge", "replace_all"] as const).map((mode) => (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => setImportMode(mode)}
                          className={`rounded-xl border px-3 py-2 text-left text-xs transition ${
                            importMode === mode
                              ? "border-accent/40 bg-accent-soft text-white"
                              : "border-line bg-black/15 text-zinc-400 hover:bg-white/5"
                          }`}
                        >
                          <div className="font-semibold">
                            {t(`profiles.importMode.${mode}.title`)}
                          </div>
                          <div className="mt-0.5 text-[10.5px] text-zinc-500">
                            {t(`profiles.importMode.${mode}.detail`)}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {importMode === "new" && (
                  <div className="space-y-2.5 rounded-xl border border-line bg-black/15 p-3">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-zinc-300">
                        {t("profiles.profileName")}
                      </label>
                      <input
                        className="input"
                        value={importName}
                        onChange={(event) => setImportName(event.target.value)}
                      />
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-zinc-300">{t("profiles.activateAfterImport")}</span>
                      <Toggle
                        label={t("profiles.activateAfterImport")}
                        value={activateImported}
                        onChange={setActivateImported}
                      />
                    </div>
                    {twitchConnected && twitch.account && (
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-zinc-300">
                          {t("profiles.linkTwitchAccount", { account: twitch.account })}
                        </span>
                        <Toggle
                          label={t("profiles.linkTwitchAccount", { account: twitch.account })}
                          value={linkImportedTwitch}
                          onChange={setLinkImportedTwitch}
                        />
                      </div>
                    )}
                  </div>
                )}

                {(importMode === "overwrite" || importMode === "merge") && (
                  <div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-black/15 px-3.5 py-2.5 text-xs">
                    <div className="min-w-0">
                      <div className="font-medium text-zinc-200">
                        {t("profiles.mergeCollections")}
                      </div>
                      <div className="text-[10.5px] text-zinc-500">
                        {t("profiles.mergeCollectionsDetail")}
                      </div>
                    </div>
                    <Toggle
                      label={t("profiles.mergeCollections")}
                      value={mergeCollections}
                      onChange={setMergeCollections}
                    />
                  </div>
                )}

                <div className="space-y-1.5">
                  <span className="block text-xs font-medium text-zinc-300">
                    {t("profiles.sectionsToApply")}
                  </span>
                  <SectionCheckbox
                    checked={importSections.appearance}
                    disabled={!parsedBundle.included.appearance}
                    icon={Bell}
                    label={t("profiles.sections.appearance")}
                    detail={t("profiles.sections.appearanceDetail")}
                    onChange={(checked) =>
                      setImportSections((s) => ({ ...s, appearance: checked }))
                    }
                  />
                  <SectionCheckbox
                    checked={importSections.dashboard}
                    disabled={!parsedBundle.included.dashboard}
                    icon={LayoutDashboard}
                    label={t("profiles.sections.dashboard")}
                    detail={t("profiles.sections.dashboardDetail")}
                    onChange={(checked) =>
                      setImportSections((s) => ({ ...s, dashboard: checked }))
                    }
                  />
                  <SectionCheckbox
                    checked={importSections.chatAndObs}
                    disabled={!parsedBundle.included.chatAndObs}
                    icon={MessageSquare}
                    label={t("profiles.sections.chatAndObs")}
                    detail={t("profiles.sections.chatAndObsDetail")}
                    onChange={(checked) =>
                      setImportSections((s) => ({ ...s, chatAndObs: checked }))
                    }
                  />
                  <SectionCheckbox
                    checked={importSections.automation}
                    disabled={!parsedBundle.included.automation}
                    icon={Sparkles}
                    label={t("profiles.sections.automation")}
                    detail={t("profiles.sections.automationDetail")}
                    onChange={(checked) =>
                      setImportSections((s) => ({ ...s, automation: checked }))
                    }
                  />
                  {(importSummary?.events || importSummary?.chatMessages) ? (
                    <SectionCheckbox
                      checked={importSections.history}
                      icon={History}
                      label={t("profiles.sections.history")}
                      detail={t("profiles.sections.historyDetail", {
                        events: importSummary?.events ?? 0,
                        chat: importSummary?.chatMessages ?? 0,
                      })}
                      onChange={(checked) =>
                        setImportSections((s) => ({ ...s, history: checked }))
                      }
                    />
                  ) : null}
                </div>

                <div className="flex justify-end gap-2 pt-1">
                  <Button type="button" onClick={() => setImportOpen(false)}>
                    {t("common.cancel")}
                  </Button>
                  <Button
                    variant="primary"
                    disabled={busy || !anyImportSectionSelected}
                    onClick={() => {
                      setBusy(true);
                      void runtime
                        .importProfiles(parsedBundle, {
                          mode: importMode,
                          profileName: importName,
                          activateAfterImport: activateImported,
                          linkCurrentTwitch: linkImportedTwitch,
                          mergeCollections,
                          sections: importSections,
                        })
                        .then(() => setImportOpen(false))
                        .catch((error) => {
                          toast.error(t("profiles.importError"), {
                            description: errorMessage(error),
                          });
                        })
                        .finally(() => setBusy(false));
                    }}
                  >
                    <Upload size={14} />
                    {t("profiles.importApply")}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </ModalShell>
      )}

      {deleteTarget && (
        <ModalShell
          title={t("profiles.deleteTitle", { name: deleteTarget.name })}
          onClose={() => setDeleteTarget(undefined)}
        >
          <div className="space-y-4">
            <p className="text-xs leading-5 text-zinc-400">
              {t("profiles.deleteConfirm", { name: deleteTarget.name })}
            </p>
            <div className="flex justify-end gap-2">
              <Button type="button" onClick={() => setDeleteTarget(undefined)}>
                {t("common.cancel")}
              </Button>
              <Button
                variant="danger"
                disabled={busy}
                onClick={() => {
                  const id = deleteTarget.id;
                  setDeleteTarget(undefined);
                  setBusy(true);
                  void runtime.deleteProfile(id).finally(() => setBusy(false));
                }}
              >
                <Trash2 size={14} />
                {t("common.delete")}
              </Button>
            </div>
          </div>
        </ModalShell>
      )}
    </section>
  );
}
