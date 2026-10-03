import type { SiferBridge } from '../../shared/bridge';

declare global {
  interface Window {
    readonly sifer: SiferBridge;
  }
}

export {};
