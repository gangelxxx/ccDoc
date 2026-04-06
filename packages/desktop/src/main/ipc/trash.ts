import { ipcMain } from "electron";
import { TrashService } from "@ccdoc/core";
import type { TrashLabels } from "@ccdoc/core";
import { getUserService, getProjectServices, getProjectsService, getSettingsService } from "../services";

const TRASH_LABELS: Record<string, TrashLabels> = {
  en: { folderTitle: "Trash", ideasTitle: "Deleted ideas" },
  ru: { folderTitle: "Корзина", ideasTitle: "Удалённые идеи" },
};

let trashService: TrashService | null = null;
let trashServiceLang: string | null = null;

function getTrashService(): TrashService {
  const lang = getSettingsService()?.getAll().language ?? "en";
  if (!trashService || trashServiceLang !== lang) {
    const userService = getUserService();
    trashService = new TrashService(userService.sections, TRASH_LABELS[lang] ?? TRASH_LABELS.en);
    trashServiceLang = lang;
  }
  return trashService;
}

export function registerTrashIpc(): void {
  ipcMain.handle(
    "idea:delete-message",
    async (_e, token: string, sectionId: string, messageId: string) => {
      // Determine if this is a user-folder or project section
      const isUser = token === "__user__";

      let sections: Awaited<ReturnType<typeof getProjectServices>>["sections"];
      if (isUser) {
        sections = getUserService().sections;
      } else {
        const svc = await getProjectServices(token);
        sections = svc.sections;
      }

      const section = await sections.getById(sectionId);
      if (!section || section.type !== "idea") return { success: false };

      let data: { messages: any[]; kanbanId?: string };
      try {
        data = JSON.parse(section.content);
      } catch {
        return { success: false };
      }

      const message = data.messages.find((m: any) => m.id === messageId);
      if (!message) return { success: false };

      // 1. Copy to trash (fail-safe)
      try {
        let projectName = "User Folder";
        if (!isUser) {
          const projectsService = getProjectsService();
          const project = await projectsService.getByToken(token);
          projectName = project?.name ?? "Unknown";
        }

        await getTrashService().addToTrash(message, {
          projectToken: token,
          projectName,
          sectionId,
          sectionTitle: section.title,
        });
      } catch (err) {
        console.error("[trash] Failed to copy to trash:", err);
        // Don't block deletion
      }

      // 2. Delete plan section if exists
      if (message.planId) {
        try {
          if (isUser) {
            await getUserService().softDelete(message.planId);
          } else {
            const svc = await getProjectServices(token);
            await svc.sections.softDelete(message.planId);
          }
        } catch (err) {
          console.error("[trash] Failed to delete plan:", err);
        }
      }

      // 3. Remove message from original idea
      data.messages = data.messages.filter((m: any) => m.id !== messageId);
      await sections.updateRaw(sectionId, section.title, JSON.stringify(data));

      // 4. Remove linked kanban card
      if (data.kanbanId) {
        try {
          const kanbanSection = await sections.getById(data.kanbanId);
          if (kanbanSection) {
            const kanbanData = JSON.parse(kanbanSection.content);
            let changed = false;
            for (const col of kanbanData.columns ?? []) {
              const before = col.cards.length;
              col.cards = col.cards.filter((c: any) => c.sourceMessageId !== messageId);
              if (col.cards.length < before) changed = true;
            }
            if (changed) {
              await sections.updateRaw(data.kanbanId, kanbanSection.title, JSON.stringify(kanbanData));
            }
          }
        } catch { /* kanban may be deleted */ }
      }

      return { success: true };
    },
  );

  ipcMain.handle("idea:permanent-delete", async (_e, messageId: string) => {
    await getTrashService().permanentDelete(messageId);
    return { success: true };
  });

  ipcMain.handle("idea:empty-trash", async () => {
    await getTrashService().emptyTrash();
    return { success: true };
  });

  ipcMain.handle("idea:restore-message", async (_e, messageId: string) => {
    const trash = getTrashService();
    const msg = await trash.restoreMessage(messageId);
    if (!msg) return { success: false, error: "Message not found in trash" };

    // Try to restore to original idea
    const isUser = msg.fromProjectToken === "__user__";
    try {
      let sections: Awaited<ReturnType<typeof getProjectServices>>["sections"];
      if (isUser) {
        sections = getUserService().sections;
      } else {
        const svc = await getProjectServices(msg.fromProjectToken);
        sections = svc.sections;
      }

      const originalSection = await sections.getById(msg.fromSectionId);
      if (!originalSection || originalSection.type !== "idea") {
        // Original idea doesn't exist anymore — put back in trash
        await trash.addToTrash(msg, {
          projectToken: msg.fromProjectToken,
          projectName: msg.fromProjectName,
          sectionId: msg.fromSectionId,
          sectionTitle: msg.fromSectionTitle,
        });
        return { success: false, error: "original_deleted" };
      }

      let data: { messages: any[]; kanbanId?: string };
      try {
        data = JSON.parse(originalSection.content);
      } catch {
        data = { messages: [] };
      }
      if (!Array.isArray(data.messages)) {
        data.messages = [];
      }

      // Remove trash metadata before restoring
      const { deletedAt, fromProjectToken, fromProjectName, fromSectionId, fromSectionTitle, ...restoredMsg } = msg;
      data.messages.push(restoredMsg);

      await sections.updateRaw(msg.fromSectionId, originalSection.title, JSON.stringify(data));
      return { success: true };
    } catch (err) {
      console.error("[trash] Restore failed:", err);
      // Restore failed — put message back in trash
      try {
        await trash.addToTrash(msg, {
          projectToken: msg.fromProjectToken,
          projectName: msg.fromProjectName,
          sectionId: msg.fromSectionId,
          sectionTitle: msg.fromSectionTitle,
        });
      } catch { /* best effort */ }
      return { success: false, error: "restore_failed" };
    }
  });

  ipcMain.handle("idea:get-trash-id", async () => {
    return getTrashService().getTrashIdeaId();
  });
}
