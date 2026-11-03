import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { createPortal } from "react-dom";

type Tip = { anchor: HTMLElement; text: string };
const selector = "[data-tooltip], [data-app-tooltip]";
function tooltipTarget(target: EventTarget | null) {
  return target instanceof Element ? target.closest<HTMLElement>(selector) : null;
}
function tooltipText(element: HTMLElement) {
  return (element.getAttribute("data-tooltip") ?? element.getAttribute("data-app-tooltip") ?? "").trim();
}

/** One delegated tooltip layer for both the main window and the tray.
 * Keep title="" on managed elements so React can still remove/update its prop.
 * iframe titles remain intact: they name embedded content for assistive tools.
 */
export function Tooltips() {
  const id = useId();
  const [tip, setTip] = useState<Tip>();
  const [layout, setLayout] = useState<CSSProperties>();
  const [animations, setAnimations] = useState("on");
  const tipRef = useRef<HTMLDivElement>(null);
  const current = useRef<Tip | undefined>(undefined);
  const dismissRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    let showTimer: number | undefined;
    let hideTimer: number | undefined;
    let pending: HTMLElement | null = null;
    let hovered: HTMLElement | null = null;
    let focused: HTMLElement | null = null;
    let observing = false;
    const ownWrites = new WeakMap<Element, number>();
    const hide = () => {
      clearTimeout(showTimer); clearTimeout(hideTimer);
      pending = null; current.current = undefined; setTip(undefined);
    };
    dismissRef.current = hide;
    const refresh = (element: HTMLElement) => {
      if (current.current?.anchor !== element) return;
      const text = tooltipText(element);
      if (!text) hide();
      else if (text !== current.current.text) { current.current = { anchor: element, text }; setTip(current.current); }
    };
    const manage = (element: Element) => {
      if (!(element instanceof HTMLElement) || element.tagName === "IFRAME") return;
      const title = element.getAttribute("title");
      const managedLabel = element.getAttribute("data-app-tooltip-label");
      if (managedLabel !== null && element.getAttribute("aria-label") !== managedLabel) element.removeAttribute("data-app-tooltip-label");
      if (title?.trim()) {
        if (element.hasAttribute("data-app-tooltip-label") || (!element.hasAttribute("aria-label") && !element.hasAttribute("aria-labelledby") && !element.textContent?.trim() && element.matches('button, a, input, select, textarea, [role="button"]'))) {
          element.setAttribute("aria-label", title);
          element.setAttribute("data-app-tooltip-label", title);
        }
        element.setAttribute("data-app-tooltip", title);
        if (observing) ownWrites.set(element, (ownWrites.get(element) ?? 0) + 1);
        element.setAttribute("title", "");
      } else {
        element.removeAttribute("data-app-tooltip");
        const label = element.getAttribute("data-app-tooltip-label");
        if (label !== null) {
          if (element.getAttribute("aria-label") === label) element.removeAttribute("aria-label");
          element.removeAttribute("data-app-tooltip-label");
        }
      }
      refresh(element);
    };
    const scan = (root: Element) => {
      if (root.hasAttribute("title") && root.getAttribute("title")) manage(root);
      root.querySelectorAll("[title]:not(iframe)").forEach((element) => { if (element.getAttribute("title")) manage(element); });
    };
    scan(document.body);
    const observer = new MutationObserver((records) => {
      const titles = new Map<Element, number>();
      const added: Element[] = [];
      for (const record of records) {
        if (record.type === "attributes" && record.target instanceof Element) {
          if (record.attributeName === "title") titles.set(record.target, (titles.get(record.target) ?? 0) + 1);
          else if (record.target instanceof HTMLElement) refresh(record.target);
        } else for (const node of record.addedNodes) if (node instanceof Element) added.push(node);
      }
      // Coalesce updates before reading the final title, including React batches.
      for (const [element, count] of titles) {
        const own = ownWrites.get(element) ?? 0;
        ownWrites.delete(element);
        if (count > own) manage(element);
      }
      added.forEach(scan);
      if (current.current && !current.current.anchor.isConnected) hide();
      if (pending && !pending.isConnected) hide();
    });
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["title", "data-tooltip"] });
    observing = true;
    const show = (element: HTMLElement | null, keyboard = false) => {
      clearTimeout(hideTimer);
      if (element === current.current?.anchor || element === pending) return;
      hide();
      if (!element || !tooltipText(element)) return;
      pending = element;
      showTimer = window.setTimeout(() => {
        pending = null;
        if (!element.isConnected || !tooltipText(element)) return;
        const rect = element.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        current.current = { anchor: element, text: tooltipText(element) };
        setLayout(undefined); setTip(current.current);
      }, keyboard ? 120 : 450);
    };
    const leave = () => {
      clearTimeout(showTimer); pending = null;
      clearTimeout(hideTimer);
      hideTimer = window.setTimeout(hide, 120);
    };
    const over = (event: PointerEvent) => {
      if (event.pointerType === "touch" || event.buttons) return;
      if (tipRef.current?.contains(event.target as Node)) { clearTimeout(hideTimer); return; }
      hovered = tooltipTarget(event.target);
      show(hovered);
    };
    const out = (event: PointerEvent) => {
      const next = event.relatedTarget;
      if (next instanceof Node && (tipRef.current?.contains(next) || current.current?.anchor.contains(next) || pending?.contains(next))) return;
      hovered = null;
      if (!focused || focused !== current.current?.anchor) leave();
    };
    const focus = (event: FocusEvent) => {
      focused = tooltipTarget(event.target);
      if (focused?.matches(":focus-visible")) show(focused, true);
    };
    const blur = () => { focused = null; if (hovered !== current.current?.anchor) leave(); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") hide(); };
    const scroll = (event: Event) => { if (!tipRef.current?.contains(event.target as Node)) hide(); };
    document.addEventListener("pointerover", over, true);
    document.addEventListener("pointerout", out, true);
    document.addEventListener("focusin", focus, true);
    document.addEventListener("focusout", blur, true);
    document.addEventListener("pointerdown", hide, true);
    document.addEventListener("keydown", escape, true);
    document.addEventListener("scroll", scroll, true);
    window.addEventListener("blur", hide);
    window.addEventListener("resize", hide);
    return () => {
      clearTimeout(showTimer); clearTimeout(hideTimer); observer.disconnect();
      document.removeEventListener("pointerover", over, true);
      document.removeEventListener("pointerout", out, true);
      document.removeEventListener("focusin", focus, true);
      document.removeEventListener("focusout", blur, true);
      document.removeEventListener("pointerdown", hide, true);
      document.removeEventListener("keydown", escape, true);
      document.removeEventListener("scroll", scroll, true);
      window.removeEventListener("blur", hide);
      window.removeEventListener("resize", hide);
      document.querySelectorAll<HTMLElement>("[data-app-tooltip]").forEach((element) => {
        if (element.getAttribute("title") === "") element.setAttribute("title", element.getAttribute("data-app-tooltip") ?? "");
        element.removeAttribute("data-app-tooltip");
        const label = element.getAttribute("data-app-tooltip-label");
        if (label !== null && element.getAttribute("aria-label") === label) element.removeAttribute("aria-label");
        element.removeAttribute("data-app-tooltip-label");
      });
      current.current = undefined;
    };
  }, []);

  useLayoutEffect(() => {
    if (!tip || !tipRef.current) return;
    const { anchor } = tip;
    const rect = anchor.getBoundingClientRect();
    const bubble = tipRef.current.getBoundingClientRect();
    const below = innerHeight - rect.bottom - 9;
    const above = rect.top - 9;
    const up = below < bubble.height + 8 && above > below;
    const top = up ? rect.top - bubble.height - 9 : rect.bottom + 9;
    const styles = getComputedStyle(anchor);
    setAnimations(anchor.closest("[data-animations]")?.getAttribute("data-animations") ?? "on");
    setLayout({
      left: Math.max(8, Math.min(rect.left + (rect.width - bubble.width) / 2, innerWidth - bubble.width - 8)),
      top: Math.max(8, Math.min(top, innerHeight - bubble.height - 8)),
      "--app-accent": styles.getPropertyValue("--app-accent"),
    } as CSSProperties & { "--app-accent": string });
    const describedBy = anchor.getAttribute("aria-describedby")?.split(/\s+/).filter(Boolean) ?? [];
    if (!describedBy.includes(id)) anchor.setAttribute("aria-describedby", [...describedBy, id].join(" "));
    return () => {
      const remaining = (anchor.getAttribute("aria-describedby") ?? "").split(/\s+/).filter((value) => value && value !== id);
      if (remaining.length) anchor.setAttribute("aria-describedby", remaining.join(" "));
      else anchor.removeAttribute("aria-describedby");
    };
  }, [tip, id]);

  if (!tip) return null;
  return createPortal(<div ref={tipRef} id={id} role="tooltip" data-animations={animations}
    className="glass-tooltip" style={{ ...layout, visibility: layout ? "visible" : "hidden" }}
    onPointerLeave={(event) => { if (!(event.relatedTarget instanceof Node) || !tip.anchor.contains(event.relatedTarget)) dismissRef.current(); }}>{tip.text}</div>, document.body);
}
