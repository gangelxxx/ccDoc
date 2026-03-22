import { useState, useRef } from "react";
import { useAppStore } from "../../stores/app.store.js";
import { useT } from "../../i18n.js";
import { TipTapEditor, EditorToolbar } from "./TipTapEditor.js";
import { KanbanBoard } from "./KanbanBoard.js";
import { DrawingCanvas } from "./DrawingCanvas.js";
import { FileView } from "./FileView.js";
import { LlmPanel } from "../LlmPanel/LlmPanel.js";
import { ResizeHandle } from "../ResizeHandle.js";
import { RefreshCw, X } from "lucide-react";

import { buildBreadcrumbs, findTreeNode, countTasks } from "./editor-utils.js";
import { Topbar } from "./Topbar.js";
import { HistoryView } from "./HistoryView.js";
import { FolderSummary } from "./FolderSummary.js";
import { IdeaChat } from "./IdeaChat.js";
import { EditorSearchBar } from "./EditorSearchBar.js";
import { ChildSections } from "./ChildSections.js";
import { NoProjectState, NoSectionState } from "./EmptyStates.js";
import { useOverscrollNav } from "./hooks/use-overscroll-nav.js";
import { useLlmResize } from "./hooks/use-llm-resize.js";
import { useTitleFit } from "./hooks/use-title-fit.js";

