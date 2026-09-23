import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeImage,
  safeStorage,
  screen,
  session,
  Tray,
} from 'electron';
import {
  authChangedChannel,
  authSignInChannel,
  authSignOutChannel,
  authStateChannel,
  orbClickChannel,
  orbDragBeginChannel,
  orbDragEndChannel,
  orbDragMoveChannel,
  type SignedInState,
  type SignInResult,
} from '../shared/bridge';
import { readConfig } from './config';
import { createDrag, frameInterval } from './drag';
import { createIdentityClient, IdentityError } from './identity';
import { createSessionStore } from './secrets';
import { createSessionManager, type SessionManager } from './session';
import { signInWindowOptions } from './signin';
import { trayIcon } from './icon';
import { trayMenu, trayTooltip, type TrayState } from './tray';
import { orbRestingPlace, orbWindowOptions } from './orb';
import { isAllowedNavigation } from './security';

const here = fileURLToPath(new URL('.', import.meta.url));
const devServerUrl = process.env['ELECTRON_RENDERER_URL'];

type RendererPage = { kind: 'url'; value: string } | { kind: 'file'; value: string };

function rendererPage(page: string): RendererPage {
  if (devServerUrl) {
    return { kind: 'url', value: new URL(page, devServerUrl).toString() };
  }
  return { kind: 'file', value: join(here, '../renderer', page) };
}

function load(window: BrowserWindow, page: RendererPage): void {
  void (page.kind === 'url' ? window.loadURL(page.value) : window.loadFile(page.value));
}

function createOrb(): BrowserWindow {
  const orb = new BrowserWindow(orbWindowOptions(join(here, '../preload/index.cjs')));
  orb.setAlwaysOnTop(true, 'screen-saver');
  orb.setPosition(...positionFor(orb));

  let shown = false;
  const reveal = (): void => {
    if (shown || orb.isDestroyed()) {
      return;
    }
    shown = true;
    orb.setPosition(...positionFor(orb));
    orb.showInactive();
    report(orb);
  };
  orb.once('ready-to-show', reveal);
  orb.webContents.once('did-finish-load', reveal);
  orb.webContents.on('render-process-gone', (_event, details) =>
    console.error('orb renderer gone', details.reason),
  );
  orb.webContents.on('did-fail-load', (_event, code, description, url) =>
    console.error('orb failed to load', code, description, url),
  );

  attachDragging(orb);
  load(orb, rendererPage('orb.html'));
  return orb;
}

function attachDragging(orb: BrowserWindow): void {
  let pointer = { x: 0, y: 0 };
  const drag = createDrag({
    cursor: () => pointer,
    position: () => orb.getBounds(),
    size: () => orb.getBounds(),
    workArea: () => screen.getDisplayNearestPoint(pointer).workArea,
    move: (x, y) => {
      if (!orb.isDestroyed()) {
        orb.setPosition(x, y, false);
      }
    },
    start: (tick) => setInterval(tick, frameInterval),
    stop: (handle) => clearInterval(handle as NodeJS.Timeout),
  });

  const readPointer = (event: Electron.IpcMainEvent, x: unknown, y: unknown): boolean => {
    if (event.sender !== orb.webContents || !Number.isFinite(x) || !Number.isFinite(y)) {
      return false;
    }
    pointer = { x: x as number, y: y as number };
    return true;
  };

  ipcMain.on(orbDragBeginChannel, (event, x, y) => {
    if (readPointer(event, x, y)) {
      drag.begin();
    }
  });
  ipcMain.on(orbDragMoveChannel, (event, x, y) => {
    readPointer(event, x, y);
  });
  ipcMain.on(orbDragEndChannel, (event) => {
    if (event.sender === orb.webContents) {
      drag.end();
    }
  });
  orb.on('closed', () => drag.end());
}

function report(orb: BrowserWindow): void {
  const bounds = orb.getBounds();
  const display = screen.getDisplayNearestPoint({ x: bounds.x, y: bounds.y });
  console.log(
    `orb visible=${orb.isVisible()} onTop=${orb.isAlwaysOnTop()} at=${bounds.x},${bounds.y} size=${bounds.width}x${bounds.height} ` +
      `display=${display.workArea.width}x${display.workArea.height}+${display.workArea.x}+${display.workArea.y} scale=${display.scaleFactor}`,
  );
}

