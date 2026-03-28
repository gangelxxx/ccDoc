import { useState } from "react";
import { X, Check, ArrowRight, Trash2, FolderOpen } from "lucide-react";
import { useT } from "../../i18n.js";
import type { IdeaMessage, IdeaProcessingResult } from "@ccdoc/core";

interface Props {
  result: IdeaProcessingResult;
  originalMessages: IdeaMessage[];
  onApply: (result: IdeaProcessingResult) => void;
  onCancel: () => void;
}

export function IdeaProcessingPreview({ result, originalMessages, onApply, onCancel }: Props) {
  const t = useT();
  const [activeTab, setActiveTab] = useState<"changes" | "duplicates" | "groups">("changes");

  const origMap = new Map(originalMessages.map((m) => [m.id, m]));

  // Detect text changes
  const textChanges = result.messages
    .map((m) => {
      const orig = origMap.get(m.id);
      if (!orig) return null;
      if (orig.text === m.text && !m.title && !m.group) return null;
      return { id: m.id, origText: orig.text, newText: m.text, title: m.title, group: m.group };
    })
    .filter(Boolean) as Array<{ id: string; origText: string; newText: string; title?: string; group?: string }>;

  const hasDuplicates = result.removedDuplicates.length > 0;
  const hasGroups = result.groups.length > 0;
  const hasChanges = textChanges.length > 0;

  const tabs = [
    { key: "changes" as const, label: t("ideaProcessChanges"), count: textChanges.length },
    ...(hasDuplicates ? [{ key: "duplicates" as const, label: t("ideaProcessRemoved"), count: result.removedDuplicates.length }] : []),
    ...(hasGroups ? [{ key: "groups" as const, label: t("ideaProcessGroupsTab"), count: result.groups.length }] : []),
  ];

  return (
    <div className="idea-processing-overlay" onClick={onCancel}>
      <div className="idea-processing-modal" onClick={(e) => e.stopPropagation()}>
        <div className="idea-processing-header">
          <h3>{t("ideaProcessPreview")}</h3>
          <button className="idea-processing-close" onClick={onCancel}>
            <X size={16} />
          </button>
        </div>

        {result.summary && (
          <div className="idea-processing-summary">{result.summary}</div>
        )}

        <div className="idea-processing-tabs">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              className={`idea-processing-tab${activeTab === tab.key ? " active" : ""}`}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label} {tab.count > 0 && <span className="idea-processing-tab-count">{tab.count}</span>}
            </button>
          ))}
        </div>

        <div className="idea-processing-content">
          {activeTab === "changes" && (
            <div className="idea-processing-changes">
              {!hasChanges && (
                <div className="idea-processing-empty">{t("ideaProcessNoChanges")}</div>
              )}
              {textChanges.map((change) => (
                <div key={change.id} className="idea-processing-change">
                  {change.title && (
                    <div className="idea-processing-change-title">
                      <strong>{change.title}</strong>
                    </div>
                  )}
                  {change.origText !== change.newText ? (
                    <div className="idea-processing-diff">
                      <div className="idea-processing-diff-old">
                        <span className="idea-processing-diff-label">{t("ideaProcessWas")}</span>
                        <div className="idea-processing-diff-text">{change.origText}</div>
                      </div>
                      <ArrowRight size={14} className="idea-processing-diff-arrow" />
                      <div className="idea-processing-diff-new">
                        <span className="idea-processing-diff-label">{t("ideaProcessBecame")}</span>
                        <div className="idea-processing-diff-text">{change.newText}</div>
                      </div>
                    </div>
                  ) : change.title ? (
                    <div className="idea-processing-diff-text idea-processing-diff-unchanged">{change.origText}</div>
                  ) : null}
                  {change.group && (
                    <span className="idea-processing-group-badge">{change.group}</span>
                  )}
                </div>
              ))}
            </div>
          )}

          {activeTab === "duplicates" && (
            <div className="idea-processing-duplicates">
              {result.removedDuplicates.map((rd, i) => {
                const kept = result.messages.find((m) => m.id === rd.keptId) || origMap.get(rd.keptId);
                return (
                  <div key={i} className="idea-processing-duplicate">
                    <div className="idea-processing-duplicate-kept">
                      <Check size={14} />
                      <span>{kept?.text || rd.keptId}</span>
                    </div>
                    {rd.removedIds.map((rid) => {
                      const removed = origMap.get(rid);
                      return (
                        <div key={rid} className="idea-processing-duplicate-removed">
                          <Trash2 size={12} />
                          <span>{removed?.text || rid}</span>
                        </div>
                      );
                    })}
                    <div className="idea-processing-duplicate-reason">
                      {t("ideaProcessReason")}: {rd.reason}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {activeTab === "groups" && (
            <div className="idea-processing-groups">
              {result.groups.map((group) => (
                <div key={group.name} className="idea-processing-group">
                  <div className="idea-processing-group-header">
                    <FolderOpen size={14} />
                    <span>{group.name}</span>
                    <span className="idea-processing-group-count">{group.messageIds.length}</span>
                  </div>
                  <div className="idea-processing-group-items">
                    {group.messageIds.map((mid) => {
                      const msg = result.messages.find((m) => m.id === mid);
                      return (
                        <div key={mid} className="idea-processing-group-item">
                          {msg?.title ? <strong>{msg.title}: </strong> : null}
                          {msg?.text || mid}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="idea-processing-footer">
          <button className="idea-processing-btn idea-processing-btn--cancel" onClick={onCancel}>
            {t("ideaProcessCancel")}
          </button>
          <button className="idea-processing-btn idea-processing-btn--apply" onClick={() => onApply(result)}>
            <Check size={14} />
            {t("ideaProcessApply")}
          </button>
        </div>
      </div>
    </div>
  );
}
