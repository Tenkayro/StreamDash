import { Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { navigationItems, OPEN_COMMAND_PALETTE } from "../lib/navigation";
import { useAppStore } from "../stores/app-store";

export function CommandPalette() {
  const { t } = useTranslation();
  const setPage = useAppStore((state) => state.setPage);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const results = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    return navigationItems.filter((item) =>
      t(`nav.${item.label}`).toLocaleLowerCase().includes(search),
    );
  }, [query, t]);

  const close = () => {
    setOpen(false);
    setQuery("");
    setActive(0);
  };
  const navigate = (page: string) => {
    setPage(page);
    close();
  };

  useEffect(() => {
    const show = () => setOpen(true);
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
      } else if ((event.ctrlKey || event.metaKey) && event.key === ",") {
        event.preventDefault();
        navigate("settings");
      } else if (event.key === "Escape") {
        close();
      }
    };
    window.addEventListener(OPEN_COMMAND_PALETTE, show);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener(OPEN_COMMAND_PALETTE, show);
      window.removeEventListener("keydown", onKeyDown);
    };
  });

  useEffect(() => {
    if (open) requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  if (!open) return null;

  return (
    <div
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
      className="fixed inset-0 z-100 flex justify-center overflow-y-auto bg-black/65 px-3 py-[min(12vh,4rem)] backdrop-blur-sm sm:px-4"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("navigation.quickSwitch")}
        className="h-fit max-h-full w-full max-w-lg overflow-hidden rounded-xl border border-line bg-raised shadow-2xl shadow-black/70"
      >
        <div className="relative border-b border-line">
          <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActive((value) => Math.min(value + 1, results.length - 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setActive((value) => Math.max(value - 1, 0));
              } else if (event.key === "Enter" && results[active]) {
                navigate(results[active].id);
              }
            }}
            placeholder={t("navigation.searchPlaceholder")}
            aria-label={t("navigation.searchPlaceholder")}
            className="h-12 w-full bg-transparent pl-11 pr-12 text-sm outline-none placeholder:text-zinc-600"
          />
          <button
            type="button"
            onClick={close}
            title={t("navigation.close")}
            aria-label={t("navigation.close")}
            className="absolute right-3 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-md text-zinc-600 hover:bg-white/5 hover:text-zinc-300"
          >
            <X size={14} />
          </button>
        </div>
        <div className="max-h-[min(20rem,calc(100vh-9rem))] overflow-y-auto p-1.5">
          {results.length ? (
            results.map((item, index) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  onMouseEnter={() => setActive(index)}
                  onClick={() => navigate(item.id)}
                  className={`flex h-10 w-full items-center gap-3 rounded-lg px-3 text-sm transition ${index === active ? "bg-accent-soft text-accent" : "text-zinc-400 hover:bg-white/4 hover:text-zinc-200"}`}
                >
                  <Icon size={16} />
                  <span>{t(`nav.${item.label}`)}</span>
                  <span className="ml-auto text-[10px] uppercase tracking-wider text-zinc-600">
                    {t(`navigation.${item.group}`)}
                  </span>
                </button>
              );
            })
          ) : (
            <div className="grid h-24 place-items-center text-sm text-muted">
              {t("navigation.noResults")}
            </div>
          )}
        </div>
        <div className="flex items-center gap-4 border-t border-line px-4 py-2 text-[10px] text-zinc-600">
          <span>{t("navigation.moveHint")}</span>
          <span>{t("navigation.openHint")}</span>
          <span className="ml-auto">Esc</span>
        </div>
      </div>
    </div>
  );
}
