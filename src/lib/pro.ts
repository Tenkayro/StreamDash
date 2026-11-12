export const PAYHIP_PRO_URL = "https://store.tenkayro.de/b/siOJA";

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
  if (code.includes("payhip") || code.includes("pro_service_unavailable")) {
    return t("pro.errors.serviceUnavailable");
  }
  return rawError || t("pro.errors.generic");
}
