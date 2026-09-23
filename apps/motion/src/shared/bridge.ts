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
  click(): void;
}

export type SignedInState = { status: 'signed-out' } | { status: 'signed-in'; email: string };

export type SignInFailure = 'credentials' | 'unavailable' | 'invalid';

export type SignInResult =
  { ok: true; state: SignedInState } | { ok: false; reason: SignInFailure };

export interface AuthControls {
  state(): Promise<SignedInState>;
  signIn(email: string, password: string): Promise<SignInResult>;
  signOut(): Promise<SignedInState>;
  onChange(listener: (state: SignedInState) => void): () => void;
}

export interface SiferBridge {
  readonly versions: RuntimeVersions;
  readonly orb: OrbControls;
  readonly auth: AuthControls;
}

export const orbClickChannel = 'sifer:orb-click';
export const authStateChannel = 'sifer:auth-state';
export const authSignInChannel = 'sifer:auth-sign-in';
export const authSignOutChannel = 'sifer:auth-sign-out';
export const authChangedChannel = 'sifer:auth-changed';
export const orbDragBeginChannel = 'sifer:orb-drag-begin';
export const orbDragMoveChannel = 'sifer:orb-drag-move';
export const orbDragEndChannel = 'sifer:orb-drag-end';
