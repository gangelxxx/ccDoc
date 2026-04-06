/**
 * Source-aware section read/write helpers.
 * Routes through user API or project API based on sectionSource in the store.
 */
import { useAppStore } from "../../stores/app.store.js";

export async function sourceGetSection(id: string): Promise<any> {
  const state = useAppStore.getState();
  if (state.sectionSource === "user") {
    return window.api.user.get(id);
  }
  const token = state.activeSectionToken || state.currentProject?.token;
  if (!token) return null;
  return window.api.getSection(token, id);
}

export async function sourceSaveSection(id: string, title: string, content: string): Promise<void> {
  const state = useAppStore.getState();
  if (state.sectionSource === "user") {
    await window.api.user.update(id, title, content);
  } else {
    const token = state.activeSectionToken || state.currentProject?.token;
    if (!token) return;
    await window.api.updateSection(token, id, title, content);
  }
}
