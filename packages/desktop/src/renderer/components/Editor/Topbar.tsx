import { MessageSquare, Columns2, Lightbulb } from "lucide-react";
import { useAppStore } from "../../stores/app.store.js";
import { useT } from "../../i18n.js";
import { TopbarMenu } from "./TopbarMenu.js";

// --- Content Width Button ---
export function ContentWidthButton() {
  const { contentWidth, cycleContentWidth } = useAppStore();
  const t = useT();
  const labelKey = contentWidth === "narrow" ? "contentWidthNarrow" as const : contentWidth === "medium" ? "contentWidthMedium" as const : "contentWidthWide" as const;
  return (
    <button
      className="btn-icon"
      onClick={cycleContentWidth}
      title={t("contentWidthTitle", t(labelKey))}
    >
      <Columns2 size={18} />
    </button>
  );
}

// --- Topbar ---
export function Topbar({
  sidebarCollapsed,
  toggleSidebar,
  canGoBack,
  canGoForward,
  goBack,
  goForward,
  projectName,
  breadcrumbs,
  currentTitle,
  onBreadcrumbClick,
  llmPanelOpen,
  toggleLlmPanel,
  quickIdeaOpen,
  toggleQuickIdea,
}: {
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  canGoBack: boolean;
  canGoForward: boolean;
  goBack: () => void;
  goForward: () => void;
  projectName?: string;
  breadcrumbs?: { id: string; title: string; isLinkedProject?: boolean }[];
  currentTitle?: string;
  onBreadcrumbClick?: (id: string) => void;
  llmPanelOpen?: boolean;
  toggleLlmPanel?: () => void;
  quickIdeaOpen?: boolean;
  toggleQuickIdea?: () => void;
}) {
  const t = useT();
  return (
    <div className="topbar">
      <div className="topbar-left">
        <button className="btn-icon" onClick={toggleSidebar} title={t("toggleSidebar")}>
          {"\u2630"}
        </button>
        <button className="btn-icon" disabled={!canGoBack} onClick={goBack} title={t("navBack")}>
          {"\u2190"}
        </button>
        <button className="btn-icon" disabled={!canGoForward} onClick={goForward} title={t("navForward")}>
          {"\u2192"}
        </button>
      </div>

      <div className="topbar-center">
        <div className="breadcrumbs">
          {projectName && (
            <span className={`breadcrumb-item${!currentTitle ? " current" : ""}`}>
              {projectName}
            </span>
          )}
          {breadcrumbs &&
            breadcrumbs.map((bc) => (
              <span key={bc.id} style={{ display: "contents" }}>
                <span className="breadcrumb-sep">/</span>
                <span
                  className={`breadcrumb-item${bc.isLinkedProject ? " breadcrumb-linked" : ""}`}
                  onClick={() => onBreadcrumbClick?.(bc.id)}
                >
                  {bc.isLinkedProject ? "\uD83D\uDCCE " : ""}{bc.title}
                </span>
              </span>
            ))}
          {currentTitle && (
            <>
              <span className="breadcrumb-sep">/</span>
              <span className="breadcrumb-item current">{currentTitle}</span>
            </>
          )}
        </div>
      </div>

      <div className="topbar-right">
        {projectName && (
          <>
            <button
              className={`btn-icon${quickIdeaOpen ? " active" : ""}`}
              onClick={toggleQuickIdea}
              title={t("quickIdea")}
            >
              <Lightbulb size={18} />
            </button>
            <button
              className={`btn-icon${llmPanelOpen ? " active" : ""}`}
              onClick={toggleLlmPanel}
              title={t("aiAssistant")}
              data-llm-toggle
            >
              <MessageSquare size={18} />
            </button>
            <TopbarMenu />
          </>
        )}
      </div>
    </div>
  );
}
