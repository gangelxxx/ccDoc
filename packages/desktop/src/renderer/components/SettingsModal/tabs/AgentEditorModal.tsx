import { useEffect } from "react";
import { createPortal } from "react-dom";
import { AgentEditor } from "./AgentEditor.js";
import type { CustomAgent } from "../../../stores/llm/types.js";

interface Props {
  agent: CustomAgent;
  onSave: (agent: CustomAgent) => void;
  onCancel: () => void;
}

export function AgentEditorModal({ agent, onSave, onCancel }: Props) {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCancel();
      }
    };
    document.addEventListener("keydown", handleKey, true);
    return () => document.removeEventListener("keydown", handleKey, true);
  }, [onCancel]);

  return createPortal(
    <div className="modal-overlay agent-editor-overlay" onClick={onCancel}>
      <div className="modal agent-editor-modal" onClick={(e) => e.stopPropagation()}>
        <AgentEditor agent={agent} onSave={onSave} onCancel={onCancel} />
      </div>
    </div>,
    document.body
  );
}
