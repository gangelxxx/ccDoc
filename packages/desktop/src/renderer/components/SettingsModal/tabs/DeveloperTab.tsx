import { useAppStore } from "../../../stores/app.store.js";
import { useT } from "../../../i18n.js";

export function DeveloperTab() {
  const t = useT();
  const devTrackToolIssues = useAppStore(s => s.devTrackToolIssues);
  const setDevTrackToolIssues = useAppStore(s => s.setDevTrackToolIssues);

  return (
    <div className="settings-section">
      <h3>{t("settingsDeveloper")}</h3>
      <label className="llm-context-toggle">
        <input
          type="checkbox"
          checked={devTrackToolIssues}
          onChange={e => setDevTrackToolIssues(e.target.checked)}
        />
        {t("devTrackToolIssues")}
      </label>
    </div>
  );
}
