export { Select } from "./Select";
import { useEffect, useRef, useState } from "react";
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import { cn } from "../lib/utils";
import { CurvedScrollbar } from "./CurvedScrollbar";
import type { LucideIcon } from "lucide-react";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("card", className)} {...props} />;
}

export function LoadingIndicator({
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      aria-hidden="true"
      className={cn("loading-indicator inline-flex items-center justify-center", className)}
      {...props}
    >
      <span />
      <span />
      <span />
    </span>
  );
}

export function Button({
  className,
  variant = "default",
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "primary" | "danger" | "ghost";
}) {
  return (
    <button
      type={type}
      className={cn(
        "button",
        variant === "primary" && "button-primary",
        variant === "danger" &&
          "border-red-400/25 bg-red-500/10 text-red-200 hover:border-red-400/45 hover:bg-red-500/18 hover:text-red-100",
        variant === "ghost" && "border-transparent bg-transparent",
        className,
      )}
      {...props}
    />
  );
}

export function Toggle({
  value,
  onChange,
  label,
  className,
}: {
  value: boolean;
  onChange: (value: boolean) => void;
  label?: string;
  className?: string;
}) {
  const [squishing, setSquishing] = useState(false);
  const timeout = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timeout.current !== null) window.clearTimeout(timeout.current);
    },
    [],
  );

  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      aria-label={label}
      data-state={value ? "on" : "off"}
      data-squish={squishing ? "" : undefined}
      onClick={() => {
        onChange(!value);
        setSquishing(true);
        if (timeout.current !== null) window.clearTimeout(timeout.current);
        timeout.current = window.setTimeout(() => {
          setSquishing(false);
          timeout.current = null;
        }, 190);
      }}
      className={cn("toggle-switch relative shrink-0 rounded-full", className)}
    >
      <span aria-hidden="true" className="toggle-knob" />
    </button>
  );
}

/**
 * Wraps a scroll container and fades its content out at the bottom edge while
 * there is still something to scroll to. The scroll container must be the first
 * child element and has to be the element with the `overflow-y` style.
 */
export function ScrollFade({
  children,
  className,
  color = "var(--color-panel)",
  size = 36,
  scrollbar = true,
}: {
  children: ReactNode;
  className?: string;
  color?: string;
  size?: number;
  scrollbar?: boolean;
}) {
  const wrapper = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLElement | null>(null);
  const [more, setMore] = useState(false);

  useEffect(() => {
    const scroller = wrapper.current?.firstElementChild as HTMLElement | null;
    scrollerRef.current = scroller;
    if (!scroller) return;
    const update = () => {
      const remaining =
        scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop;
      const next = remaining > 2;
      setMore((previous) => (previous === next ? previous : next));
    };
    update();
    scroller.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(scroller);
    const mutations = new MutationObserver(update);
    mutations.observe(scroller, { childList: true });
    return () => {
      scroller.removeEventListener("scroll", update);
      observer.disconnect();
      mutations.disconnect();
    };
  }, []);

  return (
    <div ref={wrapper} className={cn("relative", className)}>
      {children}
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute bottom-0 left-0 right-0 transition-opacity duration-200",
          more ? "opacity-100" : "opacity-0",
        )}
        style={{ height: size, backgroundImage: `linear-gradient(to top, ${color}, transparent)` }}
      />
      {scrollbar && <CurvedScrollbar scrollerRef={scrollerRef} />}
    </div>
  );
}

export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: "neutral" | "green" | "amber" | "red" | "purple";
  className?: string;
}) {
  const styles = {
    neutral: "border-rule bg-well text-muted",
    green: "border-emerald-400/28 bg-emerald-400/12 text-emerald-300",
    amber: "border-amber-400/28 bg-amber-400/12 text-amber-300",
    red: "border-red-400/28 bg-red-400/12 text-red-300",
    purple: "border-accent-border bg-accent-soft text-accent",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-[5px] border px-1.5 py-0.5 text-[10.5px] font-medium leading-none tracking-[0.01em]",
        styles[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function PageHeader({
  icon: Icon,
  title,
  description,
  titleActions,
  actions,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  titleActions?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="page-header flex flex-wrap items-center gap-3 sm:gap-4">
      <div className="min-w-0 flex-1 basis-64">
        <div className="flex min-w-0 items-center gap-3">
          {Icon && (
            <span className="page-header-icon grid shrink-0 place-items-center text-accent">
              <Icon size={16} aria-hidden="true" />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h1 className="min-w-0 truncate font-semibold tracking-[-.025em]">{title}</h1>
              {titleActions}
            </div>
            {description && (
              <p className="truncate text-[11.5px] text-muted">{description}</p>
            )}
          </div>
        </div>
      </div>
      {actions && (
        <div className="ml-auto flex max-w-full flex-wrap items-center gap-1.5">
          {actions}
        </div>
      )}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: ReactNode;
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-h-52 flex-col items-center justify-center px-8 py-10 text-center">
      <div className="mb-3 grid size-11 place-items-center rounded-xl border border-rule bg-well text-muted shadow-inner">
        {icon}
      </div>
      <div className="text-sm font-semibold text-ink-strong">{title}</div>
      {body && (
        <p className="mt-1.5 max-w-sm text-xs leading-5 text-muted">{body}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
