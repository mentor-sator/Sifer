import { describe, expect, it, vi } from 'vitest';
import { trayMenu, trayTooltip, type TrayActions, type TrayState } from './tray';
import { trayIcon } from './icon';

const actions = (): TrayActions => ({
  toggleOrb: vi.fn(),
  openSignIn: vi.fn(),
  signOut: vi.fn(),
  quit: vi.fn(),
});

const signedIn: TrayState = {
  session: { status: 'signed-in', email: 'ninette@example.com' },
  orbVisible: true,
};
const signedOut: TrayState = { session: { status: 'signed-out' }, orbVisible: true };

const labels = (state: TrayState) =>
  trayMenu(state, actions()).map((item) => item.label ?? item.type);

describe('trayMenu', () => {
  it('names the signed-in account and offers sign out', () => {
    expect(labels(signedIn)).toEqual([
      'Signed in as ninette@example.com',
      'separator',
      'Stop Sifer (hide the orb)',
      'Account...',
      'Sign out',
      'separator',
      'Quit Sifer Motion',
    ]);
  });

  it('offers sign in and disables sign out when signed out', () => {
    const menu = trayMenu(signedOut, actions());
    expect(labels(signedOut)[0]).toBe('Not signed in');
    expect(menu.find((item) => item.label === 'Sign in...')).toBeTruthy();
    expect(menu.find((item) => item.label === 'Sign out')?.enabled).toBe(false);
  });

  it('turns the kill switch into a start switch once the orb is hidden', () => {
    expect(labels({ ...signedIn, orbVisible: false })).toContain('Start Sifer (show the orb)');
  });

  it('always offers quit and wires every action', () => {
    const wired = actions();
    const menu = trayMenu(signedIn, wired);
    for (const item of menu) {
      item.click?.(undefined as never, undefined, undefined as never);
    }
    expect(wired.toggleOrb).toHaveBeenCalledOnce();
    expect(wired.openSignIn).toHaveBeenCalledOnce();
    expect(wired.signOut).toHaveBeenCalledOnce();
    expect(wired.quit).toHaveBeenCalledOnce();
  });
});

describe('trayTooltip', () => {
  it('says who is signed in, or that Sifer is stopped', () => {
    expect(trayTooltip(signedIn)).toBe('Sifer - ninette@example.com');
    expect(trayTooltip(signedOut)).toBe('Sifer - not signed in');
    expect(trayTooltip({ ...signedIn, orbVisible: false })).toBe('Sifer - stopped');
  });
});

describe('trayIcon', () => {
  it('is an embedded PNG in both sizes', () => {
    for (const source of [trayIcon.small, trayIcon.large]) {
      expect(source.startsWith('data:image/png;base64,')).toBe(true);
      const bytes = Buffer.from(source.split(',')[1] ?? '', 'base64');
      expect(bytes.subarray(0, 8)).toEqual(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      );
    }
  });
});
