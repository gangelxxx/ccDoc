import { useState, useEffect, useRef, useCallback } from "react";
import { useT } from "../../i18n.js";
import { ContextMenu } from "../ContextMenu/ContextMenu.js";
import type { GitFileEntry } from "../../hooks/use-auto-commit.js";

export interface CommitConfirmModalProps {
  isOpen: boolean;
  taskText: string;
  commitMessage: string;
  isLoading: boolean;
  changes: GitFileEntry[];
  unversioned: GitFileEntry[];
  checkedFiles: Set<string>;
  fileDiff: string | null;
  onToggleFile: (filePath: string) => void;
  onToggleGroup: (group: "changes" | "unversioned") => void;
  onRollbackFile: (filePath: string) => void;
  onAddToVcs: (filePath: string) => void;
  onAddToGitignore: (filePath: string) => void;
  onShowFileDiff: (filePath: string) => void;
  onConfirm: (message: string) => void;
  onCancel: () => void;
}

// ── Status badge color mapping ──

const STATUS_CLASSES: Record<string, string> = {
  M: "modified",
  A: "added",
  D: "deleted",
  R: "renamed",
  "??": "untracked",
};

function statusClass(status: string): string {
  return STATUS_CLASSES[status] || "modified";
}

function statusLabel(status: string): string {
  return status === "??" ? "?" : status.charAt(0);
}

// ── FileGroup (collapsible group with tristate checkbox) ──

