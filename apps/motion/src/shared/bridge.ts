export interface RuntimeVersions {
  readonly electron: string;
  readonly chrome: string;
  readonly node: string;
}

export interface PointerPoint {
  readonly x: number;
  readonly y: number;
}

export interface OrbControls {
  beginDrag(pointer: PointerPoint): void;
  dragTo(pointer: PointerPoint): void;
  endDrag(): void;
}

export interface SiferBridge {
  readonly versions: RuntimeVersions;
  readonly orb: OrbControls;
}

export const orbDragBeginChannel = 'sifer:orb-drag-begin';
export const orbDragMoveChannel = 'sifer:orb-drag-move';
export const orbDragEndChannel = 'sifer:orb-drag-end';
