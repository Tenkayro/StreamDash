import { openUrl } from "@tauri-apps/plugin-opener";

export const TERMS_URL = "https://tenkayro.de/terms/";
export const PRIVACY_URL = "https://tenkayro.de/privacy/#streamdash";
export const CONTACT_URL = "https://tenkayro.de/contact/";

/**
 * Opens a public legal or support URL in the user's browser.
 */
export async function openLegalPage(url: string): Promise<void> {
  try {
    await openUrl(url);
    return;
  } catch {
    // Fallback to browser window.open below.
  }
  if (typeof window !== "undefined") {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}
