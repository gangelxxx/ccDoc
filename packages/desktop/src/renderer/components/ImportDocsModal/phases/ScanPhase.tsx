import { useT } from "../../../i18n.js";

export function ScanPhase({ scanCount, scanDone }: { scanCount: number; scanDone: boolean }) {
  const t = useT();

  if (scanDone) {
    return (
      <div className="import-docs-empty">
        <p>{t("scanNoFiles")}</p>
      </div>
    );
  }

  return (
    <div style={{ textAlign: "center", padding: "32px 0" }}>
      <div className="import-docs-spinner" />
      <p>{t("scanProgress")}</p>
      {scanCount > 0 && <p style={{ opacity: 0.7 }}>{t("scanFoundPrefix")}{scanCount}</p>}
    </div>
  );
}
