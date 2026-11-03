import { ArrowUpRight, Search, SearchX, Settings2, MessageSquare, Activity, LayoutGrid, Sparkles, X } from "lucide-react";
import { useDeferredValue, useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { OPEN_COMMAND_PALETTE } from "../lib/navigation";
import { buildSearchIndex } from "../lib/search-index";
import { rankSearch, searchGroups } from "../lib/search";
import type { SearchEntry, SearchGroup } from "../lib/search";
import { openSearchTarget } from "../lib/search-navigation";
import { useAppStore } from "../stores/app-store";

const icons = { pages: LayoutGrid, settings: Settings2, features: Sparkles, activity: Activity, chat: MessageSquare };
const PAGE_SIZE = 12;
function Highlight({ text, query }: { text: string; query: string }) {
  const term = query.trim();
  const index = term ? text.toLocaleLowerCase().indexOf(term.toLocaleLowerCase()) : -1;
  if (index < 0) return <>{text}</>;
  return <>{text.slice(0, index)}<mark className="bg-transparent font-semibold text-accent">{text.slice(index, index + term.length)}</mark>{text.slice(index + term.length)}</>;
}
export function CommandPalette() {
  const { t } = useTranslation();
  const state = useAppStore();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [scope, setScope] = useState<SearchGroup | "all">("all");
  const [activeId, setActiveId] = useState("");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const listId = useId();
  const index = useMemo(() => open ? buildSearchIndex(state, t) : [], [open, state, t]);
  const ranked = useMemo(() => rankSearch(index, deferredQuery, scope), [index, deferredQuery, scope]);
  const groups = useMemo(() => searchGroups.map((group) => ({ group, items: ranked.filter((entry) => entry.group === group) })).filter((group) => group.items.length).sort((a, b) => (b.items[0]?.score ?? 0) - (a.items[0]?.score ?? 0)), [ranked]);
  const visible = groups.flatMap(({ items }) => items.slice(0, limit));
  const active = visible.find((item) => item.id === activeId) ?? visible[0];
  const activeIndex = active ? visible.indexOf(active) : -1;
  const close = (restore = true) => {
    setOpen(false); setQuery(""); setScope("all"); setActiveId(""); setLimit(PAGE_SIZE);
    if (restore) requestAnimationFrame(() => previousFocus.current?.focus({ preventScroll: true }));
  };
  const select = (item: SearchEntry) => { close(false); openSearchTarget(item.target); };
  useEffect(() => {
    const show = () => { previousFocus.current = document.activeElement as HTMLElement; setOpen(true); };
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault(); if (open) close(); else show();
      } else if ((event.ctrlKey || event.metaKey) && event.key === ",") {
        event.preventDefault(); close(false); openSearchTarget({ page: "settings" });
      } else if (open && event.key === "Escape") { event.preventDefault(); close(); }
    };
    window.addEventListener(OPEN_COMMAND_PALETTE, show);
    window.addEventListener("keydown", onKeyDown);
    return () => { window.removeEventListener(OPEN_COMMAND_PALETTE, show); window.removeEventListener("keydown", onKeyDown); };
  });
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    const containFocus = (event: FocusEvent) => { if (!dialogRef.current?.contains(event.target as Node)) inputRef.current?.focus(); };
    document.addEventListener("focusin", containFocus);
    return () => { cancelAnimationFrame(frame); document.removeEventListener("focusin", containFocus); };
  }, [open]);
  useEffect(() => {
    if (open && active) document.getElementById(`${listId}-${active.id}`)?.scrollIntoView({ block: "nearest" });
  }, [open, active, listId]);
  if (!open) return null;
  return <div role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}
    className="fixed inset-0 z-100 flex justify-center overflow-y-auto bg-black/65 px-3 py-[min(10vh,4rem)] backdrop-blur-sm sm:px-4">
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={t("search.title")} className="command-search h-fit max-h-full w-full max-w-2xl overflow-hidden rounded-2xl border border-line shadow-2xl shadow-black/60"
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const elements = dialogRef.current?.querySelectorAll<HTMLElement>("button:not([disabled]), input");
        if (!elements?.length) return;
        const first = elements[0], last = elements[elements.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }}>
      <div className="relative border-b border-line">
        <Search size={18} aria-hidden="true" className="absolute left-4 top-1/2 -translate-y-1/2 text-accent" />
        <input ref={inputRef} value={query} maxLength={200} role="combobox" aria-expanded="true" aria-autocomplete="list" aria-controls={listId} aria-activedescendant={active ? `${listId}-${active.id}` : undefined}
          onChange={(event) => { setQuery(event.target.value); setActiveId(""); setLimit(PAGE_SIZE); }}
          onKeyDown={(event) => {
            if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) && visible.length) {
              if ((event.key === "Home" || event.key === "End") && !event.ctrlKey) return;
              event.preventDefault();
              const next = event.key === "Home" ? 0 : event.key === "End" ? visible.length-1 : (activeIndex + (event.key === "ArrowDown" ? 1 : -1) + visible.length) % visible.length;
              setActiveId(visible[next].id);
            } else if (event.key === "Enter" && active && query === deferredQuery) { event.preventDefault(); select(active); }
          }}
          placeholder={t("search.placeholder")} aria-label={t("search.placeholder")} className="h-14 w-full bg-transparent pl-12 pr-12 text-sm outline-none placeholder:text-muted" />
        <button type="button" onClick={() => close()} title={t("navigation.close")} aria-label={t("navigation.close")} className="absolute right-3 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-lg text-muted hover:bg-white/5"><X size={14} /></button>
      </div>
      <div className="flex gap-1 overflow-x-auto border-b border-line px-3 py-2" role="group" aria-label={t("search.categories")}>
        {(["all", ...searchGroups] as const).map((group) => <button key={group} type="button" aria-pressed={scope === group} onClick={() => { setScope(group); setActiveId(""); setLimit(PAGE_SIZE); inputRef.current?.focus(); }} className={`shrink-0 rounded-lg border px-2.5 py-1.5 text-[11px] transition ${scope === group ? "border-accent/20 bg-accent-soft text-accent" : "border-transparent text-muted hover:bg-white/5"}`}>{t(`search.groups.${group}`)}</button>)}
      </div>
      <div className="flex items-center justify-between gap-2 px-4 py-2 text-[10px] text-muted" role="status" aria-live="polite">
        <span>{deferredQuery.trim() ? t("search.resultCount", { count: ranked.length }) : t("search.startHint")}</span>
        <span className="hidden sm:inline">{t("search.localOnly")}</span>
      </div>
      <div id={listId} role="listbox" aria-label={t("search.results")} aria-busy={query !== deferredQuery} className="max-h-[min(26rem,calc(100dvh-17rem))] min-h-24 overflow-y-auto px-2 pb-2">
        {groups.map(({ group, items }) => {
          const Icon = icons[group];
          return <div key={group} role="group" aria-label={t(`search.groups.${group}`)}>
            <div className="sticky top-0 z-10 flex items-center gap-2 bg-[#2b2c2d]/95 px-2 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted backdrop-blur-md"><Icon size={12} aria-hidden="true" />{t(`search.groups.${group}`)}<span className="ml-auto tabular-nums">{items.length}</span></div>
            {items.slice(0, limit).map((item) => <div id={`${listId}-${item.id}`} key={item.id} role="option" aria-selected={item.id === active?.id}
              onMouseEnter={() => setActiveId(item.id)} onMouseDown={(event) => event.preventDefault()} onClick={() => select(item)}
              className={`command-result flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 ${item.id === active?.id ? "border-accent/15 bg-accent-soft" : "border-transparent hover:bg-white/4"}`}>
              <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-white/5 bg-white/3 text-accent"><Icon size={15} aria-hidden="true" /></span>
              <span className="min-w-0 flex-1"><span className="block truncate text-sm text-zinc-200"><Highlight text={item.title} query={deferredQuery} /></span><span className="mt-0.5 block truncate text-[11px] text-muted"><Highlight text={item.description} query={deferredQuery} /></span></span>
              <ArrowUpRight size={13} aria-hidden="true" className="shrink-0 text-muted" />
            </div>)}
          </div>;
        })}
        {!ranked.length && <div className="flex min-h-36 flex-col items-center justify-center gap-2 px-4 text-center"><SearchX size={24} className="text-muted" aria-hidden="true" /><p className="text-sm">{t("navigation.noResults")}</p><p className="max-w-sm text-xs leading-5 text-muted">{t("search.noResultsHint")}</p></div>}
      </div>
      {groups.some(({ items }) => items.length > limit) && <button type="button" onClick={() => setLimit((value) => value + PAGE_SIZE)} className="w-full border-t border-line py-2 text-xs text-accent hover:bg-white/4">{t("search.showMore")}</button>}
      <div className="flex items-center gap-4 border-t border-line px-4 py-2.5 text-[10px] text-muted"><span>{t("navigation.moveHint")}</span><span>{t("navigation.openHint")}</span><span className="ml-auto">Esc</span></div>
    </div>
  </div>;
}
