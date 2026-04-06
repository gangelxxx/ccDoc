import { ipcMain } from "electron";
import { getProjectServices, suppressExternalChange } from "../services";
import type { IdeaData } from "@ccdoc/core";

export function registerIdeaProgressIpc(): void {
  ipcMain.handle(
    "idea:set-progress",
    async (_e, token: string, sectionId: string, messageId: string, progress: number) => {
      suppressExternalChange(token);
      const { sections } = await getProjectServices(token);
      const section = await sections.getById(sectionId);
      if (!section || section.type !== "idea") return null;
      let data: IdeaData;
      try {
        data = JSON.parse(section.content || '{"messages":[]}');
      } catch {
        data = { messages: [] };
      }
      const msg = data.messages.find(m => m.id === messageId);
      if (!msg) return null;
      msg.progress = Math.max(0, Math.min(100, Math.round(progress)));
      await sections.updateRaw(sectionId, section.title, JSON.stringify(data));
      return msg.progress;
    }
  );
}
