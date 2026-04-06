import { useT } from "../../../i18n.js";

export interface SpellcheckTabProps {
  enabled: boolean;
  onEnabledChange: (v: boolean) => void;
  languages: string[];
  onLanguagesChange: (v: string[]) => void;
}

const AVAILABLE_LANGUAGES = [
  { key: "ru", label: "Русский" },
  { key: "en", label: "English" },
];

export function SpellcheckTab({ enabled, onEnabledChange, languages, onLanguagesChange }: SpellcheckTabProps) {
  const t = useT();

  const toggleLang = (lang: string) => {
    if (languages.includes(lang)) {
      // Don't allow removing all languages
      if (languages.length > 1) {
        onLanguagesChange(languages.filter((l) => l !== lang));
      }
    } else {
      onLanguagesChange([...languages, lang]);
    }
  };

  return (
    <div className="settings-section" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Enable/disable */}
      <div>
        <div className="settings-section-label">{t("spellcheckEnabled")}</div>
        <label className="settings-toggle" style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => onEnabledChange(e.target.checked)}
          />
          <span>{enabled ? t("spellcheckOn") : t("spellcheckOff")}</span>
        </label>
      </div>

      {/* Languages */}
      <div>
        <div className="settings-section-label">{t("spellcheckLanguages")}</div>
        <div style={{ display: "flex", gap: 8 }}>
          {AVAILABLE_LANGUAGES.map((lang) => (
            <button
              key={lang.key}
              type="button"
              className={`btn${languages.includes(lang.key) ? " btn-primary" : ""}`}
              onClick={() => toggleLang(lang.key)}
              disabled={!enabled}
            >
              {lang.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
