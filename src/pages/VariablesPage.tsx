import {
  Braces,
  Check,
  Copy,
  Hash,
  Minus,
  Plus,
  RotateCcw,
  Search,
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

type PageTab = "catalog" | "custom" | "test";

const CATEGORY_ORDER: VariableCategory[] = [
  "stream",
  "stats",
  "user",
  "events",
  "tools",
  "utility",
];

function cleanVariableName(value: string) {
  return value
    .trim()
    .replace(/^\$\(|\)$|^\{|\}$/g, "")
    .replace(/^custom\./i, "")
    .replace(/[^a-zA-Z0-9_.-]/g, "")
    .toLowerCase();
}

export function VariablesPage() {
  const { t } = useTranslation();
  const state = useAppStore();
  const {
    customVariables,
    upsertCustomVariable,
    deleteCustomVariable,
    adjustCustomCounter,
  } = state;

  const [tab, setTab] = useState<PageTab>("catalog");
  const [category, setCategory] = useState<VariableCategory | "all">("all");
  const [search, setSearch] = useState("");
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [testTemplate, setTestTemplate] = useState(
    "Hey $(user)! $(channel) — $(game) ($(status), $(uptime))",
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

  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matches = VARIABLE_DEFINITIONS.filter((item) => {
      if (category !== "all" && item.category !== category) return false;
      if (!q) return true;
      return (
        item.token.toLowerCase().includes(q) ||
        t(item.descriptionKey).toLowerCase().includes(q)
      );
    });
    return CATEGORY_ORDER.map((cat) => ({
      cat,
      items: matches.filter((item) => item.category === cat),
    })).filter((group) => group.items.length > 0);
  }, [category, search, t]);

  const copyToken = async (token: string) => {
    try {
      await navigator.clipboard.writeText(token);
      setCopiedToken(token);
      toast.success(t("variables.copied", { token }));
      window.setTimeout(
        () => setCopiedToken((prev) => (prev === token ? null : prev)),
        1500,
      );
    } catch {
      toast.error(t("donations.copyFailed"));
    }
  };

  const handleCreateCustom = (event: FormEvent) => {
    event.preventDefault();
    const name = cleanVariableName(newVarName);
    if (!name) {
      toast.error(t("variables.customNameRequired"));
      return;
    }
    upsertCustomVariable({
      id: `var-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name,
      type: newVarType,
      value:
        newVarType === "counter"
          ? String(Number.parseInt(newVarValue, 10) || 0)
          : newVarValue.trim(),
      updatedAt: Date.now(),
    });
    setNewVarName("");
    setNewVarValue(newVarType === "counter" ? "0" : "");
    toast.success(t("variables.customSaved", { token: `$(${name})` }));
  };

  const tabs: Array<{ id: PageTab; label: string; count?: number }> = [
    {
      id: "catalog",
      label: t("variables.tabs.catalog"),
      count: VARIABLE_DEFINITIONS.length,
    },
    {
      id: "custom",
      label: t("variables.tabs.custom"),
      count: customVariables.length,
    },
    { id: "test", label: t("variables.tabs.test") },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        icon={Braces}
        title={t("nav.variables")}
        description={t("pageDescriptions.variables")}
      />

      <div className="mb-2.5 flex shrink-0 flex-wrap items-center justify-between gap-2">
        <div
          role="tablist"
          aria-label={t("nav.variables")}
          className="inline-flex rounded-[10px] border border-rule bg-well p-1"
        >
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              onClick={() => setTab(item.id)}
              className={cn(
                "flex items-center gap-1.5 rounded-[7px] px-3 py-1.5 text-xs font-medium transition",
                tab === item.id
                  ? "border border-accent-border bg-accent-soft text-accent"
                  : "border border-transparent text-muted hover:text-ink",
              )}
            >
              {item.label}
              {item.count !== undefined && (
                <span className="studio-mono text-[10px] text-subtle">
                  {item.count}
                </span>
              )}
            </button>
          ))}
        </div>
        <span className="studio-mono text-[11px] text-subtle">
          {t("variables.syntaxHint")}
        </span>
      </div>

      {tab === "catalog" && (
        <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-rule bg-shell/70 p-3">
            <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
              <Search
                size={13}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-subtle"
              />
              <input
                className="input input-leading-icon w-full text-xs"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t("variables.searchPlaceholder")}
              />
            </div>
            <div className="flex flex-wrap gap-1">
              {(["all", ...CATEGORY_ORDER] as const).map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setCategory(cat)}
                  className={cn(
                    "rounded-md border px-2 py-1 text-[11px] font-medium transition",
                    category === cat
                      ? "border-accent-border bg-accent-soft text-accent"
                      : "border-transparent text-muted hover:border-rule hover:bg-well hover:text-ink",
                  )}
                >
                  {t(`variables.categories.${cat}`)}
                </button>
              ))}
            </div>
          </div>

          <ScrollFade className="min-h-0 flex-1 overflow-y-auto px-3 pb-3" color="var(--color-panel)">
            {groups.length === 0 ? (
              <EmptyState
                icon={<Braces size={22} />}
                title={t("variables.emptyTitle")}
                body={t("variables.emptyDescription")}
              />
            ) : (
              groups.map((group) => (
                <section key={group.cat} className="pt-3.5">
                  <h2 className="studio-label mb-1.5 px-1">
                    {t(`variables.categories.${group.cat}`)}
                  </h2>
                  <div className="grid gap-1 lg:grid-cols-2">
                    {group.items.map((item) => {
                      const copied = copiedToken === item.token;
                      return (
                        <button
                          key={item.key}
                          type="button"
                          onClick={() => void copyToken(item.token)}
                          title={t("variables.clickToCopy")}
                          className="group flex min-w-0 items-center gap-3 rounded-lg border border-transparent px-2.5 py-2 text-left transition hover:border-rule hover:bg-well/75"
                        >
                          <span className="studio-mono w-36 shrink-0 truncate text-[11.5px] font-semibold text-accent">
                            {item.token}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-xs text-ink">
                              {t(item.descriptionKey)}
                            </span>
                            <span className="studio-mono block truncate text-[10.5px] text-subtle">
                              {liveMap[item.key] ?? "—"}
                            </span>
                          </span>
                          <span className="shrink-0 text-subtle opacity-0 transition group-hover:opacity-100">
                            {copied ? (
                              <Check size={13} className="text-accent" />
                            ) : (
                              <Copy size={13} />
                            )}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))
            )}
          </ScrollFade>
        </Card>
      )}

      {tab === "custom" && (
        <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <form
            onSubmit={handleCreateCustom}
            className="flex shrink-0 flex-wrap items-center gap-2 border-b border-rule bg-shell/70 p-3"
          >
            <div className="inline-flex rounded-[9px] border border-rule bg-well p-0.5">
              {(
                [
                  ["counter", Hash, t("variables.typeCounter")],
                  ["text", Type, t("variables.typeText")],
                ] as const
              ).map(([type, Icon, label]) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => {
                    setNewVarType(type);
                    setNewVarValue(type === "counter" ? "0" : "");
                  }}
                  className={cn(
                    "flex items-center gap-1.5 rounded-[6px] px-2.5 py-1 text-[11px] font-medium transition",
                    newVarType === type
                      ? "bg-raised text-ink-strong shadow-xs"
                      : "text-muted hover:text-ink",
                  )}
                >
                  <Icon size={12} />
                  {label}
                </button>
              ))}
            </div>
            <input
              className="input studio-mono w-40 text-xs"
              value={newVarName}
              maxLength={32}
              onChange={(event) => setNewVarName(event.target.value)}
              placeholder={t("variables.customNamePlaceholder")}
              aria-label={t("variables.customNamePlaceholder")}
            />
            <input
              className="input min-w-[120px] flex-1 text-xs sm:max-w-xs"
              value={newVarValue}
              maxLength={200}
              onChange={(event) => setNewVarValue(event.target.value)}
              placeholder={
                newVarType === "counter"
                  ? "0"
                  : t("variables.customValuePlaceholder")
              }
              aria-label={t("variables.customValuePlaceholder")}
            />
            <Button type="submit" variant="primary">
              <Plus size={13} />
              {t("variables.addCustom")}
            </Button>
          </form>

          <ScrollFade className="min-h-0 flex-1 overflow-y-auto p-3" color="var(--color-panel)">
            <p className="mb-3 text-[11px] text-muted">
              {t("variables.customSubtitle")}
            </p>
            {customVariables.length === 0 ? (
              <EmptyState
                icon={<Hash size={22} />}
                title={t("variables.noCustomVariables")}
              />
            ) : (
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {customVariables.map((item) => {
                  const token = `$(${item.name})`;
                  return (
                    <div
                      key={item.id}
                      className="flex flex-col gap-2 rounded-[10px] border border-rule bg-well/80 p-3"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => void copyToken(token)}
                          title={t("variables.clickToCopy")}
                          className="studio-mono truncate text-xs font-semibold text-accent hover:brightness-125"
                        >
                          {token}
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
                            aria-label={t("commands.delete")}
                            className="grid size-6 place-items-center rounded-md text-subtle hover:bg-red-500/12 hover:text-red-300"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>
                      {item.type === "counter" ? (
                        <div className="flex items-center justify-between">
                          <span className="studio-mono text-lg font-bold text-ink-strong">
                            {item.value}
                          </span>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => adjustCustomCounter(item.id, -1)}
                              aria-label="-1"
                              className="grid size-7 place-items-center rounded-md border border-rule bg-panel text-ink transition hover:border-rule-strong hover:text-ink-strong"
                            >
                              <Minus size={12} />
                            </button>
                            <button
                              type="button"
                              onClick={() => adjustCustomCounter(item.id, 1)}
                              aria-label="+1"
                              className="grid size-7 place-items-center rounded-md border border-accent-border bg-accent-soft text-accent transition hover:border-accent"
                            >
                              <Plus size={12} />
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                adjustCustomCounter(item.id, 0, true)
                              }
                              title={t("variables.resetCounter")}
                              aria-label={t("variables.resetCounter")}
                              className="grid size-7 place-items-center rounded-md border border-rule bg-panel text-muted transition hover:border-rule-strong hover:text-ink"
                            >
                              <RotateCcw size={11} />
                            </button>
                          </div>
                        </div>
                      ) : (
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
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </ScrollFade>
        </Card>
      )}

      {tab === "test" && (
        <Card className="shrink-0 space-y-3 p-4">
          <p className="text-[11px] text-muted">{t("variables.testHint")}</p>
          <div>
            <div className="studio-label mb-1.5">
              {t("variables.playgroundTitle")}
            </div>
            <textarea
              className="input studio-mono min-h-20 w-full resize-y py-2 text-xs"
              value={testTemplate}
              onChange={(event) => setTestTemplate(event.target.value)}
              placeholder={t("variables.playgroundPlaceholder")}
            />
          </div>
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="studio-label">
                {t("variables.liveOutput")}
              </span>
              <button
                type="button"
                onClick={() => void copyToken(testTemplate)}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-accent hover:brightness-125"
              >
                <Copy size={11} />
                {t("variables.copyTemplate")}
              </button>
            </div>
            <div className="studio-mono min-h-10 rounded-lg border border-rule bg-well px-3 py-2 text-xs leading-relaxed text-ink-strong wrap-break-word">
              {resolvedPreview || "—"}
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
