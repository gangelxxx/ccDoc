import { ipcMain } from "electron";
import { getProjectServices } from "../services";

export function registerSectionPrefsIpc(): void {
  ipcMain.handle("section-prefs:get-all", async (_e, token: string, sectionId: string) => {
    const { sectionPrefs } = await getProjectServices(token);
    return sectionPrefs.getAllForSection(sectionId);
  });

  ipcMain.handle("section-prefs:set", async (_e, token: string, sectionId: string, key: string, value: unknown) => {
    const { sectionPrefs } = await getProjectServices(token);
    await sectionPrefs.set(sectionId, key, value);
  });

  ipcMain.handle("section-prefs:delete", async (_e, token: string, sectionId: string, key: string) => {
    const { sectionPrefs } = await getProjectServices(token);
    await sectionPrefs.delete(sectionId, key);
  });
}
