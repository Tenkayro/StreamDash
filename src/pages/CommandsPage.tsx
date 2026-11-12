import {
  ArrowUpDown,
  Pencil,
  Plus,
  Search,
  Terminal,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  PageHeader,
  ScrollFade,
  Select,
  Toggle,
} from "../components/ui";
import { useAppStore } from "../stores/app-store";
import { twitchNative } from "../services/native";
import { TWITCH_CLIENT_ID } from "../services/twitch/config";
import { cn } from "../lib/utils";
import type {
  ChatCommand,
  CommandExpiryAction,
  CommandResponseType,
  CommandRole,
} from "../types";

type CommandListTab = "custom" | "default";
type ModalSection =
  | "general"
  | "aliases"
  | "conditions"
  | "titleGame"
  | "expiry";

const ALL_ROLES: CommandRole[] = [
  "non_subscriber",
  "subscriber",
  "founder",
  "vip",
  "moderator",
  "broadcaster",
];

const RESPONSE_TYPES: CommandResponseType[] = [
  "say",
  "mention",
  "reply",
  "whisper",
];

const EXPIRY_ACTIONS: CommandExpiryAction[] = ["none", "disable", "delete"];

function createNewCommand(): ChatCommand {
  return {
    id: `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: "",
    usePrefix: true,
    enabled: true,
    response: "",
    globalCooldown: 5,
    perUserCooldown: 15,
    responseType: "say",
    aliases: [],
    keywords: [],
    enabledWhenOffline: true,
    enabledWhenOnline: true,
    hiddenFromPublic: false,
    whisperOnCooldown: false,
    roles: [],
    games: [],
    titleKeywords: [],
    useRelativeTime: true,
    expiryAction: "none",
    expiresInSeconds: 600,
    createdAt: Date.now(),
  };
}

export function CommandsPage() {
  const { t } = useTranslation();
  const commands = useAppStore((s) => s.commands);
  const upsertCommand = useAppStore((s) => s.upsertCommand);
  const deleteCommand = useAppStore((s) => s.deleteCommand);
  const toggleCommand = useAppStore((s) => s.toggleCommand);
  const twitch = useAppStore((s) => s.twitch);
  const setPage = useAppStore((s) => s.setPage);

  const [tab, setTab] = useState<CommandListTab>("custom");
  const [search, setSearch] = useState("");
  const [sortAsc, setSortAsc] = useState(true);
  const [editing, setEditing] = useState<ChatCommand | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [section, setSection] = useState<ModalSection>("general");

  const [aliasDraft, setAliasDraft] = useState("");
  const [keywordDraft, setKeywordDraft] = useState("");
  const [gameQuery, setGameQuery] = useState("");
  const [gameSuggestions, setGameSuggestions] = useState<string[]>([]);
  const [titleKeywordDraft, setTitleKeywordDraft] = useState("");

  const connected = twitch.phase === "connected" && Boolean(twitch.userId);

  useEffect(() => {
    const term = gameQuery.trim();
    if (!connected || term.length < 2) {
      setGameSuggestions([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const res = await twitchNative.helix<{
          data: Array<{ id: string; name: string }>;
        }>(TWITCH_CLIENT_ID, "search/categories", [
          ["query", term],
          ["first", "6"],
        ]);
        if (!cancelled) {
          setGameSuggestions((res.data ?? []).map((item) => item.name));
        }
      } catch {
        if (!cancelled) setGameSuggestions([]);
      }
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [connected, gameQuery]);

  const filteredCommands = useMemo(() => {
    const q = search.trim().toLowerCase();
    return commands
      .filter((cmd) => (tab === "default" ? Boolean(cmd.builtIn) : !cmd.builtIn))
      .filter((cmd) => {
        if (!q) return true;
        const trigger = `${cmd.usePrefix ? "!" : ""}${cmd.name}`.toLowerCase();
        return (
          trigger.includes(q) ||
          cmd.response.toLowerCase().includes(q) ||
          cmd.aliases.some((a) => a.toLowerCase().includes(q)) ||
          cmd.keywords.some((k) => k.toLowerCase().includes(q))
        );
      })
      .sort((a, b) => {
        const cmp = a.name.localeCompare(b.name);
        return sortAsc ? cmp : -cmp;
      });
  }, [commands, search, sortAsc, tab]);

  const openCreate = () => {
    setIsNew(true);
    setSection("general");
    setAliasDraft("");
    setKeywordDraft("");
    setGameQuery("");
    setTitleKeywordDraft("");
    setEditing(createNewCommand());
  };

  const openEdit = (cmd: ChatCommand) => {
    setIsNew(false);
    setSection("general");
    setAliasDraft("");
    setKeywordDraft("");
    setGameQuery("");
    setTitleKeywordDraft("");
    setEditing({
      ...cmd,
      aliases: [...cmd.aliases],
      keywords: [...cmd.keywords],
      roles: [...cmd.roles],
      games: [...cmd.games],
      titleKeywords: [...cmd.titleKeywords],
    });
  };

  const addAlias = () => {
    if (!editing) return;
    const clean = aliasDraft.trim().replace(/^!+/, "");
    if (!clean) return;
    if (!editing.aliases.some((a) => a.toLowerCase() === clean.toLowerCase())) {
      setEditing({ ...editing, aliases: [...editing.aliases, clean] });
    }
    setAliasDraft("");
  };

  const addKeyword = () => {
    if (!editing) return;
    const clean = keywordDraft.trim();
    if (!clean) return;
    if (
      !editing.keywords.some((k) => k.toLowerCase() === clean.toLowerCase())
    ) {
      setEditing({ ...editing, keywords: [...editing.keywords, clean] });
    }
    setKeywordDraft("");
  };

  const addGame = (name: string) => {
    if (!editing) return;
    const clean = name.trim();
    if (!clean) return;
    if (!editing.games.some((g) => g.toLowerCase() === clean.toLowerCase())) {
      setEditing({ ...editing, games: [...editing.games, clean] });
    }
    setGameQuery("");
    setGameSuggestions([]);
  };

  const addTitleKeyword = () => {
    if (!editing) return;
    const clean = titleKeywordDraft.trim();
    if (!clean) return;
    if (
      !editing.titleKeywords.some(
        (tk) => tk.toLowerCase() === clean.toLowerCase(),
      )
    ) {
      setEditing({
        ...editing,
        titleKeywords: [...editing.titleKeywords, clean],
      });
    }
    setTitleKeywordDraft("");
  };

  const toggleRole = (role: CommandRole) => {
    if (!editing) return;
    const has = editing.roles.includes(role);
    setEditing({
      ...editing,
      roles: has
        ? editing.roles.filter((r) => r !== role)
        : [...editing.roles, role],
    });
  };

  const handleSave = () => {
    if (!editing) return;
    const cleanName = editing.name.trim().replace(/^!+/, "");
    if (!cleanName) {
      toast.error(t("commands.enterNameError"));
      setSection("general");
      return;
    }
    if (!editing.builtIn && !editing.response.trim()) {
      toast.error(t("commands.enterResponseError"));
      setSection("general");
      return;
    }
    const duplicate = commands.some(
      (cmd) =>
        cmd.id !== editing.id &&
        cmd.name.trim().replace(/^!+/, "").toLowerCase() ===
          cleanName.toLowerCase() &&
        cmd.usePrefix === editing.usePrefix,
    );
    if (duplicate) {
      toast.error(t("commands.duplicateError"));
      setSection("general");
      return;
    }

    const expiresInSeconds = Math.max(
      1,
      Math.round(Number(editing.expiresInSeconds) || 600),
    );
    const expiresAt =
      editing.expiryAction === "none"
        ? undefined
        : editing.useRelativeTime
          ? Date.now() + expiresInSeconds * 1000
          : editing.expiresAt;

    upsertCommand({
      ...editing,
      name: cleanName,
      response: editing.response.slice(0, 500),
      globalCooldown: Math.max(0, Math.round(Number(editing.globalCooldown) || 0)),
      perUserCooldown: Math.max(
        0,
        Math.round(Number(editing.perUserCooldown) || 0),
      ),
      expiresInSeconds,
      expiresAt,
    });
    toast.success(
      isNew ? t("commands.createdSuccess") : t("commands.updatedSuccess"),
    );
    setEditing(null);
  };

  const modalSections: Array<{ id: ModalSection; label: string }> = [
    { id: "general", label: t("commands.sections.general") },
    { id: "aliases", label: t("commands.sections.aliases") },
    { id: "conditions", label: t("commands.sections.conditions") },
    { id: "titleGame", label: t("commands.sections.titleGame") },
    { id: "expiry", label: t("commands.sections.expiry") },
  ];

  return (
    <>
      <PageHeader
        icon={Terminal}
        title={t("commands.title")}
        description={t("pageDescriptions.commands")}
        actions={
          <Button variant="primary" onClick={openCreate}>
            <Plus size={15} />
            {t("commands.create")}
          </Button>
        }
      />

      <div className="mb-2.5 flex shrink-0 flex-wrap items-center justify-between gap-2.5">
        <div
          role="tablist"
          aria-label={t("commands.title")}
          className="inline-flex rounded-xl border border-line bg-black/20 p-1"
        >
          {(["custom", "default"] as const).map((key) => {
            const count = commands.filter((c) =>
              key === "default" ? Boolean(c.builtIn) : !c.builtIn,
            ).length;
            return (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                onClick={() => setTab(key)}
                className={cn(
                  "rounded-lg px-3 py-1 text-xs font-medium transition",
                  tab === key
                    ? "bg-accent/20 text-accent"
                    : "text-zinc-400 hover:text-zinc-200",
                )}
              >
                {t(`commands.tabs.${key}`)}
                <span className="ml-1.5 text-[10px] text-zinc-500">
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        <div className="relative min-w-60 flex-1 sm:max-w-sm">
          <Search
            size={14}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500"
          />
          <input
            className="input input-leading-icon input-trailing-action w-full"
            placeholder={t("commands.searchPlaceholder")}
            aria-label={t("commands.searchPlaceholder")}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              aria-label={t("activity.clearSearch")}
              className="absolute right-2 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-md text-zinc-500 hover:bg-white/5 hover:text-zinc-200"
            >
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="grid shrink-0 grid-cols-[minmax(120px,190px)_1fr_auto] items-center gap-3 border-b border-line bg-white/[.015] px-4 py-2.5 text-xs font-semibold text-zinc-300">
          <button
            type="button"
            onClick={() => setSortAsc((prev) => !prev)}
            className="inline-flex items-center gap-1 text-left transition hover:text-zinc-100"
          >
            <span>{t("commands.table.name")}</span>
            <ArrowUpDown size={12} className="text-zinc-500" />
          </button>
          <span>{t("commands.table.response")}</span>
          <span className="sr-only">{t("commands.table.actions")}</span>
        </div>

        {!filteredCommands.length ? (
          <div className="grid min-h-0 flex-1 place-items-center">
            <EmptyState
              icon={<Terminal size={26} />}
              title={
                search
                  ? t("commands.noMatches")
                  : t("commands.emptyTitle")
              }
              body={
                search
                  ? t("commands.noMatchesDetail")
                  : t("commands.emptyBody")
              }
              action={
                !search && tab === "custom" ? (
                  <Button variant="primary" onClick={openCreate}>
                    <Plus size={15} />
                    {t("commands.create")}
                  </Button>
                ) : undefined
              }
            />
          </div>
        ) : (
          <ScrollFade className="flex min-h-0 flex-1 flex-col" color="#242526" size={32}>
            <div className="min-h-0 flex-1 divide-y divide-line overflow-y-auto">
              {filteredCommands.map((cmd) => {
                const triggerLabel = `${cmd.usePrefix ? "!" : ""}${cmd.name}`;
                return (
                  <div
                    key={cmd.id}
                    className="grid grid-cols-1 items-center gap-2.5 px-4 py-2.5 transition hover:bg-white/2 sm:grid-cols-[minmax(120px,190px)_1fr_auto]"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="truncate font-mono text-xs font-semibold text-zinc-100">
                          {triggerLabel}
                        </span>
                        {!cmd.usePrefix && (
                          <Badge tone="neutral">
                            {t("commands.noPrefixBadge")}
                          </Badge>
                        )}
                        {cmd.aliases.length > 0 && (
                          <Badge tone="purple">
                            +{cmd.aliases.length}
                          </Badge>
                        )}
                      </div>
                      {(cmd.roles.length > 0 || cmd.keywords.length > 0) && (
                        <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[10.5px] text-zinc-500">
                          {cmd.roles.length > 0 && (
                            <span>
                              {cmd.roles
                                .map((role) => t(`commands.roles.${role}`))
                                .join(", ")}
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="min-w-0">
                      <p className="line-clamp-2 text-xs leading-5 text-zinc-300">
                        {cmd.builtIn && cmd.id === "builtin-song"
                          ? t("commands.builtInSongDescription")
                          : cmd.response}
                      </p>
                    </div>

                    <div className="flex shrink-0 items-center justify-end gap-1.5">
                      <Toggle
                        value={cmd.enabled}
                        onChange={(enabled) => toggleCommand(cmd.id, enabled)}
                        label={triggerLabel}
                      />
                      <button
                        type="button"
                        onClick={() => openEdit(cmd)}
                        title={t("commands.edit")}
                        aria-label={t("commands.edit")}
                        className="grid size-8 place-items-center rounded-lg border border-line bg-white/3 text-zinc-400 transition hover:border-accent/35 hover:text-accent"
                      >
                        <Pencil size={13} />
                      </button>
                      {!cmd.builtIn && (
                        <button
                          type="button"
                          onClick={() => {
                            deleteCommand(cmd.id);
                            toast.success(t("commands.deletedSuccess"));
                          }}
                          title={t("commands.delete")}
                          aria-label={t("commands.delete")}
                          className="grid size-8 place-items-center rounded-lg border border-line bg-white/3 text-zinc-400 transition hover:border-red-400/35 hover:bg-red-500/10 hover:text-red-300"
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollFade>
        )}
      </Card>

      {editing && (
        <div
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setEditing(null);
          }}
          className="fixed inset-0 z-90 flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm sm:p-4"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={
              isNew ? t("commands.createTitle") : t("commands.editTitle")
            }
            className="flex max-h-[min(560px,calc(100vh-2rem))] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-line bg-[#1e1f21] shadow-2xl shadow-black/70"
          >
            <div className="flex shrink-0 items-center justify-between border-b border-line px-5 py-3.5">
              <h2 className="text-base font-semibold text-zinc-100">
                {isNew ? t("commands.createTitle") : t("commands.editTitle")}
              </h2>
              <button
                type="button"
                onClick={() => setEditing(null)}
                aria-label={t("titleBar.close")}
                className="grid size-7 place-items-center rounded-lg border border-line text-zinc-400 transition hover:bg-white/5 hover:text-zinc-100"
              >
                <X size={14} />
              </button>
            </div>

            <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden sm:grid-cols-[195px_1fr]">
              <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-line bg-black/20 p-2.5 sm:flex-col sm:border-b-0 sm:border-r">
                {modalSections.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setSection(item.id)}
                    className={cn(
                      "shrink-0 rounded-lg px-3 py-2 text-left text-xs font-medium transition",
                      section === item.id
                        ? "border border-accent/35 bg-accent/15 text-accent"
                        : "border border-transparent text-zinc-300 hover:bg-white/4 hover:text-zinc-100",
                    )}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                {section === "general" && (
                  <div className="space-y-3.5">
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="flex min-w-0 flex-1 items-center overflow-hidden rounded-lg border border-line bg-black/25 focus-within:border-accent/45">
                        <button
                          type="button"
                          disabled={editing.builtIn}
                          title={t("commands.prefixToggleHint")}
                          aria-pressed={editing.usePrefix}
                          onClick={() =>
                            setEditing({
                              ...editing,
                              usePrefix: !editing.usePrefix,
                            })
                          }
                          className={cn(
                            "flex h-9 shrink-0 items-center border-r border-line px-3 font-mono text-xs font-bold transition",
                            editing.usePrefix
                              ? "bg-accent/20 text-accent"
                              : "bg-white/3 text-zinc-600 line-through hover:text-zinc-300",
                          )}
                        >
                          !
                        </button>
                        <input
                          className="h-9 min-w-0 flex-1 bg-transparent px-3 text-xs text-zinc-100 outline-none placeholder:text-zinc-600 disabled:opacity-60"
                          disabled={editing.builtIn}
                          placeholder={t("commands.namePlaceholder")}
                          value={editing.name}
                          onChange={(event) =>
                            setEditing({
                              ...editing,
                              name: event.target.value.replace(/^!+/, ""),
                            })
                          }
                        />
                      </div>

                      <div className="flex items-center gap-2">
                        <Toggle
                          value={editing.enabled}
                          onChange={(enabled) =>
                            setEditing({ ...editing, enabled })
                          }
                          label={t("commands.enabled")}
                        />
                        <span className="text-xs font-semibold text-zinc-200">
                          {t("commands.enabled")}
                        </span>
                      </div>
                    </div>
                    <p className="text-[11px] text-muted">
                      {t("commands.prefixToggleHint")}
                    </p>

                    <div>
                      <label
                        htmlFor="cmd-response"
                        className="mb-1.5 block text-xs font-semibold text-zinc-200"
                      >
                        {t("commands.response")}
                      </label>
                      {editing.builtIn && editing.id === "builtin-song" ? (
                        <div className="rounded-lg border border-line bg-black/25 px-3 py-2.5 text-xs text-zinc-400">
                          {t("commands.builtInSongDescription")}
                        </div>
                      ) : (
                        <>
                          <textarea
                            id="cmd-response"
                            rows={3}
                            maxLength={500}
                            placeholder={t("commands.responsePlaceholder")}
                            value={editing.response}
                            onChange={(event) =>
                              setEditing({
                                ...editing,
                                response: event.target.value,
                              })
                            }
                            className="w-full resize-none rounded-lg border border-line bg-black/25 px-3 py-2 text-xs leading-5 text-zinc-100 outline-none transition focus:border-accent/45"
                          />
                          <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted">
                            <span>
                              {t("commands.charactersUsed", {
                                count: editing.response.length,
                                max: 500,
                              })}
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                setEditing(null);
                                setPage("variables");
                              }}
                              className="text-accent hover:underline"
                            >
                              {t("commands.variablesHint")}
                            </button>
                          </div>
                        </>
                      )}
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <label
                          htmlFor="cmd-global-cd"
                          className="mb-1 block text-xs font-semibold text-zinc-200"
                        >
                          {t("commands.globalCooldown")}
                        </label>
                        <div className="relative">
                          <input
                            id="cmd-global-cd"
                            type="number"
                            min={0}
                            max={86400}
                            className="input w-full pr-14 tabular-nums"
                            value={editing.globalCooldown}
                            onChange={(event) =>
                              setEditing({
                                ...editing,
                                globalCooldown: Math.max(
                                  0,
                                  Number(event.target.value) || 0,
                                ),
                              })
                            }
                          />
                          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted">
                            {t("commands.secs")}
                          </span>
                        </div>
                      </div>

                      <div>
                        <label
                          htmlFor="cmd-user-cd"
                          className="mb-1 block text-xs font-semibold text-zinc-200"
                        >
                          {t("commands.perUserCooldown")}
                        </label>
                        <div className="relative">
                          <input
                            id="cmd-user-cd"
                            type="number"
                            min={0}
                            max={86400}
                            className="input w-full pr-14 tabular-nums"
                            value={editing.perUserCooldown}
                            onChange={(event) =>
                              setEditing({
                                ...editing,
                                perUserCooldown: Math.max(
                                  0,
                                  Number(event.target.value) || 0,
                                ),
                              })
                            }
                          />
                          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted">
                            {t("commands.secs")}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div>
                      <label
                        htmlFor="cmd-response-type"
                        className="mb-1 block text-xs font-semibold text-zinc-200"
                      >
                        {t("commands.responseType")}
                      </label>
                      <Select
                        id="cmd-response-type"
                        className="input w-full"
                        value={editing.responseType}
                        onChange={(event) =>
                          setEditing({
                            ...editing,
                            responseType: event.target
                              .value as CommandResponseType,
                          })
                        }
                      >
                        {RESPONSE_TYPES.map((rt) => (
                          <option key={rt} value={rt}>
                            {t(`commands.responseTypes.${rt}.label`)}
                          </option>
                        ))}
                      </Select>
                      <p className="mt-1 text-[11px] text-muted">
                        {t(
                          `commands.responseTypes.${editing.responseType}.description`,
                        )}
                      </p>
                    </div>
                  </div>
                )}

                {section === "aliases" && (
                  <div className="space-y-4">
                    <div>
                      <label
                        htmlFor="cmd-alias-input"
                        className="mb-1 block text-xs font-semibold text-zinc-200"
                      >
                        {t("commands.aliases")}
                      </label>
                      <div className="flex gap-2">
                        <div className="flex min-w-0 flex-1 items-center overflow-hidden rounded-lg border border-line bg-black/25 focus-within:border-accent/45">
                          {editing.usePrefix && (
                            <span className="pl-3 font-mono text-xs font-semibold text-zinc-500">
                              !
                            </span>
                          )}
                          <input
                            id="cmd-alias-input"
                            className="h-9 min-w-0 flex-1 bg-transparent px-2.5 text-xs text-zinc-100 outline-none placeholder:text-zinc-600"
                            placeholder={t("commands.aliasPlaceholder")}
                            value={aliasDraft}
                            onChange={(event) =>
                              setAliasDraft(event.target.value)
                            }
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault();
                                addAlias();
                              }
                            }}
                          />
                        </div>
                        <Button variant="default" onClick={addAlias}>
                          {t("commands.create")}
                        </Button>
                      </div>
                      <p className="mt-1 text-[11px] text-muted">
                        {t("commands.aliasesHint")}
                      </p>
                      {editing.aliases.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {editing.aliases.map((alias) => (
                            <span
                              key={alias}
                              className="inline-flex items-center gap-1 rounded-lg border border-line bg-white/4 px-2 py-1 font-mono text-xs text-zinc-200"
                            >
                              {editing.usePrefix ? `!${alias}` : alias}
                              <button
                                type="button"
                                onClick={() =>
                                  setEditing({
                                    ...editing,
                                    aliases: editing.aliases.filter(
                                      (a) => a !== alias,
                                    ),
                                  })
                                }
                                className="text-zinc-500 hover:text-zinc-200"
                              >
                                <X size={12} />
                              </button>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    <div>
                      <label
                        htmlFor="cmd-keyword-input"
                        className="mb-1 block text-xs font-semibold text-zinc-200"
                      >
                        {t("commands.keywords")}
                      </label>
                      <div className="flex gap-2">
                        <input
                          id="cmd-keyword-input"
                          className="input min-w-0 flex-1"
                          placeholder={t("commands.keywordPlaceholder")}
                          value={keywordDraft}
                          onChange={(event) =>
                            setKeywordDraft(event.target.value)
                          }
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              addKeyword();
                            }
                          }}
                        />
                        <Button variant="default" onClick={addKeyword}>
                          {t("commands.create")}
                        </Button>
                      </div>
                      <p className="mt-1 text-[11px] text-muted">
                        {t("commands.keywordsHint")}
                      </p>
                      {editing.keywords.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {editing.keywords.map((kw) => (
                            <span
                              key={kw}
                              className="inline-flex items-center gap-1 rounded-lg border border-line bg-white/4 px-2 py-1 text-xs text-zinc-200"
                            >
                              {kw}
                              <button
                                type="button"
                                onClick={() =>
                                  setEditing({
                                    ...editing,
                                    keywords: editing.keywords.filter(
                                      (k) => k !== kw,
                                    ),
                                  })
                                }
                                className="text-zinc-500 hover:text-zinc-200"
                              >
                                <X size={12} />
                              </button>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {section === "conditions" && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                      <label className="flex cursor-pointer items-center justify-between gap-2 rounded-xl border border-line bg-black/20 px-3 py-2">
                        <span className="text-xs font-medium text-zinc-200">
                          {t("commands.enabledWhenOffline")}
                        </span>
                        <Toggle
                          value={editing.enabledWhenOffline}
                          onChange={(enabledWhenOffline) =>
                            setEditing({ ...editing, enabledWhenOffline })
                          }
                          label={t("commands.enabledWhenOffline")}
                        />
                      </label>

                      <label className="flex cursor-pointer items-center justify-between gap-2 rounded-xl border border-line bg-black/20 px-3 py-2">
                        <span className="text-xs font-medium text-zinc-200">
                          {t("commands.enabledWhenOnline")}
                        </span>
                        <Toggle
                          value={editing.enabledWhenOnline}
                          onChange={(enabledWhenOnline) =>
                            setEditing({ ...editing, enabledWhenOnline })
                          }
                          label={t("commands.enabledWhenOnline")}
                        />
                      </label>

                      <label className="flex cursor-pointer items-center justify-between gap-2 rounded-xl border border-line bg-black/20 px-3 py-2">
                        <span className="text-xs font-medium text-zinc-200">
                          {t("commands.hiddenFromPublic")}
                        </span>
                        <Toggle
                          value={editing.hiddenFromPublic}
                          onChange={(hiddenFromPublic) =>
                            setEditing({ ...editing, hiddenFromPublic })
                          }
                          label={t("commands.hiddenFromPublic")}
                        />
                      </label>

                      <label className="flex cursor-pointer items-center justify-between gap-2 rounded-xl border border-line bg-black/20 px-3 py-2">
                        <span className="text-xs font-medium text-zinc-200">
                          {t("commands.whisperOnCooldown")}
                        </span>
                        <Toggle
                          value={editing.whisperOnCooldown}
                          onChange={(whisperOnCooldown) =>
                            setEditing({ ...editing, whisperOnCooldown })
                          }
                          label={t("commands.whisperOnCooldown")}
                        />
                      </label>
                    </div>

                    <div>
                      <div className="mb-1.5 text-xs font-semibold text-zinc-200">
                        {t("commands.rolesLabel")}
                      </div>
                      <div className="flex flex-wrap gap-1.5 rounded-xl border border-line bg-black/20 p-2.5">
                        {ALL_ROLES.map((role) => {
                          const active = editing.roles.includes(role);
                          return (
                            <button
                              key={role}
                              type="button"
                              aria-pressed={active}
                              onClick={() => toggleRole(role)}
                              className={cn(
                                "rounded-lg border px-2.5 py-1 text-xs font-medium transition",
                                active
                                  ? "border-accent/40 bg-accent/20 text-accent"
                                  : "border-line bg-white/3 text-zinc-400 hover:bg-white/6 hover:text-zinc-200",
                              )}
                            >
                              {t(`commands.roles.${role}`)}
                            </button>
                          );
                        })}
                      </div>
                      <p className="mt-1 text-[11px] text-muted">
                        {t("commands.rolesHint")}
                      </p>
                    </div>
                  </div>
                )}

                {section === "titleGame" && (
                  <div className="space-y-4">
                    <div>
                      <label
                        htmlFor="cmd-game-input"
                        className="mb-1 block text-xs font-semibold text-zinc-200"
                      >
                        {t("commands.games")}
                      </label>
                      <div className="flex gap-2">
                        <input
                          id="cmd-game-input"
                          className="input min-w-0 flex-1"
                          placeholder={t("commands.gamePlaceholder")}
                          value={gameQuery}
                          onChange={(event) => setGameQuery(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              addGame(gameQuery);
                            }
                          }}
                        />
                        <Button
                          variant="default"
                          onClick={() => addGame(gameQuery)}
                        >
                          {t("dashboard.add")}
                        </Button>
                      </div>
                      {gameSuggestions.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {gameSuggestions.map((suggestion) => (
                            <button
                              key={suggestion}
                              type="button"
                              onClick={() => addGame(suggestion)}
                              className="rounded-md border border-accent/25 bg-accent/10 px-2 py-0.5 text-[11px] text-accent transition hover:bg-accent/20"
                            >
                              + {suggestion}
                            </button>
                          ))}
                        </div>
                      )}
                      <p className="mt-1 text-[11px] text-muted">
                        {t("commands.gamesHint")}
                      </p>
                      {editing.games.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {editing.games.map((game) => (
                            <span
                              key={game}
                              className="inline-flex items-center gap-1 rounded-lg border border-line bg-white/4 px-2 py-1 text-xs text-zinc-200"
                            >
                              {game}
                              <button
                                type="button"
                                onClick={() =>
                                  setEditing({
                                    ...editing,
                                    games: editing.games.filter(
                                      (g) => g !== game,
                                    ),
                                  })
                                }
                                className="text-zinc-500 hover:text-zinc-200"
                              >
                                <X size={12} />
                              </button>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    <div>
                      <label
                        htmlFor="cmd-title-kw"
                        className="mb-1 block text-xs font-semibold text-zinc-200"
                      >
                        {t("commands.titleKeywords")}
                      </label>
                      <div className="flex gap-2">
                        <input
                          id="cmd-title-kw"
                          className="input min-w-0 flex-1"
                          placeholder={t("commands.titleKeywordPlaceholder")}
                          value={titleKeywordDraft}
                          onChange={(event) =>
                            setTitleKeywordDraft(event.target.value)
                          }
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              addTitleKeyword();
                            }
                          }}
                        />
                        <Button variant="default" onClick={addTitleKeyword}>
                          {t("dashboard.add")}
                        </Button>
                      </div>
                      <p className="mt-1 text-[11px] text-muted">
                        {t("commands.titleKeywordsHint")}
                      </p>
                      {editing.titleKeywords.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {editing.titleKeywords.map((kw) => (
                            <span
                              key={kw}
                              className="inline-flex items-center gap-1 rounded-lg border border-line bg-white/4 px-2 py-1 text-xs text-zinc-200"
                            >
                              {kw}
                              <button
                                type="button"
                                onClick={() =>
                                  setEditing({
                                    ...editing,
                                    titleKeywords:
                                      editing.titleKeywords.filter(
                                        (item) => item !== kw,
                                      ),
                                  })
                                }
                                className="text-zinc-500 hover:text-zinc-200"
                              >
                                <X size={12} />
                              </button>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {section === "expiry" && (
                  <div className="space-y-4">
                    <div className="flex items-center gap-3">
                      <Toggle
                        value={editing.useRelativeTime}
                        onChange={(useRelativeTime) =>
                          setEditing({ ...editing, useRelativeTime })
                        }
                        label={t("commands.useRelativeTime")}
                      />
                      <span className="text-xs font-semibold text-zinc-200">
                        {t("commands.useRelativeTime")}
                      </span>
                    </div>

                    <div>
                      <Select
                        className="input w-full"
                        aria-label={t("commands.sections.expiry")}
                        value={editing.expiryAction}
                        onChange={(event) =>
                          setEditing({
                            ...editing,
                            expiryAction: event.target
                              .value as CommandExpiryAction,
                          })
                        }
                      >
                        {EXPIRY_ACTIONS.map((action) => (
                          <option key={action} value={action}>
                            {t(`commands.expiryActions.${action}.label`)}
                          </option>
                        ))}
                      </Select>
                      <p className="mt-1 text-[11px] text-muted">
                        {t(
                          `commands.expiryActions.${editing.expiryAction}.description`,
                        )}
                      </p>
                    </div>

                    <div>
                      <label
                        htmlFor="cmd-expires-in"
                        className="mb-1 block text-xs font-semibold text-zinc-200"
                      >
                        {t("commands.expiresIn")}
                      </label>
                      <div className="relative">
                        <input
                          id="cmd-expires-in"
                          type="number"
                          min={1}
                          disabled={editing.expiryAction === "none"}
                          className="input w-full pr-20 tabular-nums disabled:opacity-45"
                          value={editing.expiresInSeconds}
                          onChange={(event) =>
                            setEditing({
                              ...editing,
                              expiresInSeconds: Math.max(
                                1,
                                Number(event.target.value) || 600,
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
                )}
              </div>
            </div>

            <div className="flex shrink-0 items-center justify-end gap-2 border-t border-line bg-black/25 px-5 py-3">
              <Button variant="default" onClick={() => setEditing(null)}>
                {t("dashboard.cancel")}
              </Button>
              <Button variant="primary" onClick={handleSave}>
                {t("commands.save")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
