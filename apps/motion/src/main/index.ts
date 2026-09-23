import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, screen, session } from 'electron';
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

  load(orb, rendererPage('orb.html'));
  return orb;
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
  const [width] = orb.getSize();
  const place = orbRestingPlace(display.workArea, width);
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

  app.on('window-all-closed', () => app.quit());

  void app.whenReady().then(() => {
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) =>
      callback(false),
    );
    session.defaultSession.setPermissionCheckHandler(() => false);
    createOrb();
  });
}
