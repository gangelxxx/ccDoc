import { Sun, Moon } from "lucide-react";
import { useT, type Lang } from "../../../i18n.js";

type FontFamily = "default" | "serif" | "sans" | "mono" | "system";
type FontSize = "small" | "medium" | "large";
type ColorScheme = "teal" | "blue" | "purple";

export interface AppearanceTabProps {
  themeDraft: "light" | "dark";
  onThemeChange: (v: "light" | "dark") => void;
  langDraft: Lang;
  onLangChange: (v: Lang) => void;
  fontFamilyDraft: FontFamily;
  onFontFamilyChange: (v: FontFamily) => void;
  fontSizeDraft: FontSize;
  onFontSizeChange: (v: FontSize) => void;
  colorSchemeDraft: ColorScheme;
  onColorSchemeChange: (v: ColorScheme) => void;
  showIconProgress: boolean;
  onShowIconProgressChange: (v: boolean) => void;
}

const COLOR_SCHEMES: { key: ColorScheme; light: string; dark: string }[] = [
  { key: "teal",   light: "#0D7C66", dark: "#3DBFA0" },
  { key: "blue",   light: "#2563EB", dark: "#60A5FA" },
  { key: "purple", light: "#7C3AED", dark: "#A78BFA" },
];

const FONT_FAMILIES: { key: FontFamily; style?: React.CSSProperties }[] = [
  { key: "default", style: { fontFamily: '"DM Serif Display", Georgia, serif' } },
  { key: "serif",   style: { fontFamily: 'Georgia, "Times New Roman", serif' } },
  { key: "sans",    style: { fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif' } },
  { key: "mono",    style: { fontFamily: '"JetBrains Mono", "Fira Code", monospace' } },
  { key: "system",  style: { fontFamily: 'system-ui, sans-serif' } },
];

const FONT_SIZES: FontSize[] = ["small", "medium", "large"];

export function AppearanceTab(props: AppearanceTabProps) {
  const t = useT();
  const isDark = props.themeDraft === "dark";

  return (
    <div className="settings-section" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Theme */}
      <div>
        <div className="settings-section-label">{t("settingsTheme")}</div>
        <div className="settings-theme-options">
          <button
            className={`settings-theme-btn${props.themeDraft === "light" ? " active" : ""}`}
            onClick={() => props.onThemeChange("light")}
          >
            <Sun size={24} />
            <span>{t("themeLight")}</span>
          </button>
          <button
            className={`settings-theme-btn${props.themeDraft === "dark" ? " active" : ""}`}
            onClick={() => props.onThemeChange("dark")}
          >
            <Moon size={24} />
            <span>{t("themeDark")}</span>
          </button>
        </div>
      </div>

      {/* Color Scheme */}
      <div>
        <div className="settings-section-label">{t("colorScheme")}</div>
        <div className="settings-color-schemes">
          {COLOR_SCHEMES.map(({ key, light, dark }) => (
            <button
              key={key}
              className={`settings-color-scheme-btn${props.colorSchemeDraft === key ? " active" : ""}`}
              onClick={() => props.onColorSchemeChange(key)}
            >
              <span
                className="settings-color-swatch"
                style={{ background: isDark ? dark : light }}
              />
              <span className="settings-color-label">{t(`scheme_${key}`)}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Font Family */}
      <div>
        <div className="settings-section-label">{t("fontFamily")}</div>
        <div className="settings-font-families">
          {FONT_FAMILIES.map(({ key, style }) => (
            <button
              key={key}
              className={`settings-font-btn${props.fontFamilyDraft === key ? " active" : ""}`}
              onClick={() => props.onFontFamilyChange(key)}
              style={style}
            >
              {t(`fontFamily_${key}`)}
            </button>
          ))}
        </div>
      </div>

      {/* Font Size */}
      <div>
        <div className="settings-section-label">{t("fontSize")}</div>
        <div className="settings-font-sizes">
          {FONT_SIZES.map((size) => (
            <button
              key={size}
              className={`settings-theme-btn${props.fontSizeDraft === size ? " active" : ""}`}
              onClick={() => props.onFontSizeChange(size)}
            >
              <span style={{ fontSize: size === "small" ? 13 : size === "large" ? 17 : 15 }}>Aa</span>
              <span>{t(`fontSize_${size}`)}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Language */}
      <div>
        <div className="settings-section-label">{t("settingsLanguage")}</div>
        <div className="settings-theme-options">
          <button
            className={`settings-theme-btn${props.langDraft === "en" ? " active" : ""}`}
            onClick={() => props.onLangChange("en")}
          >
            <span style={{ fontSize: 24, fontWeight: 600 }}>EN</span>
            <span>{t("langEnglish")}</span>
          </button>
          <button
            className={`settings-theme-btn${props.langDraft === "ru" ? " active" : ""}`}
            onClick={() => props.onLangChange("ru")}
          >
            <span style={{ fontSize: 24, fontWeight: 600 }}>RU</span>
            <span>{t("langRussian")}</span>
          </button>
        </div>
      </div>

      {/* Icon progress */}
      <div>
        <label className="settings-toggle-row" style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={props.showIconProgress}
            onChange={(e) => props.onShowIconProgressChange(e.target.checked)}
          />
          <span>{t("showIconProgress")}</span>
        </label>
      </div>
    </div>
  );
}