export function ContentArea() {
  const {
    currentProject,
    currentSection,
    sectionLoading,
    sidebarCollapsed,
    toggleSidebar,
    canGoBack,
    canGoForward,
    goBack,
    goForward,
    tree,
    selectSection,
    llmPanelOpen,
    toggleLlmPanel,
    quickIdeaOpen,
    toggleQuickIdea,
    renameSection,
    llmPanelWidth,
    historyViewCommit,
    externalChangePending,
    refreshCurrentSection,
    dismissExternalChange,
  } = useAppStore();

  const tca = useT();

  // Build breadcrumb path
  const breadcrumbs = buildBreadcrumbs(tree, currentSection?.id || null);

  // Section navigation (overscroll between sibling sections)
  const contentBodyRef = useRef<HTMLDivElement>(null);
  const [editorInstance, setEditorInstance] = useState<any>(null);
  const mainContentRef = useRef<HTMLDivElement>(null);

  const { overscrollPull, siblingInfo } = useOverscrollNav(contentBodyRef, tree, currentSection);
  const llmResize = useLlmResize(mainContentRef);
  const titleRef = useTitleFit(currentSection?.id, currentSection?.title);

  // --- History view mode ---
  if (historyViewCommit) {
    return (
      <div className="content-area-wrap">
        <div className="main-content" ref={mainContentRef}>
          <Topbar
            sidebarCollapsed={sidebarCollapsed}
            toggleSidebar={toggleSidebar}
            canGoBack={canGoBack}
            canGoForward={canGoForward}
            goBack={goBack}
            goForward={goForward}
            projectName={currentProject?.name}
            llmPanelOpen={llmPanelOpen}
            toggleLlmPanel={toggleLlmPanel}
            quickIdeaOpen={quickIdeaOpen}
            toggleQuickIdea={toggleQuickIdea}
          />
          <HistoryView />
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

  // --- No project ---
  if (!currentProject) {
    return <NoProjectState mainContentRef={mainContentRef} llmResize={llmResize} />;
  }

  // --- No section selected ---
  if (!currentSection) {
    return <NoSectionState mainContentRef={mainContentRef} llmResize={llmResize} />;
  }

  // --- Loading section ---
  if (sectionLoading) {
    return (
      <div className="content-area-wrap">
        <div className="main-content" ref={mainContentRef}>
          <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "200px", opacity: 0.5 }}>
            Загрузка...
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

  // --- Section selected ---
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
        projectName={currentProject.name}
        breadcrumbs={breadcrumbs}
        currentTitle={currentSection.title}
        onBreadcrumbClick={selectSection}
        llmPanelOpen={llmPanelOpen}
        toggleLlmPanel={toggleLlmPanel}
        quickIdeaOpen={quickIdeaOpen}
        toggleQuickIdea={toggleQuickIdea}
      />
      {externalChangePending && currentSection && (
        <div className="external-change-banner">
          <RefreshCw size={14} />
          <span>Документация обновлена внешним процессом</span>
          <button className="external-change-banner-btn" onClick={refreshCurrentSection}>Обновить</button>
          <button className="external-change-banner-btn external-change-banner-dismiss" onClick={dismissExternalChange}>
            <X size={14} />
          </button>
        </div>
      )}
      {overscrollPull && (
        <div className={`overscroll-pull overscroll-pull-${overscrollPull.dir}`}>
          <div className="overscroll-pull-inner" style={{
            opacity: 0.3 + overscrollPull.progress * 0.7
          }}>
            <svg className="overscroll-pull-arrow" viewBox="0 0 24 48" width="16"
              style={{ height: `${12 + overscrollPull.progress * 24}px` }}>
              <line x1="12" y1="0" x2="12" y2={48} stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              {overscrollPull.dir === "down"
                ? <path d="M5 38 L12 46 L19 38" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                : <path d="M5 10 L12 2 L19 10" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
              }
            </svg>
            <span className="overscroll-pull-title">{overscrollPull.title}</span>
          </div>
          <div className="overscroll-pull-line" style={{ transform: `scaleX(${overscrollPull.progress})` }} />
        </div>
      )}
      <div className="content-body" ref={contentBodyRef}>
        {currentSection.type !== "idea" && (
          <div className="section-title-area">
            <input
              ref={titleRef}
              className="section-title"
              value={currentSection.title}
              placeholder="Untitled"
              onChange={(e) => renameSection(currentSection.id, e.target.value)}
            />
            <div className="section-meta">
              <span>
                {new Date(currentSection.updated_at).toLocaleDateString(tca("dateLocale"), {
                  day: "numeric",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
              {siblingInfo && (
                <span className="section-position">{"\u00A7"} {siblingInfo.index + 1}/{siblingInfo.total}</span>
              )}
            </div>
          </div>
        )}
        {!["folder", "kanban", "drawing", "idea"].includes(currentSection.type) && (
          <div className="editor-sticky-top">
            {editorInstance && <EditorToolbar editor={editorInstance} />}
            <EditorSearchBar />
          </div>
        )}
        {currentSection.type === "todo" && (() => {
          const stats = countTasks(currentSection.content);
          const pct = stats.total > 0 ? Math.round((stats.checked / stats.total) * 100) : 0;
          return (
            <div className="todo-progress">
              <div className="todo-progress-bar">
                <div className="todo-progress-fill" style={{ width: `${pct}%` }} />
              </div>
              <span className="todo-progress-text">{stats.checked}/{stats.total} ({pct}%)</span>
            </div>
          );
        })()}
        {currentSection.type === "folder" ? (
          <FolderSummary
            folderId={currentSection.id}
            tree={tree}
            projectName={currentProject.name}
            onNavigate={selectSection}
          />
        ) : currentSection.type === "file" ? (
          <FileView
            key={currentSection.id}
            fileId={currentSection.id}
            fileTitle={currentSection.title}
            onActiveEditorChange={setEditorInstance}
          />
        ) : currentSection.type === "kanban" ? (
          <KanbanBoard
            key={currentSection.id}
            sectionId={currentSection.id}
            title={currentSection.title}
            initialContent={currentSection.content}
          />
        ) : currentSection.type === "drawing" ? (
          <DrawingCanvas
            key={currentSection.id}
            sectionId={currentSection.id}
            initialContent={currentSection.content}
          />
        ) : currentSection.type === "idea" ? (
          <IdeaChat
            key={currentSection.id}
            section={currentSection}
            tree={tree}
            onNavigate={selectSection}
          />
        ) : (
          <div className={currentSection.type === "section" && findTreeNode(tree, currentSection.id)?.children?.length > 0 ? "has-children" : ""}>
            <TipTapEditor
              key={currentSection.id}
              sectionId={currentSection.id}
              initialContent={currentSection.content}
              title={currentSection.title}
              showToolbar={false}
              onEditorReady={setEditorInstance}
            />
            {currentSection.type === "section" && (
              <>
                <ChildSections
                  parentId={currentSection.id}
                  tree={tree}
                  onNavigate={selectSection}
                />
              </>
            )}
          </div>
        )}
      </div>
      {siblingInfo && (
        <div className="section-nav-bar">
          <button
            className="section-nav-btn"
            disabled={!siblingInfo.prev}
            onClick={() => siblingInfo.prev && selectSection(siblingInfo.prev.id)}
          >
            {"\u2190"} {siblingInfo.prev?.title || ""}
          </button>
          <span className="section-nav-pos">{siblingInfo.index + 1} / {siblingInfo.total}</span>
          <button
            className="section-nav-btn"
            disabled={!siblingInfo.next}
            onClick={() => siblingInfo.next && selectSection(siblingInfo.next.id)}
          >
            {siblingInfo.next?.title || ""} {"\u2192"}
          </button>
        </div>
      )}
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
