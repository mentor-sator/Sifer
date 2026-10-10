import koffi from 'koffi';
import type { Point } from '../drag';
import { processName } from './process';
import type { WindowInfo } from './protocol';

const point = koffi.struct('SiferWindowPoint', { x: 'int32', y: 'int32' });

const user32 = koffi.load('user32.dll');
const windowFromPoint = user32.func('__stdcall', 'WindowFromPoint', 'void *', [point]);
const getAncestor = user32.func('void * __stdcall GetAncestor(void *window, uint32 flags)');
const getWindowThreadProcessId = user32.func('__stdcall', 'GetWindowThreadProcessId', 'uint32', [
  'void *',
  koffi.out(koffi.pointer('uint32')),
]);
const getWindowTextLength = user32.func('int32 __stdcall GetWindowTextLengthW(void *window)');
const getWindowText = user32.func('__stdcall', 'GetWindowTextW', 'int32', [
  'void *',
  'void *',
  'int32',
]);

const rootAncestor = 2;
export const maxTitleLength = 512;

function titleOf(window: unknown): string {
  const length = Math.min(getWindowTextLength(window) as number, maxTitleLength);
  if (length <= 0) {
    return '';
  }
  const buffer = Buffer.alloc((length + 1) * 2);
  const copied = getWindowText(window, buffer, length + 1) as number;
  return buffer.toString('utf16le', 0, Math.max(copied, 0) * 2);
}

export function windowAt(at: Point): WindowInfo | null {
  const child = windowFromPoint({ x: at.x, y: at.y }) as unknown;
  if (!child) {
    return null;
  }
  const root = (getAncestor(child, rootAncestor) as unknown) ?? child;
  const processId = [0];
  getWindowThreadProcessId(root, processId);
  const process = processName(processId[0] ?? 0);
  return process === null ? null : { process, title: titleOf(root) };
}
