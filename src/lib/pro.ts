import { openUrl } from "@tauri-apps/plugin-opener";

export const PRO_PURCHASE_URLS = [
  "https://tenkayro.de/app/streamdash/pro/",
  "https://tenkayro.de/streamdash/pro/",
  "https://store.tenkayro.de/b/siOJA",
] as const;

export const PAYHIP_PRO_URL = PRO_PURCHASE_URLS[0];

/**
 * Opens the StreamDash Pro purchase page with automatic fallbacks if opening a URL fails.
 */
export async function openProPurchasePage(): Promise<void> {
  for (const url of PRO_PURCHASE_URLS) {
    try {
      await openUrl(url);
      return;
    } catch {
      // Try next fallback URL.
    }
  }
}

export function isCloudServerUnavailableError(rawError?: string): boolean {
  if (!rawError) return false;
  const code = rawError.trim().toLowerCase();
  return (
    code.includes("pro_service_unavailable") ||
    code.includes("failed to fetch") ||
    code.includes("network") ||
    code.includes("timed out") ||
    code.includes("timeout") ||
    code.includes("connection refused") ||
    code.includes("error sending request") ||
    code.includes("unreachable") ||
    code.includes("dns") ||
    code.includes("502") ||
    code.includes("503") ||
    code.includes("504")
  );
}

export function formatCloudError(rawError: string, t: (key: string) => string): string {
  if (isCloudServerUnavailableError(rawError)) {
    return t("pro.offlineDetail");
  }
  return rawError;
}

export function mapProError(rawError: string, t: (key: string) => string): string {
  const code = rawError.trim().toLowerCase();
  if (code.includes("invalid_license_key") || code.includes("missing_license_key")) {
    return t("pro.errors.invalidKey");
  }
  if (code.includes("license_disabled")) {
    return t("pro.errors.disabledKey");
  }
  if (code.includes("license_already_claimed")) {
    return t("pro.errors.alreadyClaimed");
  }
  if (code.includes("rate_limited")) {
    return t("pro.errors.rateLimited");
  }
  if (code.includes("payhip") || isCloudServerUnavailableError(rawError)) {
    return t("pro.errors.serviceUnavailable");
  }
  return rawError || t("pro.errors.generic");
}
