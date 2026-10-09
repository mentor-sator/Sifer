import type { Status } from './protocol';

export interface StatusView {
  readonly label: string;
  readonly hint: string;
  readonly tone: 'good' | 'warn';
  readonly canPair: boolean;
}

const views: Readonly<Record<Status, StatusView>> = {
  connected: {
    label: 'Connected to Sifer Motion',
    hint: 'Drop the orb on any page and Sifer reads it through this browser.',
    tone: 'good',
    canPair: false,
  },
  connecting: {
    label: 'Connecting...',
    hint: '',
    tone: 'warn',
    canPair: false,
  },
  offline: {
    label: 'Sifer Motion is not running',
    hint: 'Start Sifer Motion. The extension reconnects by itself.',
    tone: 'warn',
    canPair: true,
  },
  unpaired: {
    label: 'Not connected yet',
    hint: 'Press Connect, then choose Allow in the Sifer Motion window.',
    tone: 'warn',
    canPair: true,
  },
  pairing: {
    label: 'Waiting for you in Sifer Motion...',
    hint: 'Choose Allow in the dialog Sifer Motion just opened.',
    tone: 'warn',
    canPair: false,
  },
  refused: {
    label: 'Connection was not allowed',
    hint: 'Press Connect again and choose Allow in Sifer Motion.',
    tone: 'warn',
    canPair: true,
  },
};

export function isStatus(value: unknown): value is Status {
  return typeof value === 'string' && Object.hasOwn(views, value);
}

export function statusView(status: Status): StatusView {
  return views[status];
}
