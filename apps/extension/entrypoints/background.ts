import { browser, type Browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { createConnection } from '../src/connection';
import {
  bridgeProbeUrl,
  isPopupRequest,
  isToken,
  type PageReadRequest,
  type ReadOutcome,
  type ScreenPoint,
  type Status,
} from '../src/protocol';
import { windowAt, type WindowBox } from '../src/target';

const tokenKey = 'bridgeToken';
const alarmName = 'sifer-bridge';

function identity(): { browser: string; version: string } {
  const agent = navigator.userAgent;
  const edge = /Edg\/(\d+)/.exec(agent);
  if (edge?.[1]) {
    return { browser: 'Edge', version: edge[1] };
  }
  return { browser: 'Chrome', version: /Chrome\/(\d+)/.exec(agent)?.[1] ?? 'unknown' };
}

function boxOf(window: Browser.windows.Window): WindowBox | null {
  const tab = window.tabs?.find((candidate) => candidate.active);
  if (window.id === undefined || tab?.id === undefined) {
    return null;
  }
  return {
    id: window.id,
    left: window.left ?? 0,
    top: window.top ?? 0,
    width: window.width ?? 0,
    height: window.height ?? 0,
    focused: window.focused,
    minimized: window.state === 'minimized',
    tabId: tab.id,
    tabTitle: tab.title ?? '',
  };
}

async function readPage(point: ScreenPoint, title: string): Promise<ReadOutcome> {
  const windows = await browser.windows.getAll({
    populate: true,
    windowTypes: ['normal', 'popup', 'app'],
  });
  const target = windowAt(
    windows.map(boxOf).filter((box): box is WindowBox => box !== null),
    point,
    title,
  );
  if (!target) {
    return { ok: false, reason: 'nothing' };
  }
  try {
    const zoom = await browser.tabs.getZoom(target.tabId);
    const request: PageReadRequest = { type: 'sifer.read', x: point.x, y: point.y, zoom };
    const outcome: unknown = await browser.tabs.sendMessage(target.tabId, request, { frameId: 0 });
    return (outcome as ReadOutcome | undefined) ?? { ok: false, reason: 'nothing' };
  } catch {
    return { ok: false, reason: 'unsupported' };
  }
}

async function reachable(): Promise<boolean> {
  try {
    await fetch(bridgeProbeUrl, { cache: 'no-store' });
    return true;
  } catch {
    return false;
  }
}

function updateBadge(status: Status): void {
  const connected = status === 'connected';
  void browser.action.setBadgeText({ text: connected ? '' : '!' });
  void browser.action.setBadgeBackgroundColor({ color: '#c4384b' });
  void browser.action.setTitle({ title: connected ? 'Sifer: connected' : `Sifer: ${status}` });
}

export default defineBackground(() => {
  const connection = createConnection({
    open: (url, protocols, handlers) => {
      const socket = new WebSocket(url, protocols);
      socket.addEventListener('open', () => handlers.open());
      socket.addEventListener('close', (event) => handlers.close(event.code));
      socket.addEventListener('message', (event: MessageEvent<unknown>) =>
        handlers.message(event.data),
      );
      return socket;
    },
    storage: {
      load: async () => {
        const stored = await browser.storage.local.get(tokenKey);
        const token: unknown = stored[tokenKey];
        return isToken(token) ? token : null;
      },
      save: (token) => browser.storage.local.set({ [tokenKey]: token }),
      clear: () => browser.storage.local.remove(tokenKey),
    },
    reachable,
    read: readPage,
    identity: identity(),
    setTimer: (callback, milliseconds) => setTimeout(callback, milliseconds),
    clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    setRepeating: (callback, milliseconds) => setInterval(callback, milliseconds),
    clearRepeating: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
    onStatus: updateBadge,
  });

  const ready = connection.connect();
  const popupUrl = browser.runtime.getURL('/popup.html');

  browser.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    if (sender.url !== popupUrl || !isPopupRequest(message)) {
      return false;
    }
    const answer =
      message.type === 'sifer.pair' ? connection.pair() : ready.then(() => connection.status);
    void answer.then(sendResponse);
    return true;
  });

  void browser.alarms.create(alarmName, { periodInMinutes: 1 });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === alarmName) {
      connection.ensure();
    }
  });
  browser.runtime.onStartup.addListener(() => connection.ensure());
  updateBadge(connection.status);
});
