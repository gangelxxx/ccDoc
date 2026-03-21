import { Sun, Moon } from "lucide-react";
import { useT, type Lang } from "../../../i18n.js";

interface ThemeTabProps {
  mode: "theme";
  themeDraft: "light" | "dark";
  onThemeChange: (v: "light" | "dark") => void;
}

interface LanguageTabProps {
  mode: "language";
  langDraft: Lang;
  onLangChange: (v: Lang) => void;
}

export type AppearanceTabProps = ThemeTabProps | LanguageTabProps;

export function AppearanceTab(props: AppearanceTabProps) {
  const t = useT();

  if (props.mode === "theme") {
    return (
      <div className="settings-section">
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
    );
  }

  return (
    <div className="settings-section">
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
  );
}
