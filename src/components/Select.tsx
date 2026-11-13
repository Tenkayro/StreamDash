import { Children, isValidElement, useId, useLayoutEffect, useRef, useState } from "react";
import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "../lib/utils";

type Option = { value: string; label: ReactNode; disabled?: boolean };
type SelectProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "value" | "onChange" | "children"> & {
  value: string | number;
  children: ReactNode;
  onChange: (event: { target: { value: string } }) => void;
  decoration?: (value: string) => ReactNode;
};

export function Select({ value, children, onChange, decoration, className, disabled, ...props }: SelectProps) {
  const options: Option[] = Children.toArray(children).flatMap((child) => {
    if (!isValidElement<{ value: string | number; children: ReactNode; disabled?: boolean }>(child)) return [];
    return [{ value: String(child.props.value), label: child.props.children, disabled: child.props.disabled }];
  });
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState<CSSProperties>({});
  const [motion, setMotion] = useState("on");
  const search = useRef({ text: "", time: 0 });
  const selectedIndex = options.findIndex((option) => option.value === String(value));
  const selected = options[selectedIndex];
  const show = (last = false) => {
    setActive(selectedIndex >= 0 && !options[selectedIndex].disabled ? selectedIndex : last ? options.findLastIndex((option) => !option.disabled) : options.findIndex((option) => !option.disabled));
    setOpen(true);
  };
  const choose = (index: number) => {
    const option = options[index];
    if (!option || option.disabled) return;
    onChange({ target: { value: option.value } });
    setOpen(false);
    trigger.current?.focus();
  };

  useLayoutEffect(() => {
    if (!open || !trigger.current) return;
    const update = () => {
      const button = trigger.current!;
      const rect = button.getBoundingClientRect();
      const styles = getComputedStyle(button);
      const below = innerHeight - rect.bottom - 12;
      const above = rect.top - 12;
      const up = below < 200 && above > below;
      setMotion(button.closest("[data-animations]")?.getAttribute("data-animations") ?? "on");
      setPosition({
        position: "fixed", width: Math.min(Math.max(rect.width, 160), innerWidth - 16),
        left: Math.max(8, Math.min(rect.left, innerWidth - Math.max(rect.width, 160) - 8)),
        ...(up ? { bottom: innerHeight - rect.top + 6 } : { top: rect.bottom + 6 }),
        maxHeight: Math.max(48, Math.min(300, up ? above : below)),
        "--app-accent": styles.getPropertyValue("--app-accent"),
        "--app-accent-soft": styles.getPropertyValue("--app-accent-soft"),
      } as CSSProperties & { "--app-accent": string; "--app-accent-soft": string });
    };
    update();
    const outside = (event: Event) => {
      if (!trigger.current?.contains(event.target as Node) && !menu.current?.contains(event.target as Node)) setOpen(false);
    };
    const scrolled = (event: Event) => { if (!menu.current?.contains(event.target as Node)) update(); };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", scrolled, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", scrolled, true);
    };
  }, [open]);
  useLayoutEffect(() => {
    if (open) menu.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  return <>
    <button {...props} ref={trigger} type="button" disabled={disabled}
      role="combobox" aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? id : undefined}
      aria-activedescendant={open && active >= 0 ? `${id}-${active}` : undefined}
      className={cn("input glass-select", className)} data-open={open || undefined}
      onClick={() => open ? setOpen(false) : show()}
      onKeyDown={(event) => {
        if (event.key === "Tab") { setOpen(false); return; }
        if (event.key === "Escape") { if (open) { event.preventDefault(); event.stopPropagation(); setOpen(false); } return; }
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          if (!open) { show(event.key === "ArrowUp" || event.key === "End"); return; }
          const enabled = options.map((option, index) => option.disabled ? -1 : index).filter((index) => index >= 0);
          const current = enabled.indexOf(active);
          setActive(event.key === "Home" ? enabled[0] : event.key === "End" ? enabled[enabled.length - 1] : enabled[(current + (event.key === "ArrowDown" ? 1 : -1) + enabled.length) % enabled.length]);
        } else if (event.key === "Enter" || event.key === " ") {
          event.preventDefault(); if (open) choose(active); else show();
        } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
          event.preventDefault();
          const now = event.timeStamp;
          search.current = { text: (now - search.current.time < 650 ? search.current.text : "") + event.key.toLocaleLowerCase(), time: now };
          const match = options.findIndex((option) => !option.disabled && String(option.label).toLocaleLowerCase().startsWith(search.current.text));
          if (match >= 0) { setActive(match); setOpen(true); }
        }
      }}>
      {selected && decoration?.(selected.value)}
      <span className="min-w-0 flex-1 truncate">{selected?.label}</span>
      {!className?.includes("input-trailing-action") && <ChevronDown size={13} className="select-chevron shrink-0 text-muted" aria-hidden="true" />}
    </button>
    {open && createPortal(<div ref={menu} id={id} role="listbox" aria-label={props["aria-label"]} className="glass-select-menu" style={position} data-animations={motion}>
      {options.map((option, index) => <div key={option.value} id={`${id}-${index}`} role="option" aria-selected={option.value === String(value)} aria-disabled={option.disabled || undefined}
        data-index={index} data-active={index === active || undefined} className="glass-select-option"
        onPointerMove={() => !option.disabled && setActive(index)} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(index)}>
        {decoration?.(option.value)}<span className="min-w-0 flex-1 truncate">{option.label}</span>
        {option.value === String(value) && <Check size={13} className="shrink-0 text-accent" aria-hidden="true" />}
      </div>)}
    </div>, document.body)}
  </>;
}
