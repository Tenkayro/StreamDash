import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import { cn } from "../lib/utils";
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("card", className)} {...props} />;
}
export function Skeleton({
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      aria-hidden="true"
      className={cn("skeleton inline-block rounded", className)}
      {...props}
    />
  );
}
export function Button({
  className,
  variant = "default",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "primary" | "danger" | "ghost";
}) {
  return (
    <button
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
  title,
  description,
  titleActions,
  actions,
}: {
  title: string;
  description?: string;
  titleActions?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-4">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold tracking-[-.02em]">{title}</h1>
          {titleActions}
        </div>
        {description && (
          <p className="mt-0.5 text-xs text-muted">{description}</p>
        )}
      </div>
      {actions && <div className="ml-auto">{actions}</div>}
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
