import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)) }
export function errorMessage(error: unknown) { return error instanceof Error ? error.message : String(error) }
export const isTauri = () => '__TAURI_INTERNALS__' in window
export function money(value: number, currency = 'USD') {
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(value) }
  catch { return `${value.toFixed(2)} ${currency}` }
}
