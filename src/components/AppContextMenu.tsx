import { ArrowLeft, ArrowRight, RotateCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../stores/app-store";

type MenuPosition = { x: number; y: number };

export function AppContextMenu() {
  const { t } = useTranslation();
  const { pageHistory, pageHistoryIndex, goBack, goForward } = useAppStore();
  const [position, setPosition] = useState<MenuPosition>();
  const menuRef = useRef<HTMLDivElement>(null);
  const canGoBack = pageHistoryIndex > 0;
  const canGoForward = pageHistoryIndex < pageHistory.length - 1;

  useEffect(() => {
    const openMenu = (event: MouseEvent) => {
      if (event.defaultPrevented) return;
      event.preventDefault();
      const width = 168;
      const height = 112;
      setPosition({
        x: Math.max(6, Math.min(event.clientX, window.innerWidth - width - 6)),
        y: Math.max(6, Math.min(event.clientY, window.innerHeight - height - 6)),
      });
    };
    const closeMenu = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setPosition(undefined);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPosition(undefined);
    };
    const close = () => setPosition(undefined);
    document.addEventListener("contextmenu", openMenu);
    document.addEventListener("pointerdown", closeMenu);
    document.addEventListener("keydown", closeOnEscape);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    document.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("contextmenu", openMenu);
      document.removeEventListener("pointerdown", closeMenu);
      document.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
      document.removeEventListener("scroll", close, true);
    };
  }, []);

  if (!position) return null;
  const actionClass =
    "flex w-full items-center gap-2.5 rounded-[6px] px-2.5 py-1.5 text-left text-xs text-ink transition hover:bg-hover hover:text-ink-strong disabled:pointer-events-none disabled:opacity-35";
  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label={t("contextMenu.label")}
      className="no-drag fixed z-100 w-44 rounded-[10px] border border-rule-strong bg-raised/96 p-1 shadow-2xl backdrop-blur-xl"
      style={{ left: position.x, top: position.y }}
    >
      <button
        type="button"
        role="menuitem"
        disabled={!canGoBack}
        className={actionClass}
        onClick={() => {
          goBack();
          setPosition(undefined);
        }}
      >
        <ArrowLeft size={13} />
        {t("contextMenu.back")}
      </button>
      <button
        type="button"
        role="menuitem"
        disabled={!canGoForward}
        className={actionClass}
        onClick={() => {
          goForward();
          setPosition(undefined);
        }}
      >
        <ArrowRight size={13} />
        {t("contextMenu.forward")}
      </button>
      <button
        type="button"
        role="menuitem"
        className={actionClass}
        onClick={() => window.location.reload()}
      >
        <RotateCw size={13} />
        {t("contextMenu.refresh")}
      </button>
    </div>
  );
}