function FileGroup({
  label,
  files,
  checkedFiles,
  defaultExpanded,
  group,
  onToggleFile,
  onToggleGroup,
  onContextMenu,
}: {
  label: string;
  files: GitFileEntry[];
  checkedFiles: Set<string>;
  defaultExpanded: boolean;
  group: "changes" | "unversioned";
  onToggleFile: (filePath: string) => void;
  onToggleGroup: () => void;
  onContextMenu: (e: React.MouseEvent, file: GitFileEntry) => void;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const checkboxRef = useRef<HTMLInputElement>(null);

  const checkedCount = files.filter((f) => checkedFiles.has(f.filePath)).length;
  const allChecked = files.length > 0 && checkedCount === files.length;
  const someChecked = checkedCount > 0 && checkedCount < files.length;

  useEffect(() => {
    if (checkboxRef.current) {
      checkboxRef.current.indeterminate = someChecked;
    }
  }, [someChecked]);

  if (files.length === 0) return null;

  return (
    <div className="commit-file-group">
      <div className="commit-file-group-header" onClick={() => setExpanded(!expanded)}>
        <span className="commit-file-chevron">{expanded ? "\u25BC" : "\u25B6"}</span>
        <input
          ref={checkboxRef}
          type="checkbox"
          checked={allChecked}
          onChange={(e) => { e.stopPropagation(); onToggleGroup(); }}
          onClick={(e) => e.stopPropagation()}
        />
        <span>{label}</span>
        <span className="commit-file-count">{files.length}</span>
      </div>
      {expanded && files.map((file) => (
        <div
          key={file.filePath}
          className="commit-file-row"
          onContextMenu={(e) => { e.preventDefault(); onContextMenu(e, file); }}
        >
          <input
            type="checkbox"
            checked={checkedFiles.has(file.filePath)}
            onChange={() => onToggleFile(file.filePath)}
          />
          <span className={`commit-file-status ${statusClass(file.status)}`}>
            {statusLabel(file.status)}
          </span>
          <span className="commit-file-name">{file.fileName}</span>
          {file.dirPath && (
            <span className="commit-file-path">{file.dirPath}</span>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Main Modal ──

export function CommitConfirmModal({
  isOpen,
  taskText,
  commitMessage,
  isLoading,
  changes,
  unversioned,
  checkedFiles,
  fileDiff,
  onToggleFile,
  onToggleGroup,
  onRollbackFile,
  onAddToVcs,
  onAddToGitignore,
  onShowFileDiff,
  onConfirm,
  onCancel,
}: CommitConfirmModalProps) {
  const t = useT();
  const [message, setMessage] = useState(commitMessage);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; file: GitFileEntry } | null>(null);

  useEffect(() => {
    setMessage(commitMessage);
  }, [commitMessage]);

  useEffect(() => {
    if (isOpen && !isLoading && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.select();
    }
  }, [isOpen, isLoading]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onCancel(); }
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        if (!isLoading && message.trim()) onConfirm(message.trim());
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, isLoading, message, onConfirm, onCancel]);

  const handleContextMenu = useCallback((e: React.MouseEvent, file: GitFileEntry) => {
    setCtxMenu({ x: e.clientX, y: e.clientY, file });
  }, []);

  if (!isOpen) return null;

  const hasChanges = changes.length > 0 || unversioned.length > 0;

  // Build context menu items based on file type
  const ctxItems = ctxMenu ? (
    ctxMenu.file.isUntracked
      ? [
          { label: t("commitAddToVcs"), icon: "+", onClick: () => { onAddToVcs(ctxMenu.file.filePath); setCtxMenu(null); } },
          "sep" as const,
          { label: t("commitAddToGitignore"), icon: "\uD83D\uDEAB", onClick: () => { onAddToGitignore(ctxMenu.file.filePath); setCtxMenu(null); } },
        ]
      : [
          { label: t("commitShowDiff"), icon: "\u0394", onClick: () => { onShowFileDiff(ctxMenu.file.filePath); setCtxMenu(null); } },
          "sep" as const,
          { label: t("commitRollback"), danger: true, onClick: () => { onRollbackFile(ctxMenu.file.filePath); setCtxMenu(null); } },
        ]
  ) : [];

  return (
    <div className="kanban-modal-overlay" onClick={onCancel}>
      <div className="commit-confirm-dialog" onClick={(e) => e.stopPropagation()}>
        <h3 className="commit-confirm-title">{t("commitConfirmTitle")}</h3>

        {taskText && (
          <div className="commit-confirm-field">
            <label className="commit-confirm-label">{t("commitTaskLabel")}</label>
            <div className="commit-confirm-task">{taskText}</div>
          </div>
        )}

        {/* File tree */}
        {isLoading ? (
          <div className="commit-confirm-loading">{t("generating")}</div>
        ) : (
          <>
            {!hasChanges && (
              <div className="commit-confirm-warning">{t("commitNoChanges")}</div>
            )}
            <div className="commit-file-tree">
              <FileGroup
                label={t("commitChangesGroup")}
                files={changes}
                checkedFiles={checkedFiles}
                defaultExpanded={true}
                group="changes"
                onToggleFile={onToggleFile}
                onToggleGroup={() => onToggleGroup("changes")}
                onContextMenu={handleContextMenu}
              />
              <FileGroup
                label={t("commitUnversionedGroup")}
                files={unversioned}
                checkedFiles={checkedFiles}
                defaultExpanded={false}
                group="unversioned"
                onToggleFile={onToggleFile}
                onToggleGroup={() => onToggleGroup("unversioned")}
                onContextMenu={handleContextMenu}
              />
            </div>

            {/* Per-file diff preview */}
            {fileDiff && (
              <pre className="commit-file-diff">{fileDiff}</pre>
            )}

            {/* Commit message */}
            <div className="commit-confirm-field">
              <label className="commit-confirm-label">{t("commitMessageLabel")}</label>
              <textarea
                ref={textareaRef}
                className="commit-confirm-textarea"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={3}
              />
            </div>
          </>
        )}

        <div className="commit-confirm-actions">
          <button
            className="kanban-toolbar-btn commit-confirm-btn-primary"
            onClick={() => onConfirm(message.trim())}
            disabled={isLoading || !message.trim() || checkedFiles.size === 0}
          >
            {t("commitConfirmOk")}
          </button>
          <button className="kanban-toolbar-btn" onClick={onCancel}>
            {t("commitConfirmCancel")}
          </button>
        </div>
      </div>

      {/* Context menu */}
      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          items={ctxItems}
          onClose={() => setCtxMenu(null)}
        />
      )}
    </div>
  );
}
