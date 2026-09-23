import { contextBridge, ipcRenderer } from 'electron';
import {
  orbDragBeginChannel,
  orbDragEndChannel,
  orbDragMoveChannel,
  type PointerPoint,
  type SiferBridge,
} from '../shared/bridge';

const bridge: SiferBridge = {
  versions: {
    electron: process.versions.electron ?? '',
    chrome: process.versions.chrome ?? '',
    node: process.versions.node,
  },
  orb: {
    beginDrag: (pointer: PointerPoint) =>
      ipcRenderer.send(orbDragBeginChannel, pointer.x, pointer.y),
    dragTo: (pointer: PointerPoint) => ipcRenderer.send(orbDragMoveChannel, pointer.x, pointer.y),
    endDrag: () => ipcRenderer.send(orbDragEndChannel),
  },
};

contextBridge.exposeInMainWorld('sifer', bridge);
