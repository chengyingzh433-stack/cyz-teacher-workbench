import type { WorkbenchApi } from '../shared/ipc';

declare global {
  interface Window {
    workbenchApi: WorkbenchApi;
  }
}

export {};
