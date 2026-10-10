import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  safeStorage,
  screen,
  session,
  shell,
  Tray,
  utilityProcess,
} from 'electron';
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
  type ReadOutcome,
  type SignedInState,
  type SignInResult,
} from '../shared/bridge';
import { readConfig } from './config';
import { createDrag, frameInterval, type Point } from './drag';
import { createDropReader, dropPoint } from './drop';
import { createGoogleSignIn, GoogleSignInError } from './google';
import { createIdentityClient, IdentityError } from './identity';
import { createSessionStore, type SecretFile } from './secrets';
import { createBridge, type Bridge } from './bridge/server';
import { createTokenStore } from './bridge/token';
import { createSessionManager, type SessionManager } from './session';
import { panelPlacement, panelSize, panelWindowOptions } from './panel';
import { contextMargin, createScreenCapture } from './reader/capture';
import { createReadChain } from './reader/chain';
import { createReaderClient } from './reader/client';
import { signInWindowOptions } from './signin';
import { trayIcon } from './icon';
import { trayMenu, trayTooltip, type TrayState } from './tray';
import {
  orbBoundsAt,
  orbRestingPlace,
  orbSize,
  orbStateFor,
  orbWindowOptions,
  type Activity,
} from './orb';
import { isAllowedNavigation } from './security';

const here = fileURLToPath(new URL('.', import.meta.url));
const devServerUrl = process.env['ELECTRON_RENDERER_URL'];
const preloadPath = join(here, '../preload/index.cjs');
const readerWorkerPath = join(here, 'reader-worker.js').replace(
  /app\.asar([\\/])/,
  'app.asar.unpacked$1',
);

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
  const created = new BrowserWindow(orbWindowOptions(preloadPath));
  created.setAlwaysOnTop(true, 'screen-saver');
  created.setPosition(...restingPosition());

  let shown = false;
  const reveal = (): void => {
    if (shown || created.isDestroyed()) {
      return;
    }
    shown = true;
    created.setPosition(...restingPosition());
    created.showInactive();
    report(created);
  };
  created.once('ready-to-show', reveal);
  created.webContents.once('did-finish-load', reveal);
  created.webContents.on('render-process-gone', (_event, details) =>
    console.error('orb renderer gone', details.reason),
  );
  created.webContents.on('did-fail-load', (_event, code, description, url) =>
    console.error('orb failed to load', code, description, url),
  );

  attachDragging(created);
  load(created, rendererPage('orb.html'));
  return created;
}

function attachDragging(created: BrowserWindow): void {
  const drag = createDrag({
    cursor: () => screen.getCursorScreenPoint(),
    position: () => created.getBounds(),
    size: () => ({ width: orbSize, height: orbSize }),
    area: () => screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).bounds,
    move: (x, y) => {
      if (!created.isDestroyed()) {
        created.setPosition(x, y, false);
      }
    },
    start: (tick) => setInterval(tick, frameInterval),
    stop: (handle) => clearInterval(handle as NodeJS.Timeout),
  });

  ipcMain.on(orbDragBeginChannel, (event) => {
    if (event.sender === created.webContents) {
      drag.begin();
    }
  });
  ipcMain.on(orbDragEndChannel, (event) => {
    if (event.sender === created.webContents) {
      drag.end();
      const [width, height] = created.getContentSize();
      if (width !== orbSize || height !== orbSize) {
        created.setContentSize(orbSize, orbSize);
      }
    }
  });
  created.on('closed', () => drag.end());
}

function report(created: BrowserWindow): void {
  const bounds = created.getBounds();
  const display = screen.getDisplayNearestPoint({ x: bounds.x, y: bounds.y });
  console.log(
    `created visible=${created.isVisible()} onTop=${created.isAlwaysOnTop()} at=${bounds.x},${bounds.y} size=${bounds.width}x${bounds.height} ` +
      `display=${display.workArea.width}x${display.workArea.height}+${display.workArea.x}+${display.workArea.y} scale=${display.scaleFactor}`,
  );
}

