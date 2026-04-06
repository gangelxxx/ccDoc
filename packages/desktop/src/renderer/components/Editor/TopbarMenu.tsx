import { useState, useRef, useEffect } from "react";
import { Ellipsis, FileDown, FileUp, FolderSearch, Zap, X, SlidersHorizontal, ClipboardCopy } from "lucide-react";
import { useAppStore } from "../../stores/app.store.js";
import { useT } from "../../i18n.js";
import { InstallModal } from "../InstallModal/InstallModal.js";
import { UninstallModal } from "../InstallModal/UninstallModal.js";
import { ImportDocsModal } from "../ImportDocsModal/ImportDocsModal.js";
import { SettingsModal } from "../SettingsModal/SettingsModal.js";
import { PassportGeneratingModal } from "./PassportGeneratingModal.js";

// --- Topbar Menu ---
export function TopbarMenu() {
  const [open, setOpen] = useState(false);
  const [showInstall, setShowInstall] = useState(false);
  const [showUninstall, setShowUninstall] = useState(false);
  const [showImportDocs, setShowImportDocs] = useState(false);
  const [showPassportAfterImport, setShowPassportAfterImport] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { exportMarkdown, exportMarkdownTo, importMarkdown, importPdf, currentProject, currentSection, addToast, settingsOpen, openSettings, closeSettings } = useAppStore();
  const t = useT();

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div className="topbar-menu" ref={ref}>
      <button className="btn-icon" onClick={() => setOpen(!open)} title="Menu">
        <Ellipsis size={18} />
      </button>
      {open && (
        <div className="topbar-menu-dropdown">
          <button onClick={() => { openSettings(); setOpen(false); }}>
            <SlidersHorizontal size={15} /> {t("settingsMenuItem")}
          </button>
          <div className="topbar-menu-separator" />
          <button onClick={() => { exportMarkdown(); setOpen(false); }}>
            <FileDown size={15} /> {t("exportMarkdownProject")}
          </button>
          <button onClick={() => { exportMarkdownTo(); setOpen(false); }}>
            <FileDown size={15} /> {t("exportMarkdown")}
          </button>
          {currentSection && (
            <button onClick={async () => {
              setOpen(false);
              try {
                const st = useAppStore.getState();
                if (st.sectionSource === "user") {
                  await window.api.user.copySectionAsMarkdown(currentSection.id);
                } else {
                  if (!currentProject) return;
                  const copyToken = st.activeSectionToken || currentProject.token;
                  await window.api.copySectionAsMarkdown(copyToken, currentSection.id);
                }
                addToast("success", t("markdownCopied"));
              } catch {
                addToast("error", t("copyFailed"));
              }
            }}>
              <ClipboardCopy size={15} /> {t("copyAsMarkdown")}
            </button>
          )}
          <button onClick={() => { importMarkdown(); setOpen(false); }}>
            <FileUp size={15} /> {t("importMarkdown")}
          </button>
          <button onClick={() => { importPdf(); setOpen(false); }}>
            <FileUp size={15} /> {t("importPdf")}
          </button>
          <button onClick={() => { setShowImportDocs(true); setOpen(false); }}>
            <FolderSearch size={15} /> {t("importProjectDocs")}
          </button>
          <div className="topbar-menu-separator" />
          <button onClick={() => { setShowInstall(true); setOpen(false); }}>
            <Zap size={15} /> {t("claudeCodePlugin")}
          </button>
          <button onClick={() => { setShowUninstall(true); setOpen(false); }}>
            <X size={15} /> {t("excludePlugin")}
          </button>
        </div>
      )}
      {settingsOpen && <SettingsModal initialTab={settingsOpen} onClose={closeSettings} />}
      {showInstall && <InstallModal onClose={() => setShowInstall(false)} />}
      {showUninstall && <UninstallModal onClose={() => setShowUninstall(false)} />}
      {showImportDocs && (
        <ImportDocsModal
          onClose={() => setShowImportDocs(false)}
          onDone={() => {
            setShowPassportAfterImport(true);
            useAppStore.getState().generatePassport();
          }}
        />
      )}
      {showPassportAfterImport && <PassportGeneratingModal onClose={() => setShowPassportAfterImport(false)} />}
    </div>
  );
}
