import type { MenuItemConstructorOptions } from 'electron';
import type { SignedInState } from '../shared/bridge';

export interface TrayState {
  session: SignedInState;
  orbVisible: boolean;
}

export interface TrayActions {
  toggleOrb: () => void;
  openSignIn: () => void;
  signOut: () => void;
  quit: () => void;
}

export function trayTooltip(state: TrayState): string {
  if (!state.orbVisible) {
    return 'Sifer - stopped';
  }
  return state.session.status === 'signed-in'
    ? `Sifer - ${state.session.email}`
    : 'Sifer - not signed in';
}

export function trayMenu(state: TrayState, actions: TrayActions): MenuItemConstructorOptions[] {
  const session = state.session;
  const signedIn = session.status === 'signed-in';
  return [
    {
      label: signedIn ? `Signed in as ${session.email}` : 'Not signed in',
      enabled: false,
    },
    { type: 'separator' },
    {
      label: state.orbVisible ? 'Stop Sifer (hide the orb)' : 'Start Sifer (show the orb)',
      click: actions.toggleOrb,
    },
    {
      label: signedIn ? 'Account...' : 'Sign in...',
      click: actions.openSignIn,
    },
    {
      label: 'Sign out',
      enabled: signedIn,
      click: actions.signOut,
    },
    { type: 'separator' },
    { label: 'Quit Sifer Motion', click: actions.quit },
  ];
}
