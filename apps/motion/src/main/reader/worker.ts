import type { ReadOutcome } from '../../shared/bridge';
import { processName } from './process';
import { isReadRequest, type ReaderReply, type ReadRequest } from './protocol';
import { readAt } from './strategy';
import { createUiAutomation, type UiAutomation } from './uia';

const port = process.parentPort;
if (!port) {
  throw new Error('the reader runs only as a utility process');
}

let automation: UiAutomation | null = null;
let unavailable = false;

function connect(): UiAutomation | null {
  if (!automation && !unavailable) {
    try {
      automation = createUiAutomation();
    } catch (error) {
      unavailable = true;
      console.error('ui automation unavailable', error);
    }
  }
  return automation;
}

function read(request: ReadRequest): ReadOutcome {
  const connected = connect();
  if (!connected) {
    return { ok: false, reason: 'unsupported' };
  }
  try {
    return readAt(connected, { x: request.x, y: request.y });
  } catch (error) {
    console.error('ui automation read failed', error);
    return { ok: false, reason: 'failed' };
  }
}

function app(request: ReadRequest): string | null {
  const connected = connect();
  if (!connected) {
    return null;
  }
  try {
    const processId = connected.processIdAt({ x: request.x, y: request.y });
    return processId === null ? null : processName(processId);
  } catch (error) {
    console.error('window lookup failed', error);
    return null;
  }
}

port.on('message', (event) => {
  const request: unknown = event.data;
  if (isReadRequest(request)) {
    const reply: ReaderReply =
      request.op === 'app'
        ? { id: request.id, app: app(request) }
        : { id: request.id, outcome: read(request) };
    port.postMessage(reply);
  }
});

process.once('exit', () => automation?.dispose());
