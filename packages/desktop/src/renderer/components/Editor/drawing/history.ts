// Undo/Redo history stack

import type { DrawElement } from "./types.js";

export class HistoryStack {
  private undoStack: DrawElement[][] = [];
  private redoStack: DrawElement[][] = [];
  private maxSize = 100;

  push(elements: DrawElement[]) {
    this.undoStack.push(structuredClone(elements));
    if (this.undoStack.length > this.maxSize) this.undoStack.shift();
    this.redoStack = [];
  }

  undo(current: DrawElement[]): DrawElement[] | null {
    if (this.undoStack.length === 0) return null;
    this.redoStack.push(structuredClone(current));
    return this.undoStack.pop()!;
  }

  redo(current: DrawElement[]): DrawElement[] | null {
    if (this.redoStack.length === 0) return null;
    this.undoStack.push(structuredClone(current));
    return this.redoStack.pop()!;
  }

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
}
