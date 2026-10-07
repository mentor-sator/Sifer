import type { ReadingKind, ReadOutcome } from '../../shared/bridge';
import type { Point } from '../drag';

export const maxReadingLength = 20_000;
export const maxAncestors = 10;

export interface AutomationNode {
  controlType(): number;
  isPassword(): boolean;
  name(): string;
  textAt(point: Point): string | null;
  value(): string | null;
  parent(): AutomationNode | null;
  release(): void;
}

export interface Automation {
  elementAt(point: Point): AutomationNode | null;
}

const controlNames: Readonly<Record<number, string>> = {
  50000: 'Button',
  50002: 'Check box',
  50003: 'Combo box',
  50004: 'Edit',
  50005: 'Link',
  50007: 'List item',
  50008: 'List',
  50011: 'Menu item',
  50020: 'Text',
  50025: 'Custom',
  50026: 'Group',
  50029: 'Data item',
  50030: 'Document',
  50032: 'Window',
  50033: 'Pane',
  50036: 'Table',
};

export function controlName(controlType: number): string {
  return controlNames[controlType] ?? 'Element';
}

const noBreakSpace = String.fromCharCode(160);

export function normalizeText(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .replaceAll(noBreakSpace, ' ')
    .trim()
    .slice(0, maxReadingLength);
}

function found(kind: ReadingKind, node: AutomationNode, raw: string | null): ReadOutcome | null {
  const text = raw === null ? '' : normalizeText(raw);
  if (text === '') {
    return null;
  }
  return {
    ok: true,
    reading: { source: 'accessibility', kind, control: controlName(node.controlType()), text },
  };
}

export function readAt(automation: Automation, point: Point): ReadOutcome {
  const target = automation.elementAt(point);
  if (!target) {
    return { ok: false, reason: 'nothing' };
  }
  const held: AutomationNode[] = [target];
  try {
    if (target.isPassword()) {
      return { ok: false, reason: 'protected' };
    }
    const own = found('value', target, target.value());
    let node: AutomationNode | null = target;
    for (let depth = 0; node && depth <= maxAncestors; depth += 1) {
      if (node.isPassword()) {
        return { ok: false, reason: 'protected' };
      }
      const text = found('text', node, node.textAt(point));
      if (text) {
        return text;
      }
      if (depth === 0 && own) {
        return own;
      }
      node = depth < maxAncestors ? node.parent() : null;
      if (node) {
        held.push(node);
      }
    }
    return found('name', target, target.name()) ?? { ok: false, reason: 'nothing' };
  } finally {
    for (const node of held) {
      node.release();
    }
  }
}
