import { useCallback, useRef, useEffect } from "react";
import type { DrawState } from "../drawing-engine.js";
import { serializeDrawState } from "../drawing-engine.js";

interface UseAutoSaveParams {
  stateRef: React.RefObject<DrawState>;
  sectionId: string;
  currentSection: { id: string; title: string } | null;
  initialContent: string;
  updateSection: (id: string, title: string, content: string) => void;
}

export function useAutoSave({
  stateRef,
  sectionId,
  currentSection,
  initialContent,
  updateSection,
}: UseAutoSaveParams) {
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentSectionRef = useRef(currentSection);
  currentSectionRef.current = currentSection;
  const sectionIdRef = useRef(sectionId);
  sectionIdRef.current = sectionId;
  const lastSavedContent = useRef<string>(initialContent);

  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const json = serializeDrawState(stateRef.current!);
      lastSavedContent.current = json;
      const sec = currentSectionRef.current;
      // Use sectionId from props to avoid saving to wrong section after fast switch
      if (sec && sec.id === sectionIdRef.current) {
        updateSection(sectionIdRef.current, sec.title, json);
      }
    }, 500);
  }, [updateSection, stateRef]);

  // Flush pending changes on unmount to prevent data loss
  useEffect(() => () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      // Save immediately before unmount
      const json = serializeDrawState(stateRef.current!);
      if (json !== lastSavedContent.current) {
        const sec = currentSectionRef.current;
        if (sec && sec.id === sectionIdRef.current) {
          updateSection(sectionIdRef.current, sec.title, json);
        }
      }
    }
  }, []);

  return { scheduleSave, lastSavedContent };
}
