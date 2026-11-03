import { useEffect } from "react";
import { useAppStore } from "../stores/app-store";
import type { SearchTarget } from "./search";

export function useSearchFilter(page: string, apply: (filter: string, itemId?: string) => void) {
  const target = useAppStore((state) => state.searchTarget);
  useEffect(() => {
    if (target?.page !== page || target.filter === undefined) return;
    apply(target.filter, target.itemId);
    useAppStore.getState().setSearchTarget(undefined);
  }, [target, page, apply]);
}

export function useSearchLanding() {
  const target = useAppStore((state) => state.searchTarget);
  const page = useAppStore((state) => state.page);
  useEffect(() => {
    if (!target?.label || target.page !== page) return;
    let timer: number | undefined;
    let highlight: HTMLElement | undefined;
    const locate = () => {
      const row = [...document.querySelectorAll<HTMLElement>("main [data-search-label]")].find((element) => element.dataset.searchLabel === target.label);
      const fallback = [...document.querySelectorAll<HTMLElement>("main label, main h2, main h3, main button, main [aria-label]")].find((element) => element.getAttribute("aria-label") === target.label || element.textContent?.trim() === target.label);
      const element = row ?? fallback;
      if (!element) return;
      observer.disconnect();
      const animated = useAppStore.getState().settings.animations && !matchMedia("(prefers-reduced-motion: reduce)").matches;
      element.scrollIntoView({ block: "center", behavior: animated ? "smooth" : "instant" });
      element.classList.add("search-destination");
      highlight = element;
      const control = element.matches("button, input, [tabindex]") ? element : element.querySelector<HTMLElement>("button, input, [tabindex]");
      control?.focus({ preventScroll: true });
      timer = window.setTimeout(() => {
        element.classList.remove("search-destination");
        if (useAppStore.getState().searchTarget === target) useAppStore.getState().setSearchTarget(undefined);
      }, 2400);
    };
    const observer = new MutationObserver(locate);
    const root = document.querySelector(".app-main");
    if (root) observer.observe(root, { childList: true, subtree: true });
    const frame = requestAnimationFrame(locate);
    const expiry = window.setTimeout(() => { observer.disconnect(); if (useAppStore.getState().searchTarget === target) useAppStore.getState().setSearchTarget(undefined); }, 6000);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); clearTimeout(expiry); clearTimeout(timer); highlight?.classList.remove("search-destination"); };
  }, [target, page]);
}

export function openSearchTarget(target: SearchTarget) {
  const store = useAppStore.getState();
  store.setSearchTarget(target);
  store.setPage(target.page);
}