function positionFor(orb: BrowserWindow): [number, number] {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const place = orbRestingPlace(display.workArea, orb.getBounds().width);
  return [place.x, place.y];
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('session-created', (created) => {
    created.setSpellCheckerEnabled(false);
    created.setSpellCheckerLanguages([]);
  });

  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-navigate', (event, url) => {
      if (!isAllowedNavigation(url, devServerUrl)) {
        event.preventDefault();
      }
    });
    contents.on('will-attach-webview', (event) => event.preventDefault());
  });

  app.on('second-instance', () => {
    const [existing] = BrowserWindow.getAllWindows();
    existing?.showInactive();
  });

  app.on('window-all-closed', () => {
    if (quitting) {
      app.quit();
    }
  });

  app.on('before-quit', () => {
    quitting = true;
    tray?.destroy();
  });

  let signIn: BrowserWindow | null = null;
  let sessions: SessionManager | null = null;
  let orb: BrowserWindow | null = null;
  let tray: Tray | null = null;
  let quitting = false;

  const broadcast = (state: SignedInState): void => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send(authChangedChannel, state);
      }
    }
    refreshTray();
  };

  const trayState = (): TrayState => ({
    session: sessions?.state() ?? { status: 'signed-out' },
    orbVisible: Boolean(orb && !orb.isDestroyed() && orb.isVisible()),
  });

  function refreshTray(): void {
    if (!tray || tray.isDestroyed()) {
      return;
    }
    const state = trayState();
    tray.setToolTip(trayTooltip(state));
    tray.setContextMenu(
      Menu.buildFromTemplate(
        trayMenu(state, {
          toggleOrb: () => {
            if (!orb || orb.isDestroyed()) {
              return;
            }
            if (orb.isVisible()) {
              orb.hide();
            } else {
              orb.showInactive();
            }
            refreshTray();
          },
          openSignIn: () => openSignIn(),
          signOut: () => void sessions?.signOut(),
          quit: () => {
            quitting = true;
            app.quit();
          },
        }),
      ),
    );
  }

  function createTray(): void {
    const image = nativeImage.createFromDataURL(trayIcon.small);
    image.addRepresentation({ scaleFactor: 2, dataURL: trayIcon.large });
    tray = new Tray(image);
    tray.on('click', () => openSignIn());
    refreshTray();
  }

  const openSignIn = (): void => {
    if (signIn && !signIn.isDestroyed()) {
      signIn.show();
      signIn.focus();
      return;
    }
    signIn = new BrowserWindow(signInWindowOptions(join(here, '../preload/index.cjs')));
    signIn.once('ready-to-show', () => signIn?.show());
    signIn.webContents.once('did-finish-load', () => signIn?.show());
    signIn.on('closed', () => {
      signIn = null;
    });
    load(signIn, rendererPage('index.html'));
  };

  void app.whenReady().then(() => {
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) =>
      callback(false),
    );
    session.defaultSession.setPermissionCheckHandler(() => false);
    const config = readConfig();
    const secretFile = join(app.getPath('userData'), 'session.bin');
    const store = createSessionStore(safeStorage, {
      read: () => {
        try {
          return readFileSync(secretFile);
        } catch {
          return null;
        }
      },
      write: (contents) => writeFileSync(secretFile, contents, { mode: 0o600 }),
      remove: () => rmSync(secretFile, { force: true }),
    });
    sessions = createSessionManager({
      client: createIdentityClient({
        baseUrl: config.identityUrl,
        fetch: (url, init) => fetch(url, init),
      }),
      store,
      onChange: broadcast,
    });

    ipcMain.handle(authStateChannel, () => sessions?.state() ?? { status: 'signed-out' });
    ipcMain.handle(
      authSignInChannel,
      async (_event, email: unknown, password: unknown): Promise<SignInResult> => {
        if (
          typeof email !== 'string' ||
          typeof password !== 'string' ||
          email === '' ||
          password === ''
        ) {
          return { ok: false, reason: 'invalid' };
        }
        try {
          return { ok: true, state: await sessions!.signIn(email, password) };
        } catch (error) {
          return {
            ok: false,
            reason:
              error instanceof IdentityError && error.reason === 'credentials'
                ? 'credentials'
                : 'unavailable',
          };
        }
      },
    );
    ipcMain.handle(
      authSignOutChannel,
      async () => (await sessions?.signOut()) ?? { status: 'signed-out' },
    );
    ipcMain.on(orbClickChannel, () => openSignIn());

    orb = createOrb();
    orb.on('show', refreshTray);
    orb.on('hide', refreshTray);
    createTray();
    void sessions.restore();
  });
}
