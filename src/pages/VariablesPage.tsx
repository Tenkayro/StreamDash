import {
  Braces,
  Check,
  Copy,
  Hash,
  Minus,
  Plus,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
  Type,
} from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  PageHeader,
  ScrollFade,
} from "../components/ui";
import { useAppStore } from "../stores/app-store";
import {
  buildVariableMap,
  resolveVariables,
  VARIABLE_DEFINITIONS,
  type VariableCategory,
} from "../lib/variables";
import { cn } from "../lib/utils";
import type { CustomVariableType } from "../types";

type CategoryFilter = "all" | VariableCategory;

const CATEGORIES: CategoryFilter[] = [
  "all",
  "stream",
  "stats",
  "user",
  "events",
  "tools",
  "utility",
];

export function VariablesPage() {
  const { t } = useTranslation();
  const state = useAppStore();
  const {
    customVariables,
    upsertCustomVariable,
    deleteCustomVariable,
    adjustCustomCounter,
    setPage,
  } = state;

  const [category, setCategory] = useState<CategoryFilter>("all");
  const [search, setSearch] = useState("");
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [testTemplate, setTestTemplate] = useState(
    "Hey $(user)! $(channel) plays $(game) ($(status), $(uptime)) — $(followers) Followers & $(subscribers) Subs! Deaths: $(deaths)",
  );

  const [newVarName, setNewVarName] = useState("");
  const [newVarType, setNewVarType] = useState<CustomVariableType>("counter");
  const [newVarValue, setNewVarValue] = useState("0");

  const variableContext = useMemo(
    () => ({
      state,
      user: state.twitch.account || "Viewer",
      userLogin: (state.twitch.account || "viewer").toLowerCase(),
      rawMessageText: "!cmd StreamDash",
      commandCount: 5,
      deterministicPreview: true,
    }),
    [state],
  );

  const liveMap = useMemo(
    () => buildVariableMap(variableContext),
    [variableContext],
  );

  const resolvedPreview = useMemo(
    () => resolveVariables(testTemplate, variableContext),
    [testTemplate, variableContext],
  );

  const filteredVariables = useMemo(() => {
    const q = search.trim().toLowerCase();
    return VARIABLE_DEFINITIONS.filter((item) => {
      if (category !== "all" && item.category !== category) return false;
      if (!q) return true;
      const desc = t(item.descriptionKey).toLowerCase();
      const aliases = (item.aliases ?? []).join(" ").toLowerCase();
      return (
        item.token.toLowerCase().includes(q) ||
        item.key.toLowerCase().includes(q) ||
        aliases.includes(q) ||
        desc.includes(q)
      );
    });
  }, [category, search, t]);

  const copyToken = async (token: string) => {
    try {
      await navigator.clipboard.writeText(token);
      setCopiedToken(token);
      toast.success(t("variables.copied", { token }));
      window.setTimeout(() => {
        setCopiedToken((prev) => (prev === token ? null : prev));
      }, 1600);
    } catch {
      toast.error(t("donations.copyFailed"));
    }
  };

  const handleCreateCustom = (event: FormEvent) => {
    event.preventDefault();
    const clean = newVarName
      .trim()
      .replace(/^\$\(|\)$|^\{|\}$/g, "")
      .replace(/^custom\./i, "")
      .replace(/[^a-zA-Z0-9_.-]/g, "")
      .toLowerCase();
    if (!clean) {
      toast.error(t("variables.customNameRequired"));
      return;
    }
    upsertCustomVariable({
      id: `var-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: clean,
      type: newVarType,
      value:
        newVarType === "counter"
          ? String(Number.parseInt(newVarValue, 10) || 0)
          : newVarValue.trim(),
      updatedAt: Date.now(),
    });
    setNewVarName("");
    setNewVarValue(newVarType === "counter" ? "0" : "");
    toast.success(t("variables.customSaved", { token: `$(${clean})` }));
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-2.5">
      <PageHeader
        icon={Braces}
        title={t("nav.variables")}
        description={t("pageDescriptions.variables")}
        actions={
          <div className="flex items-center gap-2">
            <Badge tone="neutral">
              {t("variables.totalCount", {
                count: VARIABLE_DEFINITIONS.length + customVariables.length,
              })}
            </Badge>
            <Button onClick={() => setPage("commands")}>
              {t("nav.commands")}
            </Button>
            <Button onClick={() => setPage("chatAlerts")}>
              {t("nav.chatAlerts")}
            </Button>
          </div>
        }
      />

      {/* Live Variable Playground */}
      <Card className="shrink-0 p-3">
        <div className="grid gap-2.5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-[11px] font-semibold text-zinc-200">
                <Sparkles size={12} className="text-accent" />
                {t("variables.playgroundTitle")}
              </span>
              <span className="text-[10px] text-muted">
                {t("variables.syntaxHint")}
              </span>
            </div>
            <input
              className="input w-full font-mono text-xs"
              value={testTemplate}
              onChange={(event) => setTestTemplate(event.target.value)}
              placeholder={t("variables.playgroundPlaceholder")}
            />
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[11px] font-semibold text-zinc-200">
                {t("variables.liveOutput")}
              </span>
              <button
                type="button"
                onClick={() => void copyToken(testTemplate)}
                className="inline-flex items-center gap-1 text-[10.5px] text-accent hover:brightness-125"
              >
                <Copy size={11} />
                {t("variables.copyTemplate")}
              </button>
            </div>
            <div className="flex min-h-9 items-center rounded-lg border border-line bg-black/25 px-3 py-1.5 text-xs text-zinc-100">
              <span className="truncate">{resolvedPreview || "—"}</span>
            </div>
          </div>
        </div>
      </Card>

      {/* Main Content Grid */}
      <div className="grid min-h-0 flex-1 gap-3 xl:grid-cols-[minmax(0,1fr)_360px]">
        {/* Left: Built-in Variable Catalog */}
        <Card className="flex min-h-0 flex-col overflow-hidden p-3.5">
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 pb-3">
            <div className="flex flex-wrap items-center gap-1 rounded-xl border border-line bg-black/20 p-1">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setCategory(cat)}
                  className={cn(
                    "rounded-lg px-2.5 py-1 text-[11px] font-medium transition",
                    category === cat
                      ? "bg-white/10 text-zinc-100 shadow-xs"
                      : "text-muted hover:text-zinc-200",
                  )}
                >
                  {t(`variables.categories.${cat}`)}
                </button>
              ))}
            </div>
            <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
              <Search
                size={13}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500"
              />
              <input
                className="input input-leading-icon w-full text-xs"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t("variables.searchPlaceholder")}
              />
            </div>
          </div>

          <div className="grid shrink-0 grid-cols-[170px_minmax(0,1fr)_150px_68px] items-center gap-3 border-y border-line px-3 py-2 text-[10.5px] font-semibold uppercase tracking-wider text-muted">
            <span>{t("variables.columns.variable")}</span>
            <span>{t("variables.columns.description")}</span>
            <span>{t("variables.columns.liveValue")}</span>
            <span className="text-right">{t("variables.columns.action")}</span>
          </div>

          <ScrollFade className="min-h-0 flex-1 divide-y divide-line overflow-y-auto">
            {filteredVariables.length === 0 ? (
              <div className="py-10">
                <EmptyState
                  icon={<Braces size={22} />}
                  title={t("variables.emptyTitle")}
                  body={t("variables.emptyDescription")}
                />
              </div>
            ) : (
              filteredVariables.map((item) => {
                const liveValue = liveMap[item.key] ?? "—";
                const isCopied = copiedToken === item.token;
                return (
                  <div
                    key={item.key}
                    className="grid grid-cols-[170px_minmax(0,1fr)_150px_68px] items-center gap-3 px-3 py-2.5 text-xs transition hover:bg-white/2"
                  >
                    <div className="min-w-0">
                      <button
                        type="button"
                        onClick={() => void copyToken(item.token)}
                        title={t("variables.clickToCopy")}
                        className="inline-flex max-w-full items-center gap-1.5 truncate rounded-md border border-accent/25 bg-accent-soft px-2 py-0.5 font-mono text-[11px] font-semibold text-accent transition hover:border-accent/50"
                      >
                        <span className="truncate">{item.token}</span>
                      </button>
                      {item.aliases && item.aliases.length > 0 && (
                        <div className="mt-0.5 truncate font-mono text-[9.5px] text-zinc-500">
                          {item.aliases.join(", ")}
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 text-[11.5px] text-zinc-300">
                      {t(item.descriptionKey)}
                    </div>
                    <div className="min-w-0">
                      <span className="inline-block max-w-full truncate rounded-md border border-line bg-black/25 px-2 py-0.5 font-mono text-[11px] text-zinc-200">
                        {liveValue}
                      </span>
                    </div>
                    <div className="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        onClick={() =>
                          setTestTemplate((prev) =>
                            prev ? `${prev} ${item.token}` : item.token,
                          )
                        }
                        title={t("variables.insertIntoPlayground")}
                        className="grid size-7 place-items-center rounded-md border border-line bg-white/3 text-zinc-400 transition hover:border-white/20 hover:text-zinc-100"
                      >
                        <Plus size={12} />
                      </button>
                      <button
                        type="button"
                        onClick={() => void copyToken(item.token)}
                        title={t("variables.clickToCopy")}
                        className="grid size-7 place-items-center rounded-md border border-line bg-white/3 text-zinc-400 transition hover:border-accent/40 hover:text-accent"
                      >
                        {isCopied ? <Check size={12} /> : <Copy size={12} />}
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </ScrollFade>
        </Card>

        {/* Right: Custom Variables & Counters */}
        <Card className="flex min-h-0 flex-col overflow-hidden p-3.5">
          <div className="mb-2.5 shrink-0">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold text-zinc-100">
                {t("variables.customTitle")}
              </h2>
              <Badge tone="neutral">{customVariables.length}</Badge>
            </div>
            <p className="mt-0.5 text-[11px] text-muted">
              {t("variables.customSubtitle")}
            </p>
          </div>

          <form
            onSubmit={handleCreateCustom}
            className="mb-3 shrink-0 space-y-2 rounded-xl border border-line bg-black/20 p-2.5"
          >
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setNewVarType("counter");
                  if (!Number.isFinite(Number.parseInt(newVarValue, 10))) {
                    setNewVarValue("0");
                  }
                }}
                className={cn(
                  "flex items-center justify-center gap-1.5 rounded-lg border py-1.5 text-[11px] font-medium transition",
                  newVarType === "counter"
                    ? "border-accent/40 bg-accent-soft text-accent"
                    : "border-line bg-white/2 text-muted hover:text-zinc-200",
                )}
              >
                <Hash size={12} />
                {t("variables.typeCounter")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setNewVarType("text");
                  if (newVarValue === "0") setNewVarValue("");
                }}
                className={cn(
                  "flex items-center justify-center gap-1.5 rounded-lg border py-1.5 text-[11px] font-medium transition",
                  newVarType === "text"
                    ? "border-accent/40 bg-accent-soft text-accent"
                    : "border-line bg-white/2 text-muted hover:text-zinc-200",
                )}
              >
                <Type size={12} />
                {t("variables.typeText")}
              </button>
            </div>
            <div className="grid grid-cols-[1fr_1fr] gap-2">
              <input
                className="input text-xs font-mono"
                value={newVarName}
                maxLength={32}
                onChange={(event) => setNewVarName(event.target.value)}
                placeholder={t("variables.customNamePlaceholder")}
              />
              <input
                className="input text-xs"
                value={newVarValue}
                maxLength={200}
                onChange={(event) => setNewVarValue(event.target.value)}
                placeholder={
                  newVarType === "counter"
                    ? "0"
                    : t("variables.customValuePlaceholder")
                }
              />
            </div>
            <Button type="submit" variant="primary" className="w-full justify-center">
              <Plus size={13} />
              {t("variables.addCustom")}
            </Button>
          </form>

          <ScrollFade className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-0.5">
            {customVariables.length === 0 ? (
              <div className="py-8 text-center text-xs text-muted">
                {t("variables.noCustomVariables")}
              </div>
            ) : (
              customVariables.map((item) => {
                const token = `$(${item.name})`;
                return (
                  <div
                    key={item.id}
                    className="rounded-xl border border-line bg-white/2 p-2.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => void copyToken(token)}
                        className="inline-flex items-center gap-1.5 rounded-md border border-accent/25 bg-accent-soft px-2 py-0.5 font-mono text-[11px] font-semibold text-accent hover:border-accent/50"
                      >
                        {token}
                        <Copy size={10} />
                      </button>
                      <div className="flex items-center gap-1">
                        <Badge tone="neutral">
                          {item.type === "counter"
                            ? t("variables.typeCounter")
                            : t("variables.typeText")}
                        </Badge>
                        <button
                          type="button"
                          onClick={() => deleteCustomVariable(item.id)}
                          title={t("commands.delete")}
                          className="grid size-6 place-items-center rounded-md text-zinc-500 hover:bg-red-500/10 hover:text-red-300"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>

                    {item.type === "counter" ? (
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <span className="font-mono text-base font-bold tabular-nums text-zinc-100">
                          {item.value}
                        </span>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => adjustCustomCounter(item.id, -1)}
                            className="grid size-7 place-items-center rounded-lg border border-line bg-black/25 text-zinc-300 hover:border-white/20 hover:text-white"
                          >
                            <Minus size={12} />
                          </button>
                          <button
                            type="button"
                            onClick={() => adjustCustomCounter(item.id, 1)}
                            className="grid size-7 place-items-center rounded-lg border border-accent/35 bg-accent-soft text-accent hover:border-accent"
                          >
                            <Plus size={12} />
                          </button>
                          <button
                            type="button"
                            onClick={() => adjustCustomCounter(item.id, 0, true)}
                            title={t("variables.resetCounter")}
                            className="grid size-7 place-items-center rounded-lg border border-line bg-black/25 text-zinc-400 hover:text-zinc-200"
                          >
                            <RotateCcw size={11} />
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="mt-2">
                        <input
                          className="input h-7 w-full text-xs"
                          value={item.value}
                          onChange={(event) =>
                            upsertCustomVariable({
                              ...item,
                              value: event.target.value,
                            })
                          }
                        />
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </ScrollFade>
        </Card>
      </div>
    </div>
  );
}
