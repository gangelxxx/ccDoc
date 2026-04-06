import type { IdeaData, IdeaMessage, TrashIdeaMessage, Section } from "../types.js";
import type { SectionsService } from "./sections.service.js";
import {
  TRASH_FOLDER_TITLE,
  TRASH_FOLDER_ICON,
  TRASH_IDEAS_TITLE,
  TRASH_IDEAS_ICON,
  TRASH_FOLDER_TITLES,
  TRASH_IDEAS_TITLES,
} from "../constants.js";

export interface TrashLabels {
  folderTitle: string;
  ideasTitle: string;
}

export interface TrashMeta {
  projectToken: string;
  projectName: string;
  sectionId: string;
  sectionTitle: string;
}

export class TrashService {
  private trashFolderId: string | null = null;
  private trashIdeaId: string | null = null;
  private folderTitle: string;
  private ideasTitle: string;

  constructor(private userSections: SectionsService, labels?: TrashLabels) {
    this.folderTitle = labels?.folderTitle ?? TRASH_FOLDER_TITLE;
    this.ideasTitle = labels?.ideasTitle ?? TRASH_IDEAS_TITLE;
  }

  async ensureTrashInfra(): Promise<{ folderId: string; ideaId: string }> {
    if (this.trashFolderId && this.trashIdeaId) {
      // Verify cached ids still exist
      const folder = await this.userSections.getById(this.trashFolderId);
      const idea = await this.userSections.getById(this.trashIdeaId);
      if (folder && idea) {
        return { folderId: this.trashFolderId, ideaId: this.trashIdeaId };
      }
      // Reset cache if stale
      this.trashFolderId = null;
      this.trashIdeaId = null;
    }

    // Find existing trash folder by any known title (handles language switches)
    let trashFolder: Section | null = null;
    for (const title of TRASH_FOLDER_TITLES) {
      trashFolder = await this.userSections.findChildByTitle(null, title, "folder");
      if (trashFolder) break;
    }

    if (!trashFolder) {
      trashFolder = await this.userSections.create({
        parentId: null,
        title: this.folderTitle,
        type: "folder",
        icon: TRASH_FOLDER_ICON,
      });
    } else if (trashFolder.title !== this.folderTitle) {
      // Rename to current locale
      await this.userSections.updateRaw(trashFolder.id, this.folderTitle, trashFolder.content);
      trashFolder = { ...trashFolder, title: this.folderTitle };
    }

    this.trashFolderId = trashFolder.id;

    // Find existing trash idea inside the folder (check all known titles)
    let trashIdea: Section | null = null;
    for (const title of TRASH_IDEAS_TITLES) {
      trashIdea = await this.userSections.findChildByTitle(trashFolder.id, title, "idea");
      if (trashIdea) break;
    }

    if (!trashIdea) {
      trashIdea = await this.userSections.create({
        parentId: trashFolder.id,
        title: this.ideasTitle,
        type: "idea",
        icon: TRASH_IDEAS_ICON,
      });
    } else if (trashIdea.title !== this.ideasTitle) {
      // Rename to current locale
      await this.userSections.updateRaw(trashIdea.id, this.ideasTitle, trashIdea.content);
      trashIdea = { ...trashIdea, title: this.ideasTitle };
    }

    this.trashIdeaId = trashIdea.id;
    return { folderId: this.trashFolderId, ideaId: this.trashIdeaId };
  }

  async addToTrash(message: IdeaMessage, meta: TrashMeta): Promise<void> {
    const { ideaId } = await this.ensureTrashInfra();
    const section = await this.userSections.getById(ideaId);

    let data: IdeaData;
    try {
      data = section?.content ? JSON.parse(section.content) : { messages: [] };
    } catch {
      data = { messages: [] };
    }

    const trashMessage: TrashIdeaMessage = {
      ...message,
      deletedAt: Date.now(),
      fromProjectToken: meta.projectToken,
      fromProjectName: meta.projectName,
      fromSectionId: meta.sectionId,
      fromSectionTitle: meta.sectionTitle,
    };

    data.messages.unshift(trashMessage);

    await this.userSections.updateRaw(ideaId, this.ideasTitle, JSON.stringify(data));
  }

  async permanentDelete(messageId: string): Promise<void> {
    const infra = await this.ensureTrashInfra();
    const section = await this.userSections.getById(infra.ideaId);
    if (!section) return;

    let data: IdeaData;
    try {
      data = JSON.parse(section.content);
    } catch {
      return;
    }

    data.messages = data.messages.filter((m) => m.id !== messageId);
    await this.userSections.updateRaw(infra.ideaId, this.ideasTitle, JSON.stringify(data));
  }

  async emptyTrash(): Promise<void> {
    const infra = await this.ensureTrashInfra();
    const data: IdeaData = { messages: [] };
    await this.userSections.updateRaw(infra.ideaId, this.ideasTitle, JSON.stringify(data));
  }

  async getTrashIdeaId(): Promise<string | null> {
    try {
      const infra = await this.ensureTrashInfra();
      return infra.ideaId;
    } catch {
      return null;
    }
  }

  async restoreMessage(messageId: string): Promise<TrashIdeaMessage | null> {
    const infra = await this.ensureTrashInfra();
    const section = await this.userSections.getById(infra.ideaId);
    if (!section) return null;

    let data: IdeaData;
    try {
      data = JSON.parse(section.content);
    } catch {
      return null;
    }

    const msg = data.messages.find((m) => m.id === messageId) as TrashIdeaMessage | undefined;
    if (!msg) return null;

    // Remove from trash
    data.messages = data.messages.filter((m) => m.id !== messageId);
    await this.userSections.updateRaw(infra.ideaId, this.ideasTitle, JSON.stringify(data));

    return msg;
  }
}
