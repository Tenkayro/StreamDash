import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import de from "./locales/de.json";
import en from "./locales/en.json";
import es from "./locales/es.json";
import fr from "./locales/fr.json";
import ptBR from "./locales/pt-BR.json";
import type { AppLanguage } from "../types";

export const supportedLanguages = ["en", "de", "es", "pt-BR", "fr"] as const;

export function systemLanguage(): Exclude<AppLanguage, "auto"> {
  const languages = navigator.languages?.length
    ? navigator.languages
    : [navigator.language];
  for (const locale of languages) {
    const normalized = locale.toLowerCase();
    if (normalized.startsWith("de")) return "de";
    if (normalized.startsWith("es")) return "es";
    if (normalized.startsWith("pt")) return "pt-BR";
    if (normalized.startsWith("fr")) return "fr";
    if (normalized.startsWith("en")) return "en";
  }
  return "en";
}

export function resolveLanguage(language: AppLanguage) {
  return language === "auto" ? systemLanguage() : language;
}

void i18n.use(initReactI18next).init({
  resources: {
    de: { translation: de },
    en: { translation: en },
    es: { translation: es },
    fr: { translation: fr },
    "pt-BR": { translation: ptBR },
  },
  lng: systemLanguage(),
  fallbackLng: "en",
  interpolation: { escapeValue: false },
  returnNull: false,
});

export default i18n;
