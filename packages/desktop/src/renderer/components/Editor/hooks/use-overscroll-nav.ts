import { useState, useRef, useEffect, useMemo, useCallback, type RefObject } from "react";
import { useAppStore } from "../../../stores/app.store.js";
import { findSiblingInfo } from "../editor-utils.js";
import type { TreeNode, Section } from "../../../stores/types.js";

export interface OverscrollPull {
  dir: "up" | "down";
  progress: number;
  title: string;
}

export interface SiblingInfo {
  prev: { id: string; title: string } | null;
  next: { id: string; title: string } | null;
  index: number;
  total: number;
}

/**
 * Hook для overscroll-навигации между соседними секциями.
 * При прокрутке за край контейнера накапливает «тягу» и по достижении порога
 * переключает на соседнюю секцию.
 */
export function useOverscrollNav(
  contentBodyRef: RefObject<HTMLDivElement | null>,
  tree: TreeNode[],
  currentSection: Section | null
) {
  const selectSection = useAppStore((s) => s.selectSection);

  const overscrollAccum = useRef(0);
  const overscrollDir = useRef<"up" | "down" | null>(null);
  const overscrollDecayTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const overscrollCooldown = useRef(false);
  const [overscrollPull, setOverscrollPull] = useState<OverscrollPull | null>(null);

  // Reset overscroll on section change + cooldown to ignore residual wheel events
  useEffect(() => {
    setOverscrollPull(null);
    overscrollAccum.current = 0;
    overscrollDir.current = null;
    overscrollCooldown.current = true;
    if (overscrollDecayTimer.current) { clearTimeout(overscrollDecayTimer.current); overscrollDecayTimer.current = null; }
    const t = setTimeout(() => { overscrollCooldown.current = false; }, 150);
    return () => clearTimeout(t);
  }, [currentSection?.id]);

  const siblingInfo = useMemo((): SiblingInfo | null => {
    if (!currentSection || currentSection.type !== "section") return null;
    return findSiblingInfo(tree, currentSection.id);
  }, [tree, currentSection]);

  useEffect(() => {
    const el = contentBodyRef.current;
    if (!el || !siblingInfo) return;

    const THRESHOLD = 700;

    const resetOverscroll = () => {
      overscrollAccum.current = 0;
      overscrollDir.current = null;
      setOverscrollPull(null);
      if (overscrollDecayTimer.current) {
        clearTimeout(overscrollDecayTimer.current);
        overscrollDecayTimer.current = null;
      }
    };

    // After 800ms of no scrolling, just hide the indicator
    const scheduleHide = () => {
      if (overscrollDecayTimer.current) clearTimeout(overscrollDecayTimer.current);
      overscrollDecayTimer.current = setTimeout(resetOverscroll, 800);
    };

    const handleWheel = (e: WheelEvent) => {
      if (overscrollCooldown.current) return;
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 5;
      const atTop = el.scrollTop <= 2;

      if (atBottom && e.deltaY > 0 && siblingInfo.next) {
        if (overscrollDir.current !== "down") {
          overscrollDir.current = "down";
          overscrollAccum.current = 0;
        }
        if (overscrollDecayTimer.current) { clearTimeout(overscrollDecayTimer.current); overscrollDecayTimer.current = null; }
        overscrollAccum.current += e.deltaY;
        const progress = Math.min(overscrollAccum.current / THRESHOLD, 1);
        setOverscrollPull({ dir: "down", progress, title: siblingInfo.next.title || "" });
        if (overscrollAccum.current >= THRESHOLD) {
          resetOverscroll();
          selectSection(siblingInfo.next.id);
        } else {
          scheduleHide();
        }
      } else if (atTop && e.deltaY < 0 && siblingInfo.prev) {
        if (overscrollDir.current !== "up") {
          overscrollDir.current = "up";
          overscrollAccum.current = 0;
        }
        if (overscrollDecayTimer.current) { clearTimeout(overscrollDecayTimer.current); overscrollDecayTimer.current = null; }
        overscrollAccum.current += Math.abs(e.deltaY);
        const progress = Math.min(overscrollAccum.current / THRESHOLD, 1);
        setOverscrollPull({ dir: "up", progress, title: siblingInfo.prev.title || "" });
        if (overscrollAccum.current >= THRESHOLD) {
          resetOverscroll();
          selectSection(siblingInfo.prev.id);
        } else {
          scheduleHide();
        }
      } else {
        resetOverscroll();
      }
    };

    el.addEventListener("wheel", handleWheel, { passive: true });
    return () => {
      el.removeEventListener("wheel", handleWheel);
      if (overscrollDecayTimer.current) clearTimeout(overscrollDecayTimer.current);
    };
  }, [siblingInfo, selectSection]);

  return { overscrollPull, siblingInfo };
}
