import { useState, useEffect, useCallback, useRef } from "react";
import { useAppStore } from "../stores/app.store.js";
import { useT } from "../i18n.js";

// Mirror of GitFileEntry from git.service.ts (renderer side)
export interface GitFileEntry {
  status: string;
  filePath: string;
  fileName: string;
  dirPath: string;
  isUntracked: boolean;
}

interface UseAutoCommitOptions {
  projectToken: string | null;
}

interface ModalState {
  isOpen: boolean;
  isLoading: boolean;
  commitMessage: string;
  taskText: string;
  changes: GitFileEntry[];
  unversioned: GitFileEntry[];
  checkedFiles: Set<string>;
  fileDiff: string | null;
}

const INITIAL_MODAL: ModalState = {
  isOpen: false,
  isLoading: false,
  commitMessage: "",
  taskText: "",
  changes: [],
  unversioned: [],
  checkedFiles: new Set(),
  fileDiff: null,
};

export function useAutoCommit({ projectToken }: UseAutoCommitOptions) {
  const t = useT();
  const addToast = useAppStore((s) => s.addToast);
  const [isEnabled, setIsEnabled] = useState(false);
  const [hasGitRepo, setHasGitRepo] = useState(false);
  const [modal, setModal] = useState<ModalState>(INITIAL_MODAL);
  const busyRef = useRef(false);

  const isAvailable = hasGitRepo && projectToken !== null;

  useEffect(() => {
    if (!projectToken) { setHasGitRepo(false); return; }
    window.api.gitHasRepo(projectToken).then(setHasGitRepo).catch(() => setHasGitRepo(false));
  }, [projectToken]);

  useEffect(() => {
    if (!projectToken) return;
    window.api.getPassport(projectToken)
      .then((passport) => setIsEnabled(passport?.auto_commit_enabled === "true"))
      .catch(() => {});
  }, [projectToken]);

  const toggle = useCallback(() => {
    if (!projectToken) return;
    const newValue = !isEnabled;
    setIsEnabled(newValue);
    window.api.setPassportField(projectToken, "auto_commit_enabled", String(newValue));
  }, [isEnabled, projectToken]);

  // ── Trigger: open modal, fetch status + commit message in parallel ──

  const triggerCommit = useCallback(async (taskText: string) => {
    if (!isEnabled || !projectToken || busyRef.current) return;
    busyRef.current = true;

    setModal({
      ...INITIAL_MODAL,
      isOpen: true,
      isLoading: true,
      taskText,
    });

    try {
      const [msgResult, statusResult] = await Promise.all([
        window.api.gitGenerateMessage(projectToken, taskText),
        window.api.gitStatusParsed(projectToken),
      ]);

      const changes: GitFileEntry[] = statusResult.changes || [];
      const unversioned: GitFileEntry[] = statusResult.unversioned || [];
      // Tracked changes checked by default, unversioned unchecked
      const checkedFiles = new Set(changes.map((f: GitFileEntry) => f.filePath));

      setModal((prev) => ({
        ...prev,
        isLoading: false,
        commitMessage: msgResult.message,
        changes,
        unversioned,
        checkedFiles,
      }));
    } catch (err: any) {
      setModal((prev) => ({
        ...prev,
        isLoading: false,
        commitMessage: `feat: ${taskText.slice(0, 60)}`,
      }));
      addToast("warning", t("commitError", String(err?.message || err)));
    }
  }, [isEnabled, projectToken, addToast, t]);

  // ── File selection ──

  const toggleFile = useCallback((filePath: string) => {
    setModal((prev) => {
      const next = new Set(prev.checkedFiles);
      if (next.has(filePath)) next.delete(filePath);
      else next.add(filePath);
      return { ...prev, checkedFiles: next };
    });
  }, []);

  const toggleGroup = useCallback((group: "changes" | "unversioned") => {
    setModal((prev) => {
      const files = group === "changes" ? prev.changes : prev.unversioned;
      const paths = files.map((f) => f.filePath);
      const allChecked = paths.every((p) => prev.checkedFiles.has(p));
      const next = new Set(prev.checkedFiles);
      for (const p of paths) {
        if (allChecked) next.delete(p);
        else next.add(p);
      }
      return { ...prev, checkedFiles: next };
    });
  }, []);

  // ── Context menu actions ──

  const refreshStatus = useCallback(async () => {
    if (!projectToken) return;
    try {
      const statusResult = await window.api.gitStatusParsed(projectToken);
      const changes: GitFileEntry[] = statusResult.changes || [];
      const unversioned: GitFileEntry[] = statusResult.unversioned || [];
      setModal((prev) => {
        // Keep only valid checked files
        const validPaths = new Set([...changes, ...unversioned].map((f) => f.filePath));
        const checkedFiles = new Set([...prev.checkedFiles].filter((p) => validPaths.has(p)));
        return { ...prev, changes, unversioned, checkedFiles };
      });
    } catch { /* ignore */ }
  }, [projectToken]);

  const rollbackFile = useCallback(async (filePath: string) => {
    if (!projectToken) return;
    try {
      await window.api.gitRollbackFile(projectToken, filePath);
      await refreshStatus();
    } catch (err: any) {
      addToast("error", String(err?.message || err));
    }
  }, [projectToken, refreshStatus, addToast]);

  const addToVcs = useCallback(async (filePath: string) => {
    if (!projectToken) return;
    try {
      await window.api.gitStageFiles(projectToken, [filePath]);
      await refreshStatus();
    } catch (err: any) {
      addToast("error", String(err?.message || err));
    }
  }, [projectToken, refreshStatus, addToast]);

  const addToGitignore = useCallback(async (filePath: string) => {
    if (!projectToken) return;
    try {
      await window.api.gitAddToGitignore(projectToken, filePath);
      await refreshStatus();
    } catch (err: any) {
      addToast("error", String(err?.message || err));
    }
  }, [projectToken, refreshStatus, addToast]);

  const showFileDiff = useCallback(async (filePath: string) => {
    if (!projectToken) return;
    try {
      const diff = await window.api.gitFileDiff(projectToken, filePath);
      setModal((prev) => ({ ...prev, fileDiff: diff || null }));
    } catch { /* ignore */ }
  }, [projectToken]);

  // ── Commit / Cancel ──

  const confirmCommit = useCallback(async (message: string) => {
    if (!projectToken) return;
    const files = [...modal.checkedFiles];
    if (files.length === 0) {
      addToast("warning", t("commitNoChanges"));
      return;
    }
    try {
      await window.api.gitCommitSelective(projectToken, message, files);
      addToast("success", t("commitSuccess", message.slice(0, 50)));
      setModal(INITIAL_MODAL);
      busyRef.current = false;
    } catch (err: any) {
      addToast("error", t("commitError", String(err?.message || err)));
    }
  }, [projectToken, modal.checkedFiles, addToast, t]);

  const cancelCommit = useCallback(() => {
    setModal(INITIAL_MODAL);
    busyRef.current = false;
  }, []);

  return {
    isEnabled,
    toggle,
    hasGitRepo,
    isAvailable,
    triggerCommit,
    modal,
    toggleFile,
    toggleGroup,
    rollbackFile,
    addToVcs,
    addToGitignore,
    showFileDiff,
    confirmCommit,
    cancelCommit,
  };
}

export type AutoCommitApi = ReturnType<typeof useAutoCommit>;
