import type { ReadingKind, ReadOutcome } from '../../shared/bridge';
import type { Point } from '../drag';

export const maxReadingLength = 20_000;
export const maxAncestors = 10;
export const boundsTolerance = 4;

export interface ScreenRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface TextHit {
  readonly text: string;
  readonly bounds: readonly ScreenRect[];
}

export interface AutomationNode {
  controlType(): number;
  isPassword(): boolean;
  name(): string;
  textAt(point: Point): TextHit | null;
  textOf(child: AutomationNode): TextHit | null;
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
const objectReplacement = String.fromCharCode(0xfffc);

export function normalizeText(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .replaceAll(noBreakSpace, ' ')
    .replaceAll(objectReplacement, '')
    .trim()
    .slice(0, maxReadingLength);
}

export function covers(
  bounds: readonly ScreenRect[],
  point: Point,
  tolerance = boundsTolerance,
): boolean {
  return bounds.some(
    (rect) =>
      point.x >= rect.x - tolerance &&
      point.x <= rect.x + rect.width + tolerance &&
      point.y >= rect.y - tolerance &&
      point.y <= rect.y + rect.height + tolerance,
  );
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
    let container = false;
    let node: AutomationNode | null = target;
    for (let depth = 0; node && depth <= maxAncestors; depth += 1) {
      if (node.isPassword()) {
        return { ok: false, reason: 'protected' };
      }
      if (!container) {
        const hit = depth === 0 ? node.textAt(point) : node.textOf(target);
        container = hit !== null;
        const text = hit && covers(hit.bounds, point) ? found('text', node, hit.text) : null;
        if (text) {
          return text;
        }
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
