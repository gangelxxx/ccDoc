import type { Api } from "../main/preload.js";

declare global {
  interface Window {
    api: Api;
  }
}
