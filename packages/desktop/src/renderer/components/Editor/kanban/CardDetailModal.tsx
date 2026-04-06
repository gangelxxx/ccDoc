import { useState, useEffect, useRef, useCallback } from "react";
import { useT } from "../../../i18n.js";
import { useAppStore } from "../../../stores/app.store.js";
import { sourceGetSection, sourceSaveSection } from "../source-api.js";
import type { KanbanCard, PropertyDefinition } from "./types.js";
import { PropertyEditor, PropertyDisplay } from "./PropertyEditor.js";

export function CardDetailModal({
  card,
  colId,
  properties,
  onUpdate,
  onClose,
}: {
  card: KanbanCard;
  colId: string;
  properties: PropertyDefinition[];
  onUpdate: (colId: string, cardId: string, updates: Partial<KanbanCard>) => void;
  onClose: () => void;
}) {
  const t = useT();
  const selectSection = useAppStore((s) => s.selectSection);
  const setScrollToMessageId = useAppStore((s) => s.setScrollToMessageId);
  const [editingTitle, setEditingTitle] = useState(false);
  const [title, setTitle] = useState(card.title);
  const [desc, setDesc] = useState(card.description);
  const [editingProp, setEditingProp] = useState<string | null>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize title textarea
  const autoResizeTitle = useCallback(() => {
    const ta = titleRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, window.innerHeight * 0.5) + "px";
  }, []);

  useEffect(() => {
    if (editingTitle) {
      requestAnimationFrame(autoResizeTitle);
    }
  }, [editingTitle, autoResizeTitle]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const syncIdeaText = async (newTitle: string, newDesc: string) => {
    if (!card.sourceIdeaId || !card.sourceMessageId) return;
    try {
      const sec = await sourceGetSection(card.sourceIdeaId);
      if (!sec) return;
      const data = JSON.parse(sec.content);
      const msg = data.messages?.find((m: any) => m.id === card.sourceMessageId);
      if (msg) {
        const descPart = newDesc.trim();
        msg.text = descPart ? `${newTitle}\n${descPart}` : newTitle;
        msg.editedAt = Date.now();
        await sourceSaveSection(card.sourceIdeaId, sec.title, JSON.stringify(data));
      }
    } catch { /* ignore */ }
  };

  const saveTitle = () => {
    const trimmed = title.trim() || card.title;
    setTitle(trimmed);
    setEditingTitle(false);
    onUpdate(colId, card.id, { title: trimmed });
    syncIdeaText(trimmed, desc);
  };

  const saveDesc = () => {
    onUpdate(colId, card.id, { description: desc });
    syncIdeaText(title, desc);
  };

  const setPropValue = (propId: string, value: any) => {
    onUpdate(colId, card.id, { properties: { ...card.properties, [propId]: value } });
  };

  return (
    <div className="kanban-modal-overlay" onClick={onClose}>
      <div className="kanban-modal" onClick={(e) => e.stopPropagation()}>
        <div className="kanban-modal-header">
          {editingTitle ? (
            <textarea
              ref={titleRef}
              className="kanban-modal-title-input"
              value={title}
              autoFocus
              rows={1}
              onChange={(e) => { setTitle(e.target.value); autoResizeTitle(); }}
              onBlur={saveTitle}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setTitle(card.title);
                  setEditingTitle(false);
                }
              }}
            />
          ) : (
            <h2 className="kanban-modal-title" onClick={() => setEditingTitle(true)}>
              {card.icon ? `${card.icon} ` : ""}{card.title}
            </h2>
          )}
          <button className="btn-icon kanban-modal-close" onClick={onClose}>×</button>
        </div>

        <div className="kanban-modal-props">
          {properties.map((prop) => (
            <div key={prop.id} className="kanban-modal-prop-row">
              <span className="kanban-modal-prop-label">{prop.name}</span>
              <div className="kanban-modal-prop-value" onClick={() => setEditingProp(prop.id)}>
                {editingProp === prop.id ? (
                  <PropertyEditor
                    prop={prop}
                    value={card.properties[prop.id]}
                    onChange={(v) => {
                      setPropValue(prop.id, v);
                      setEditingProp(null);
                    }}
                    onClose={() => setEditingProp(null)}
                  />
                ) : (
                  <PropertyDisplay prop={prop} value={card.properties[prop.id]} />
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="kanban-modal-divider" />

        <div className="kanban-modal-desc">
          <div className="kanban-modal-desc-label">{t("kanbanDescription")}</div>
          <textarea
            className="kanban-modal-desc-input"
            value={desc}
            placeholder={t("kanbanAddDescription")}
            onChange={(e) => setDesc(e.target.value)}
            onBlur={saveDesc}
            rows={3}
          />
        </div>

        {card.sourceIdeaId && (
          <button
            className="kanban-modal-idea-link"
            onClick={() => { if (card.sourceMessageId) setScrollToMessageId(card.sourceMessageId); selectSection(card.sourceIdeaId!); onClose(); }}
          >
            💡 {t("goToIdea")}
          </button>
        )}

        <div className="kanban-modal-meta">
          <span>{t("kanbanCreated", new Date(card.createdAt).toLocaleString())}</span>
          <span>{t("kanbanUpdated", new Date(card.updatedAt).toLocaleString())}</span>
        </div>
      </div>
    </div>
  );
}
