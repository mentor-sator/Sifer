import { browser } from 'wxt/browser';
import type { PopupRequest, Status } from '../../src/protocol';
import { isStatus, statusView } from '../../src/status';

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) {
    throw new Error(`missing #${id}`);
  }
  return found as T;
}

const statusLine = element<HTMLParagraphElement>('status');
const hint = element<HTMLParagraphElement>('hint');
const pairButton = element<HTMLButtonElement>('pair');
const recheckDelay = 1000;

function render(status: Status): void {
  const view = statusView(status);
  statusLine.textContent = view.label;
  statusLine.dataset['tone'] = view.tone;
  hint.textContent = view.hint;
  pairButton.hidden = !view.canPair;
  pairButton.disabled = false;
  if (status === 'connecting') {
    setTimeout(() => void ask({ type: 'sifer.status' }).then(render), recheckDelay);
  }
}

async function ask(request: PopupRequest): Promise<Status> {
  try {
    const answer: unknown = await browser.runtime.sendMessage(request);
    return isStatus(answer) ? answer : 'offline';
  } catch {
    return 'offline';
  }
}

pairButton.addEventListener('click', () => {
  pairButton.disabled = true;
  render('pairing');
  void ask({ type: 'sifer.pair' }).then(render);
});

void ask({ type: 'sifer.status' }).then(render);
