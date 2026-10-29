import { useEffect, useRef, useState } from "react";
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import { cn } from "../lib/utils";
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
        variant === "danger" && "text-red-300 hover:border-red-900",
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
      className={cn("toggle-switch relative h-5 w-9 shrink-0 rounded-full", className)}
    >
      <span aria-hidden="true" className="toggle-knob" />
    </button>
  );
}
export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "green" | "amber" | "red" | "purple";
}) {
  const styles = {
    neutral: "bg-white/5 text-muted",
    green: "bg-emerald-400/10 text-emerald-300",
    amber: "bg-amber-400/10 text-amber-300",
    red: "bg-red-400/10 text-red-300",
    purple: "bg-accent-soft text-accent",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-1 text-[11px] font-semibold capitalize",
        styles[tone],
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
    <div className="mb-4 flex flex-wrap items-start gap-3 sm:gap-4">
      <div className="min-w-0 flex-1 basis-64">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {Icon && (
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
              <Icon size={16} aria-hidden="true" />
            </span>
          )}
          <h1 className="min-w-0 text-xl font-semibold tracking-[-.02em]">{title}</h1>
          {titleActions}
        </div>
        {description && (
          <p className="mt-0.5 text-xs text-muted">{description}</p>
        )}
      </div>
      {actions && <div className="ml-auto flex max-w-full flex-wrap items-center gap-2">{actions}</div>}
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
    <div className="flex min-h-52 flex-col items-center justify-center px-8 text-center">
      <div className="mb-3 text-muted">{icon}</div>
      <div className="font-medium">{title}</div>
      {body && (
        <p className="mt-1 max-w-sm text-sm leading-6 text-muted">{body}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
