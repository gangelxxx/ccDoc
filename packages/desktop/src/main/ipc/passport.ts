import { ipcMain } from "electron";
import { getProjectServices, suppressExternalChange } from "../services";

export function registerPassportIpc(): void {
  ipcMain.handle("passport:getAll", async (_e, token: string) => {
    const { passport } = await getProjectServices(token);
    return passport.getAll();
  });

  ipcMain.handle("passport:set", async (_e, token: string, key: string, value: string) => {
    suppressExternalChange(token);
    const { passport } = await getProjectServices(token);
    await passport.set(key, value);
  });

  ipcMain.handle("passport:delete", async (_e, token: string, key: string) => {
    suppressExternalChange(token);
    const { passport } = await getProjectServices(token);
    await passport.delete(key);
  });
}
