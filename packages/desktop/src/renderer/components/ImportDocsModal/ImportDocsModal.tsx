import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { useAppStore } from "../../stores/app.store.js";
import { useT } from "../../i18n.js";

import type { Phase, ScannedFile, ImportResult, VerifyResult, ProgressData } from "./types.js";
import { resolveTargetFolder } from "./helpers.js";
import { Stepper } from "./Stepper.js";
import { ScanPhase } from "./phases/ScanPhase.js";
import { SelectPhase } from "./phases/SelectPhase.js";
import { ImportPhaseView } from "./phases/ImportPhase.js";
import { VerifyPhase } from "./phases/VerifyPhase.js";
import { CleanupPhase } from "./phases/CleanupPhase.js";
import { DonePhaseView } from "./phases/DonePhase.js";

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ImportDocsModal({ onClose, onDone }: { onClose: () => void; onDone?: () => void }) {
  const currentProject = useAppStore((s) => s.currentProject);
  const tree = useAppStore((s) => s.tree);
  const currentSection = useAppStore((s) => s.currentSection);
  const t = useT();

  // Wizard state
  const [phase, setPhase] = useState<Phase>("scan");
  const [scanDone, setScanDone] = useState(false);
  const [scannedFiles, setScannedFiles] = useState<ScannedFile[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [importResults, setImportResults] = useState<ImportResult[]>([]);
  const [verifyResults, setVerifyResults] = useState<VerifyResult[]>([]);
  const [cleanupSelected, setCleanupSelected] = useState<Set<number>>(new Set());
  const [cleanupDeleted, setCleanupDeleted] = useState<string[]>([]);
  const [cleanupErrors, setCleanupErrors] = useState<string[]>([]);
  const [showOnlyErrors, setShowOnlyErrors] = useState(false);

  // Progress tracking
  const [scanCount, setScanCount] = useState(0);
  const [importCurrent, setImportCurrent] = useState(0);
  const [importTotal, setImportTotal] = useState(0);
  const [importFile, setImportFile] = useState("");

  const mountedRef = useRef(true);

  // ---- Progress listener (stable across lifecycle) ----
  useEffect(() => {
    const cleanup = window.api.onImportDocsProgress((data: ProgressData) => {
      if (!mountedRef.current) return;
      if (data.phase === "scan" && data.found != null) {
        setScanCount(data.found);
      }
      if (data.phase === "import") {
        if (data.current != null) setImportCurrent(data.current);
        if (data.total != null) setImportTotal(data.total);
        if (data.file) setImportFile(data.file);
      }
    });
    return () => {
      mountedRef.current = false;
      cleanup();
    };
  }, []);

  // ---- Phase 1: Scan (auto on mount) ----
  useEffect(() => {
    if (!currentProject) return;
    let cancelled = false;

    (async () => {
      try {
        const files = await window.api.scanProjectDocs(currentProject.token);
        if (cancelled) return;

        setScannedFiles(files);

        if (files.length === 0) {
          setScanDone(true);
          return;
        }

        setSelected(new Set(files.map((_: ScannedFile, i: number) => i)));
        setPhase("select");
      } catch (err: unknown) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        useAppStore.getState().addToast("error", t("errScan"), message);
        setScanDone(true);
      }
    })();

    return () => { cancelled = true; };
  }, [currentProject]);

  // ---- Phase 2: Selection handlers ----
  const toggleFile = useCallback((idx: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setSelected((prev) => {
      if (prev.size === scannedFiles.length) return new Set();
      return new Set(scannedFiles.map((_: ScannedFile, i: number) => i));
    });
  }, [scannedFiles]);

  const toggleDir = useCallback((indices: number[]) => {
    setSelected((prev) => {
      const next = new Set(prev);
      const allIn = indices.every((i) => next.has(i));
      if (allIn) {
        for (const i of indices) next.delete(i);
      } else {
        for (const i of indices) next.add(i);
      }
      return next;
    });
  }, []);

  // ---- Phase 3 + 4: Import then Verify ----
  const runImport = useCallback(async () => {
    if (!currentProject) return;

    let folderId = resolveTargetFolder(tree, currentSection);
    if (!folderId) {
      try {
        const folder = await window.api.createSection(currentProject.token, null, "Imported Docs", "folder");
        await useAppStore.getState().loadTree();
        folderId = folder.id;
      } catch {
        useAppStore.getState().addToast("error", t("errImport"), t("errFolderCreate"));
        return;
      }
    }

    const filesToImport = scannedFiles.filter((_, i) => selected.has(i));
    setImportTotal(filesToImport.length);
    setImportCurrent(0);
    setImportFile("");
    setPhase("import");

    try {
      const results = await window.api.importProjectDocs(
        currentProject.token,
        filesToImport.map((f) => ({ absolutePath: f.absolutePath, relativePath: f.relativePath })),
        folderId!,
      );
      if (!mountedRef.current) return;

      setImportResults(results);
      await useAppStore.getState().loadTree();

      // Auto-transition: verify
      setPhase("verify");

      const successful = results.filter((r: ImportResult) => r.success);
      if (successful.length > 0) {
        const verified = await window.api.verifyProjectDocs(
          currentProject.token,
          successful.map((r: ImportResult) => ({ relativePath: r.relativePath, absolutePath: r.absolutePath, fileId: r.fileId })),
        );
        if (mountedRef.current) setVerifyResults(verified);
      }
    } catch (err: unknown) {
      if (!mountedRef.current) return;
      const message = err instanceof Error ? err.message : String(err);
      useAppStore.getState().addToast("error", t("errImport"), message);
      setPhase("verify");
    }
  }, [currentProject, tree, currentSection, scannedFiles, selected, t]);

  // ---- Phase 5: Cleanup ----
  const goToCleanup = useCallback(() => {
    setCleanupSelected(new Set());
    setPhase("cleanup");
  }, []);

  const toggleCleanupFile = useCallback((idx: number) => {
    setCleanupSelected((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }, []);

  const toggleCleanupAll = useCallback(() => {
    setCleanupSelected((prev) => {
      const total = importResults.filter((r) => r.success).length;
      if (prev.size === total) return new Set();
      return new Set(Array.from({ length: total }, (_, i) => i));
    });
  }, [importResults]);

  const runCleanup = useCallback(async () => {
    const successfulResults = importResults.filter((r) => r.success);
    const pathsToDelete = successfulResults
      .filter((_, i) => cleanupSelected.has(i))
      .map((r) => r.absolutePath);

    if (pathsToDelete.length === 0) {
      setPhase("done");
      return;
    }

    try {
      const result = await window.api.cleanupProjectDocs(currentProject!.token, pathsToDelete);
      if (!mountedRef.current) return;
      setCleanupDeleted(result.deleted);
      setCleanupErrors(result.errors);
    } catch (err: unknown) {
      if (!mountedRef.current) return;
      const message = err instanceof Error ? err.message : String(err);
      useAppStore.getState().addToast("error", t("errDelete"), message);
    }

    setPhase("done");
  }, [importResults, cleanupSelected, t]);

  const skipCleanup = useCallback(() => setPhase("done"), []);

  // ---- Phase 6: Done (close handler) ----
  const handleDone = useCallback(() => {
    const lastSuccess = [...importResults].reverse().find((r) => r.success);
    if (lastSuccess) {
      useAppStore.getState().selectSection(lastSuccess.fileId);
    }

    const successCount = importResults.filter((r) => r.success).length;
    const errorCount = importResults.filter((r) => !r.success).length;
    const warningCount = verifyResults.filter((v) => !v.match || v.warnings.length > 0).length;

    let msg = `${successCount} file(s) imported`;
    if (cleanupDeleted.length > 0) msg += `, ${cleanupDeleted.length} original(s) deleted`;
    if (errorCount > 0) msg += `, ${errorCount} error(s)`;
    if (warningCount > 0) msg += `, ${warningCount} warning(s)`;

    useAppStore.getState().addToast(errorCount > 0 ? "warning" : "success", t("importDone"), msg);
    onClose();
    onDone?.();
  }, [importResults, verifyResults, cleanupDeleted, onClose, onDone, t]);

  // ---- Derived ----
  const successfulImports = importResults.filter((r) => r.success);
  const failedImports = importResults.filter((r) => !r.success);
  const totalWarnings = verifyResults.filter((v) => !v.match || v.warnings.length > 0 || v.brokenLinks > 0).length;

  // ---- Render ----
  return createPortal(
    <div className="modal-overlay">
      <div className="modal import-docs-modal" onClick={(e) => e.stopPropagation()}>
        <h3>{t("importDocsTitle")}</h3>
        <Stepper currentPhase={phase} />

        {phase === "verify" && totalWarnings > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <button
              className={`btn btn-sm${showOnlyErrors ? " btn-primary" : ""}`}
              onClick={() => setShowOnlyErrors(!showOnlyErrors)}
            >
              {t("showErrors", totalWarnings)}
            </button>
            {showOnlyErrors && (
              <button className="btn btn-sm" onClick={() => setShowOnlyErrors(false)}>
                {t("showAll", verifyResults.length)}
              </button>
            )}
          </div>
        )}

        <div className="import-docs-body">
          {phase === "scan" && (
            <ScanPhase scanCount={scanCount} scanDone={scanDone} />
          )}

          {phase === "select" && (
            <SelectPhase
              files={scannedFiles}
              selected={selected}
              onToggle={toggleFile}
              onToggleAll={toggleAll}
              onToggleDir={toggleDir}
            />
          )}

          {phase === "import" && (
            <ImportPhaseView current={importCurrent} total={importTotal} file={importFile} />
          )}

          {phase === "verify" && (
            <VerifyPhase
              results={verifyResults}
              failedImports={failedImports}
              showOnlyErrors={showOnlyErrors}
            />
          )}

          {phase === "cleanup" && (
            <CleanupPhase
              successfulImports={successfulImports}
              selected={cleanupSelected}
              onToggle={toggleCleanupFile}
              onToggleAll={toggleCleanupAll}
            />
          )}

          {phase === "done" && (
            <DonePhaseView
              successCount={successfulImports.length}
              deletedCount={cleanupDeleted.length}
              totalWarnings={totalWarnings}
              failedImports={failedImports}
              cleanupErrors={cleanupErrors}
            />
          )}
        </div>

        {/* Actions outside scroll area */}
        {phase === "scan" && scanDone && (
          <div className="modal-actions">
            <button className="btn btn-primary" onClick={onClose}>{t("close")}</button>
          </div>
        )}

        {phase === "select" && (
          <div className="modal-actions">
            <span style={{ opacity: 0.7, marginRight: "auto" }}>{t("filesSelected", selected.size)}</span>
            <button className="btn btn-primary" onClick={runImport} disabled={selected.size === 0}>
              {t("importBtn")}
            </button>
            <button className="btn" onClick={onClose}>{t("cancel")}</button>
          </div>
        )}

        {phase === "import" && (
          <div className="modal-actions">
            <button className="btn" onClick={onClose}>{t("cancel")}</button>
          </div>
        )}

        {phase === "verify" && (
          <div className="modal-actions">
            <button className="btn btn-primary" onClick={goToCleanup}>{t("goToCleanup")}</button>
            <button className="btn" onClick={() => { onClose(); onDone?.(); }}>{t("close")}</button>
          </div>
        )}

        {phase === "cleanup" && (
          <div className="modal-actions">
            <button className="btn btn-danger" onClick={runCleanup} disabled={cleanupSelected.size === 0}>
              {t("deleteSelected", cleanupSelected.size)}
            </button>
            <button className="btn" onClick={skipCleanup}>{t("skipCleanup")}</button>
          </div>
        )}

        {phase === "done" && (
          <div className="modal-actions">
            <button className="btn btn-primary" onClick={handleDone}>{t("close")}</button>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
