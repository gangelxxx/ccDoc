import { useAppStore } from "../../stores/app.store.js";
import { useT } from "../../i18n.js";
import { LlmPanel } from "../LlmPanel/LlmPanel.js";
import { ResizeHandle } from "../ResizeHandle.js";
import { Topbar } from "./Topbar.js";
import type { RefObject } from "react";

interface LlmResizeHandlers {
  handleLlmResizeStart: () => void;
  handleLlmResize: (delta: number) => void;
  handleLlmResizeEnd: () => void;
  handleLlmDoubleClick: () => void;
  handleContentClick: () => void;
  handleLlmPanelClick: (e: React.MouseEvent) => void;
}

interface CommonProps {
  mainContentRef: RefObject<HTMLDivElement | null>;
  llmResize: LlmResizeHandlers;
}

// ---------- No Project ----------

export function NoProjectState({ mainContentRef, llmResize }: CommonProps) {
  const {
    projects,
    currentProject,
    sidebarCollapsed,
    toggleSidebar,
    goBack,
    goForward,
    selectProject,
    addProject,
    llmPanelOpen,
    toggleLlmPanel,
    llmPanelWidth,
  } = useAppStore();

  const t = useT();

  return (
    <div className="content-area-wrap">
      <div className="main-content" ref={mainContentRef} onClick={llmResize.handleContentClick}>
        <Topbar
          sidebarCollapsed={sidebarCollapsed}
          toggleSidebar={toggleSidebar}
          canGoBack={false}
          canGoForward={false}
          goBack={goBack}
          goForward={goForward}
        />
        <div className="empty-state">
          <h3>{t("welcomeTitle")}</h3>
          <p>
            {t("welcomeDesc")}
            <br />
            {t("welcomeDescSub")}
          </p>
          {projects.length > 0 && (
            <div className="welcome-recent-projects">
              <h4>{t("recentProjects")}</h4>
              {projects.slice(0, 5).map((p) => (
                <button
                  key={p.token}
                  className="welcome-project-item"
                  onClick={() => selectProject(p)}
                >
                  <span className="welcome-project-name">{p.name}</span>
                  <span className="welcome-project-path">{p.path}</span>
                </button>
              ))}
            </div>
          )}
          <div className="welcome-add-buttons">
            <button className="btn btn-primary" onClick={addProject}>
              {t("createProject")}
            </button>
            <button className="btn" onClick={addProject}>
              {t("addExistingProject")}
            </button>
          </div>
        </div>
      </div>
      {llmPanelOpen && (
        <ResizeHandle
          side="right"
          onResizeStart={llmResize.handleLlmResizeStart}
          onResize={llmResize.handleLlmResize}
          onResizeEnd={llmResize.handleLlmResizeEnd}
          onDoubleClick={llmResize.handleLlmDoubleClick}
        />
      )}
      <LlmPanel width={llmPanelWidth} onClick={llmResize.handleLlmPanelClick} />
    </div>
  );
}

// ---------- No Section ----------

export function NoSectionState({ mainContentRef, llmResize }: CommonProps) {
  const {
    currentProject,
    sidebarCollapsed,
    toggleSidebar,
    canGoBack,
    canGoForward,
    goBack,
    goForward,
    tree,
    createSection,
    llmPanelOpen,
    toggleLlmPanel,
    quickIdeaOpen,
    toggleQuickIdea,
    llmPanelWidth,
  } = useAppStore();

  const t = useT();

  const hasAnySections = tree.length > 0;

  return (
    <div className="content-area-wrap">
      <div className="main-content" ref={mainContentRef} onClick={llmResize.handleContentClick}>
        <Topbar
          sidebarCollapsed={sidebarCollapsed}
          toggleSidebar={toggleSidebar}
          canGoBack={canGoBack}
          canGoForward={canGoForward}
          goBack={goBack}
          goForward={goForward}
          projectName={currentProject!.name}
          llmPanelOpen={llmPanelOpen}
          toggleLlmPanel={toggleLlmPanel}
          quickIdeaOpen={quickIdeaOpen}
          toggleQuickIdea={toggleQuickIdea}
        />
        <div className="empty-state">
          {hasAnySections ? (
            <>
              <h3>{t("selectSection")}</h3>
              <p>{t("selectSectionHint")}</p>
            </>
          ) : (
            <>
              <h3>{t("projectEmpty")}</h3>
              <p>{t("projectEmptyHint")}</p>
              <button
                className="btn btn-primary"
                style={{ marginTop: 8 }}
                onClick={() => createSection(null, "Untitled", "folder")}
              >
                {t("newSectionBtn")}
              </button>
            </>
          )}
        </div>
      </div>
      {llmPanelOpen && (
        <ResizeHandle
          side="right"
          onResizeStart={llmResize.handleLlmResizeStart}
          onResize={llmResize.handleLlmResize}
          onResizeEnd={llmResize.handleLlmResizeEnd}
          onDoubleClick={llmResize.handleLlmDoubleClick}
        />
      )}
      <LlmPanel width={llmPanelWidth} onClick={llmResize.handleLlmPanelClick} />
    </div>
  );
}
