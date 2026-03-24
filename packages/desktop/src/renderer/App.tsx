import { useEffect, useCallback, useRef, Component } from "react";
import type { ReactNode } from "react";
import { useAppStore } from "./stores/app.store.js";
import { t } from "./i18n.js";
import { Sidebar } from "./components/Sidebar/Sidebar.js";
import { ContentArea } from "./components/Editor/ContentArea.js";
import { ToastContainer } from "./components/Toast/Toast.js";
import { CommandPalette } from "./components/CommandPalette/CommandPalette.js";
import { StatusBar } from "./components/StatusBar/StatusBar.js";
import { ConfirmModal } from "./components/ConfirmModal/ConfirmModal.js";
import { RestoreProgressModal } from "./components/Editor/HistoryView.js";
import { ResizeHandle } from "./components/ResizeHandle.js";
import { QuickIdeaPopup } from "./components/QuickIdea/QuickIdea.js";

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 32, textAlign: "center" }}>
          <h2>{t(useAppStore.getState().language, "errorTitle")}</h2>
          <pre style={{ whiteSpace: "pre-wrap", color: "#c00", marginTop: 12 }}>
            {this.state.error.message}
          </pre>
          <button
            style={{ marginTop: 16, padding: "8px 16px", cursor: "pointer" }}
            onClick={() => this.setState({ error: null })}
          >
            {t(useAppStore.getState().language, "errorRetry")}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export function App() {
  const { loadProjects, theme, toggleTheme, toggleSidebar, setPaletteOpen, paletteOpen, sidebarCollapsed, sidebarWidth, setSidebarWidth, savePanelWidths, sectionLoading, treeLoading, initEmbeddingProgressListener, initVoiceProgressListener } = useAppStore();

  // Init theme & layout on mount
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);
  // Load projects
  useEffect(() => {
    loadProjects();
  }, []);

  // Global embedding progress listener (survives modal close)
  useEffect(() => {
    initEmbeddingProgressListener();
  }, []);

  // Global voice progress listener
  useEffect(() => {
    initVoiceProgressListener();
  }, []);

  // Auto-refresh tree when external process (MCP) modifies the DB (quiet mode — no focus switch)
  useEffect(() => {
    return window.api.onExternalDbChange(({ token }) => {
      const state = useAppStore.getState();
      if (state.currentProject?.token === token) {
        state.quietLoadTree();
      }
    });
  }, []);

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;

      // Ctrl+K — command palette
      if (mod && e.key === "k") {
        e.preventDefault();
        setPaletteOpen(!paletteOpen);
        return;
      }

      // Ctrl+\ — toggle sidebar
      if (mod && e.key === "\\") {
        e.preventDefault();
        toggleSidebar();
        return;
      }

      // Ctrl+Shift+D — toggle theme
      if (mod && e.shiftKey && e.key === "D") {
        e.preventDefault();
        toggleTheme();
        return;
      }

      // Ctrl+F — open local search
      if (mod && (e.code === "KeyF" || e.key === "f")) {
        const section = useAppStore.getState().currentSection;
        if (section?.type === "idea") {
          e.preventDefault();
          useAppStore.setState((s) => ({ ideaSearchTrigger: s.ideaSearchTrigger + 1 }));
          return;
        }
        if (section && ["file", "section", "todo"].includes(section.type)) {
          e.preventDefault();
          useAppStore.setState((s) => ({ editorSearchTrigger: s.editorSearchTrigger + 1 }));
          return;
        }
      }

      // Ctrl+Shift+I — quick idea
      if (mod && e.shiftKey && e.key === "I") {
        e.preventDefault();
        useAppStore.getState().toggleQuickIdea();
        return;
      }

      // Ctrl+S — prevent default (save version)
      if (mod && e.key === "s") {
        e.preventDefault();
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [paletteOpen, toggleSidebar, toggleTheme, setPaletteOpen]);

  const sidebarDragStart = useRef(0);

  const handleSidebarResizeStart = useCallback(() => {
    sidebarDragStart.current = useAppStore.getState().sidebarWidth;
  }, []);

  const handleSidebarResize = useCallback((delta: number) => {
    setSidebarWidth(sidebarDragStart.current + delta);
  }, [setSidebarWidth]);

  const handleSidebarResizeEnd = useCallback(() => {
    savePanelWidths();
  }, [savePanelWidths]);

  const handleSidebarDoubleClick = useCallback(() => {
    setSidebarWidth(268);
    savePanelWidths();
  }, [setSidebarWidth, savePanelWidths]);

  return (
    <ErrorBoundary>
      <div className="app-root">
        <div className="app-layout">
          {(sectionLoading || treeLoading) && <div className="global-loading-bar" />}
          <Sidebar />
          {!sidebarCollapsed && (
            <ResizeHandle
              side="left"
              onResizeStart={handleSidebarResizeStart}
              onResize={handleSidebarResize}
              onResizeEnd={handleSidebarResizeEnd}
              onDoubleClick={handleSidebarDoubleClick}
            />
          )}
          <ContentArea />
        </div>
        <StatusBar />
        <ToastContainer />
        <CommandPalette />
        <ConfirmModal />
        <RestoreProgressModal />
        <QuickIdeaPopup />
      </div>
    </ErrorBoundary>
  );
}
