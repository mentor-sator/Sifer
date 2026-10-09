import { browser } from 'wxt/browser';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { documentGeometry, extractAt } from '../src/extract';
import { toClientPoint, type PointerSample } from '../src/locate';
import { isPageReadRequest, type ReadOutcome } from '../src/protocol';

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  allFrames: false,
  main() {
    let sample: PointerSample | null = null;

    const remember = (event: PointerEvent | MouseEvent): void => {
      sample = {
        screenX: event.screenX,
        screenY: event.screenY,
        clientX: event.clientX,
        clientY: event.clientY,
        windowX: window.screenX,
        windowY: window.screenY,
      };
    };

    window.addEventListener('pointermove', remember, { capture: true, passive: true });
    window.addEventListener('pointerdown', remember, { capture: true, passive: true });
    window.addEventListener(
      'resize',
      () => {
        sample = null;
      },
      { passive: true },
    );

    browser.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
      if (sender.id !== browser.runtime.id || !isPageReadRequest(message)) {
        return false;
      }
      const point = toClientPoint(
        { x: message.x, y: message.y },
        {
          screenX: window.screenX,
          screenY: window.screenY,
          outerWidth: window.outerWidth,
          outerHeight: window.outerHeight,
          innerWidth: window.innerWidth,
          innerHeight: window.innerHeight,
        },
        message.zoom,
        sample,
      );
      const outcome: ReadOutcome = point
        ? extractAt(documentGeometry(document), point)
        : { ok: false, reason: 'nothing' };
      sendResponse(outcome);
      return false;
    });
  },
});
