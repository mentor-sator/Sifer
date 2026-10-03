import { contextBridge, ipcRenderer } from 'electron';
import {
  authChangedChannel,
  authSignInChannel,
  authSignOutChannel,
  authStateChannel,
  orbClickChannel,
  orbDragBeginChannel,
  orbDragEndChannel,
  orbDragMoveChannel,
  orbStateChannel,
  type OrbState,
  type PointerPoint,
  type SiferBridge,
  type SignedInState,
  type SignInResult,
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
    click: () => ipcRenderer.send(orbClickChannel),
    onState: (listener: (state: OrbState) => void) => {
      const forward = (_event: unknown, state: OrbState): void => listener(state);
      ipcRenderer.on(orbStateChannel, forward);
      return () => {
        ipcRenderer.removeListener(orbStateChannel, forward);
      };
    },
  },
  auth: {
    state: () => ipcRenderer.invoke(authStateChannel) as Promise<SignedInState>,
    signIn: (email: string, password: string) =>
      ipcRenderer.invoke(authSignInChannel, email, password) as Promise<SignInResult>,
    signOut: () => ipcRenderer.invoke(authSignOutChannel) as Promise<SignedInState>,
    onChange: (listener: (state: SignedInState) => void) => {
      const forward = (_event: unknown, state: SignedInState): void => listener(state);
      ipcRenderer.on(authChangedChannel, forward);
      return () => {
        ipcRenderer.removeListener(authChangedChannel, forward);
      };
    },
  },
};

contextBridge.exposeInMainWorld('sifer', bridge);
