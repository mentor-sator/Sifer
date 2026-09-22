import { contextBridge } from 'electron';
import type { SiferBridge } from '../shared/bridge';

const bridge: SiferBridge = {
  versions: {
    electron: process.versions.electron ?? '',
    chrome: process.versions.chrome ?? '',
    node: process.versions.node,
  },
};

contextBridge.exposeInMainWorld('sifer', bridge);