function secretFileAt(path: string): SecretFile {
  return {
    read: () => {
      try {
        return readFileSync(path);
      } catch {
        return null;
      }
    },
    write: (contents) => writeFileSync(path, contents, { mode: 0o600 }),
    remove: () => rmSync(path, { force: true }),
  };
}

function restingPosition(): [number, number] {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const place = orbRestingPlace(display.workArea, orbSize);
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
    reader?.close();
    void bridge?.stop();
    tray?.destroy();
  });

  let signIn: BrowserWindow | null = null;
  let sessions: SessionManager | null = null;
  let orb: BrowserWindow | null = null;
  let tray: Tray | null = null;
  let quitting = false;
  let activity: Activity = 'idle';
  let panel: BrowserWindow | null = null;
  let panelContent: ReadOutcome | null = null;
  let bridge: Bridge | null = null;

  const reader =
    process.platform === 'win32'
      ? createReaderClient({
          spawn: () => {
            const child = utilityProcess.fork(readerWorkerPath, [], {
              serviceName: 'Sifer Reader',
              stdio: 'inherit',
            });
            return {
              postMessage: (request) => child.postMessage(request),
              on: (event, listener) =>
                event === 'message' ? child.on('message', listener) : child.on('exit', listener),
              terminate: () => child.kill(),
            };
          },
        })
      : null;

  const capture = createScreenCapture({
    display: (point) => screen.getDisplayNearestPoint(point),
    screens: async (size) =>
      (await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size })).map(
        (source) => ({ displayId: source.display_id, image: source.thumbnail }),
      ),
  });

  const screenshot = async (dip: Point): Promise<ReadOutcome> => {
    if (!reader) {
      return { ok: false, reason: 'unsupported' };
    }
    try {
      const image = await capture(dip, orbSize / 2 + contextMargin);
      if (!image) {
        console.error('screenshot reader: no capture');
        return { ok: false, reason: 'nothing' };
      }
      const outcome = await reader.recognize(image);
      console.log(
        `screenshot reader: ${image.width}x${image.height} at ${image.point.x},${image.point.y} -> ${outcome.ok ? 'text' : outcome.reason}`,
      );
      return outcome;
    } catch (error) {
      console.error('screenshot reader failed', error);
      return { ok: false, reason: 'failed' };
    }
  };

  const readChain = createReadChain({
    app: (physical) => (reader ? reader.app(physical) : Promise.resolve(null)),
    extensionBrowser: () => (bridge?.connected ? (bridge.browser?.browser ?? null) : null),
    dom: (dip, title) => (bridge ? bridge.read(dip, title) : Promise.resolve(null)),
    accessibility: (physical) =>
      reader ? reader.read(physical) : Promise.resolve({ ok: false, reason: 'unsupported' }),
    screenshot,
  });

  const drops = createDropReader({
    hide: () => {
      panel?.hide();
      if (orb && !orb.isDestroyed()) {
        orb.setIgnoreMouseEvents(true);
        orb.setOpacity(0);
      }
    },
    restore: () => {
      if (orb && !orb.isDestroyed()) {
        orb.setOpacity(1);
        orb.setIgnoreMouseEvents(false);
      }
    },
    wait: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    read: (point) =>
      readChain(point, process.platform === 'win32' ? screen.dipToScreenPoint(point) : point),
  });

  const ensurePanel = (): BrowserWindow => {
    if (panel && !panel.isDestroyed()) {
      return panel;
    }
    const created = new BrowserWindow(panelWindowOptions(preloadPath));
    created.setAlwaysOnTop(true, 'floating');
    created.on('closed', () => {
      panel = null;
    });
    load(created, rendererPage('panel.html'));
    panel = created;
    return created;
  };

  const showPanel = (orbBounds: Electron.Rectangle, outcome: ReadOutcome): void => {
    panelContent = outcome;
    const target = ensurePanel();
    const workArea = screen.getDisplayMatching(orbBounds).workArea;
    target.setBounds({ ...panelPlacement(orbBounds, workArea), ...panelSize });
    if (target.webContents.isLoading()) {
      target.webContents.once('did-finish-load', () => target.showInactive());
      return;
    }
    target.webContents.send(panelContentChannel, outcome);
    target.showInactive();
  };

  const readUnderOrb = async (): Promise<void> => {
    if (!orb || orb.isDestroyed() || drops.busy) {
      return;
    }
    const bounds = orbBoundsAt(orb.getBounds());
    activity = 'reading';
    publishOrbState();
    const outcome = await drops.read(dropPoint(bounds));
    activity = 'idle';
    publishOrbState();
    if (outcome) {
      showPanel(bounds, outcome);
    }
  };

  const broadcast = (state: SignedInState): void => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send(authChangedChannel, state);
      }
    }
    refreshTray();
    publishOrbState();
  };

  const publishOrbState = (): void => {
    if (orb && !orb.isDestroyed()) {
      orb.webContents.send(
        orbStateChannel,
        orbStateFor(sessions?.state() ?? { status: 'signed-out' }, activity),
      );
    }
  };

  const trayState = (): TrayState => ({
    session: sessions?.state() ?? { status: 'signed-out' },
    orbVisible: Boolean(orb && !orb.isDestroyed() && orb.isVisible()),
    extension: bridge?.connected
      ? bridge.browser
        ? `${bridge.browser.browser} ${bridge.browser.version}`
        : 'connected'
      : null,
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
              panel?.hide();
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
          demoState: app.isPackaged
            ? undefined
            : () => {
                activity = activity === 'reading' ? 'idle' : 'reading';
                publishOrbState();
                refreshTray();
              },
          demoLabel:
            activity === 'reading' ? 'Demo: stop the reading ring' : 'Demo: show the reading ring',
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
    signIn = new BrowserWindow(signInWindowOptions(preloadPath));
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
    const store = createSessionStore(
      safeStorage,
      secretFileAt(join(app.getPath('userData'), 'session.bin')),
    );
    const identity = createIdentityClient({
      baseUrl: config.identityUrl,
      fetch: (url, init) => fetch(url, init),
    });
    sessions = createSessionManager({ client: identity, store, onChange: broadcast });
    const google = createGoogleSignIn({
      client: identity,
      openBrowser: (url) => shell.openExternal(url),
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
    ipcMain.handle(authGoogleChannel, async (): Promise<SignInResult> => {
      try {
        const state = sessions!.adopt(await google.signIn());
        signIn?.show();
        signIn?.focus();
        return { ok: true, state };
      } catch (error) {
        return {
          ok: false,
          reason: error instanceof GoogleSignInError ? error.reason : 'unavailable',
        };
      }
    });
    ipcMain.handle(
      authSignOutChannel,
      async () => (await sessions?.signOut()) ?? { status: 'signed-out' },
    );
    ipcMain.on(orbClickChannel, () => openSignIn());
    ipcMain.on(orbDropChannel, (event) => {
      if (orb && event.sender === orb.webContents) {
        void readUnderOrb();
      }
    });
    ipcMain.handle(panelCurrentChannel, () => panelContent);
    ipcMain.on(panelCloseChannel, (event) => {
      if (panel && event.sender === panel.webContents) {
        panel.hide();
      }
    });

    bridge = createBridge({
      tokens: createTokenStore(
        safeStorage,
        secretFileAt(join(app.getPath('userData'), 'bridge.bin')),
      ),
      approvePairing: async () => {
        const { response } = await dialog.showMessageBox({
          type: 'question',
          title: 'Sifer',
          message: 'Connect the Sifer browser extension?',
          detail:
            'The Sifer extension in your browser is asking to pair with Sifer Motion. ' +
            'Allow it only if you just pressed Connect in the extension.',
          buttons: ['Allow', 'Deny'],
          defaultId: 1,
          cancelId: 1,
          noLink: true,
        });
        return response === 0;
      },
      onStatus: (connected) => {
        console.log(`browser extension ${connected ? 'connected' : 'disconnected'}`);
        refreshTray();
      },
    });
    bridge.start().then(
      () => console.log(`bridge listening on 127.0.0.1:${bridge?.port}`),
      (error: Error) => console.error('bridge unavailable', error.message),
    );

    orb = createOrb();
    orb.on('show', refreshTray);
    orb.on('hide', refreshTray);
    orb.webContents.on('did-finish-load', publishOrbState);
    createTray();
    void sessions.restore();
  });
}
