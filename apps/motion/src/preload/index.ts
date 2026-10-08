import { contextBridge, ipcRenderer } from 'electron';
import {
  authChangedChannel,
  authGoogleChannel,
  authSignInChannel,
  authSignOutChannel,
  authStateChannel,
  orbClickChannel,
  orbDragBeginChannel,
  orbDragEndChannel,
  orbDropChannel,
  orbStateChannel,
  panelCloseChannel,
  panelContentChannel,
  panelCurrentChannel,
  type OrbState,
  type ReadOutcome,
  type SiferBridge,
  type SignedInState,
  type SignInResult,
} from '../shared/bridge';

function subscribe<T>(channel: string, listener: (value: T) => void): () => void {
  const forward = (_event: unknown, value: T): void => listener(value);
  ipcRenderer.on(channel, forward);
  return () => {
    ipcRenderer.removeListener(channel, forward);
  };
}

const bridge: SiferBridge = {
  versions: {
    electron: process.versions.electron ?? '',
    chrome: process.versions.chrome ?? '',
    node: process.versions.node,
  },
  orb: {
    beginDrag: () => ipcRenderer.send(orbDragBeginChannel),
    endDrag: () => ipcRenderer.send(orbDragEndChannel),
    click: () => ipcRenderer.send(orbClickChannel),
    drop: () => ipcRenderer.send(orbDropChannel),
    onState: (listener: (state: OrbState) => void) => subscribe(orbStateChannel, listener),
  },
  auth: {
    state: () => ipcRenderer.invoke(authStateChannel) as Promise<SignedInState>,
    signIn: (email: string, password: string) =>
      ipcRenderer.invoke(authSignInChannel, email, password) as Promise<SignInResult>,
    signInWithGoogle: () => ipcRenderer.invoke(authGoogleChannel) as Promise<SignInResult>,
    signOut: () => ipcRenderer.invoke(authSignOutChannel) as Promise<SignedInState>,
    onChange: (listener: (state: SignedInState) => void) => subscribe(authChangedChannel, listener),
  },
  panel: {
    current: () => ipcRenderer.invoke(panelCurrentChannel) as Promise<ReadOutcome | null>,
    onContent: (listener: (content: ReadOutcome) => void) =>
      subscribe(panelContentChannel, listener),
    close: () => ipcRenderer.send(panelCloseChannel),
  },
};

contextBridge.exposeInMainWorld('sifer', bridge);
