import { useAppStore } from "./stores/app.store.js";
import en from "./locales/en.json";
import ru from "./locales/ru.json";

export type Lang = "en" | "ru";

const locales: Record<Lang, Record<string, string>> = { en, ru };

export type TranslationKey = keyof typeof en;

/** Interpolate `{0}`, `{1}`, … placeholders */
function interpolate(template: string, args: (string | number)[]): string {
  return template.replace(/\{(\d+)\}/g, (_, i) => String(args[Number(i)] ?? ""));
}

/** Get translation by key, with optional positional args for `{0}`, `{1}`, … */
export function t(lang: Lang, key: TranslationKey, ...args: (string | number)[]): string {
  const val = locales[lang]?.[key] ?? locales.en[key] ?? key;
  return args.length ? interpolate(val, args) : val;
}

/** React hook — returns `t` bound to the current language */
export function useT() {
  const lang = useAppStore((s) => s.language);
  return (key: TranslationKey, ...args: (string | number)[]) => t(lang, key, ...args);
}

const apiErrKeys: Record<number, TranslationKey> = {
  401: "apiErr401",
  403: "apiErr403",
  404: "apiErr404",
  429: "apiErr429",
  500: "apiErr500",
  502: "apiErr502",
  503: "apiErr503",
  520: "apiErr520",
  529: "apiErr529",
};

/** Parse "[STATUS] message" from main process and return localized description */
export function localizeApiError(lang: Lang, raw: string): string {
  const m = raw.match(/^\[(\d{3})\]/);
  if (m) {
    const status = Number(m[1]);
    const key = apiErrKeys[status];
    if (key) return `${t(lang, key)} (${status})`;
    // Any 5xx → generic server error
    if (status >= 500) return `${t(lang, "apiErr500")} (${status})`;
    return `${t(lang, "apiErrUnknown")} (${status})`;
  }
  if (/fetch failed|network|ECONNREFUSED|ETIMEDOUT/i.test(raw)) {
    return t(lang, "apiErrNetwork");
  }
  return raw;
}
