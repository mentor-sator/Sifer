export interface RuntimeVersions {
  readonly electron: string;
  readonly chrome: string;
  readonly node: string;
}

export interface SiferBridge {
  readonly versions: RuntimeVersions;
}
