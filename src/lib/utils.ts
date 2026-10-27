import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
export const isTauri = () => "__TAURI_INTERNALS__" in window;
export function money(value: number, currency?: string) {
  const locale = document.documentElement.lang || navigator.language;
  try {
    return new Intl.NumberFormat(
      locale,
      currency
        ? { style: "currency", currency }
        : { minimumFractionDigits: 2, maximumFractionDigits: 2 },
    ).format(value);
  } catch {
    return currency ? `${value.toFixed(2)} ${currency}` : value.toFixed(2);
  }
}
