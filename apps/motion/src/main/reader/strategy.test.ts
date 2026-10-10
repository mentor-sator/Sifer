import { describe, expect, it } from 'vitest';
import {
  controlName,
  covers,
  maxReadingLength,
  normalizeText,
  readAt,
  type Automation,
  type AutomationNode,
  type ScreenRect,
} from './strategy';

interface FakeSpec {
  id: string;
  controlType?: number;
  password?: boolean;
  name?: string;
  text?: string;
  childText?: string;
  value?: string | null;
  bounds?: ScreenRect[];
  parent?: FakeSpec;
}

const around: ScreenRect[] = [{ x: 0, y: 0, width: 100, height: 100 }];
const elsewhere: ScreenRect[] = [{ x: 300, y: 300, width: 200, height: 40 }];

function automationFor(spec: FakeSpec | null) {
  const released: string[] = [];
  const asked: string[] = [];
  const node = (current: FakeSpec): AutomationNode & { id: string } => ({
    id: current.id,
    controlType: () => current.controlType ?? 50020,
    isPassword: () => current.password ?? false,
    name: () => current.name ?? '',
    textAt: (point) => {
      asked.push(`${current.id} text at ${point.x},${point.y}`);
      return current.text === undefined
        ? null
        : { text: current.text, bounds: current.bounds ?? around };
    },
    textOf: (child) => {
      asked.push(`${current.id} text of ${(child as AutomationNode & { id: string }).id}`);
      return current.childText === undefined
        ? null
        : { text: current.childText, bounds: current.bounds ?? around };
    },
    value: () => {
      asked.push(`${current.id} value`);
      return current.value ?? null;
    },
    parent: () => (current.parent ? node(current.parent) : null),
    release: () => released.push(current.id),
  });
  const automation: Automation = { elementAt: () => (spec ? node(spec) : null) };
  return { automation, released, asked };
}

const point = { x: 10, y: 20 };

describe('readAt', () => {
  it('reads the paragraph under the point when the element holds the text', () => {
    const { automation, released, asked } = automationFor({
      id: 'document',
      controlType: 50030,
      text: 'First line\r\nSecond',
    });
    expect(readAt(automation, point)).toEqual({
      ok: true,
      reading: {
        source: 'accessibility',
        kind: 'text',
        control: 'Document',
        text: 'First line\nSecond',
      },
    });
    expect(asked).toEqual(['document value', 'document text at 10,20']);
    expect(released).toEqual(['document']);
  });

  it('reads exactly the element under the point through its text container', () => {
    const { automation, asked, released } = automationFor({
      id: 'heading',
      parent: { id: 'document', controlType: 50030, childText: 'Latest from our changelog' },
    });
    expect(readAt(automation, point)).toMatchObject({
      reading: { kind: 'text', control: 'Document', text: 'Latest from our changelog' },
    });
    expect(asked).toEqual(['heading text at 10,20', 'document text of heading']);
    expect(released).toEqual(['heading', 'document']);
  });

  it('ignores text that does not lie under the point', () => {
    const { automation } = automationFor({
      id: 'heading',
      name: 'Softaculous Apps Installer',
      parent: { id: 'document', childText: 'cookie banner text', bounds: elsewhere },
    });
    expect(readAt(automation, point)).toMatchObject({
      reading: { kind: 'name', text: 'Softaculous Apps Installer' },
    });
  });

  it('asks only the nearest text container', () => {
    const { automation, asked } = automationFor({
      id: 'gap',
      parent: {
        id: 'card',
        childText: 'far away',
        bounds: elsewhere,
        parent: { id: 'document', childText: 'whole page' },
      },
    });
    expect(readAt(automation, point)).toEqual({ ok: false, reason: 'nothing' });
    expect(asked).not.toContain('document text of gap');
  });

  it('ignores text with no bounds at all', () => {
    const { automation } = automationFor({ id: 'leaf', text: 'hidden', bounds: [] });
    expect(readAt(automation, point)).toEqual({ ok: false, reason: 'nothing' });
  });

  it('prefers the text under the point over the field value', () => {
    const { automation } = automationFor({ id: 'edit', controlType: 50004, text: 'a', value: 'b' });
    expect(readAt(automation, point)).toMatchObject({ reading: { kind: 'text', text: 'a' } });
  });

  it('reads a field value when the field has no text pattern', () => {
    const { automation, asked } = automationFor({
      id: 'edit',
      controlType: 50004,
      value: 'search terms',
      parent: { id: 'window', childText: 'whole page' },
    });
    expect(readAt(automation, point)).toMatchObject({
      reading: { kind: 'value', control: 'Edit', text: 'search terms' },
    });
    expect(asked).toEqual(['edit value', 'edit text at 10,20']);
  });

  it('reads the name, not the value, of a list or tree entry', () => {
    const { automation, asked } = automationFor({
      id: 'site',
      controlType: 50024,
      name: 'wiredin@192.168.1.10',
      value: '0',
    });
    expect(readAt(automation, point)).toMatchObject({
      reading: { kind: 'name', control: 'Tree item', text: 'wiredin@192.168.1.10' },
    });
    expect(asked).not.toContain('site value');
  });

  it('ignores a container whose only rectangle is an embedded video or image', () => {
    const { automation } = automationFor({
      id: 'video',
      parent: {
        id: 'document',
        childText: 'Episodes Audio & Subtitles Full screen',
        bounds: [{ x: 0, y: 0, width: 1900, height: 900 }],
      },
    });
    expect(readAt(automation, point)).toEqual({ ok: false, reason: 'nothing' });
  });

  it('never reads a password field', () => {
    const { automation, asked, released } = automationFor({
      id: 'secret',
      password: true,
      value: 'hunter2',
    });
    expect(readAt(automation, point)).toEqual({ ok: false, reason: 'protected' });
    expect(asked).toEqual([]);
    expect(released).toEqual(['secret']);
  });

  it('stops when an ancestor is a password field', () => {
    const { automation } = automationFor({ id: 'inner', parent: { id: 'outer', password: true } });
    expect(readAt(automation, point)).toEqual({ ok: false, reason: 'protected' });
  });

  it('falls back to the element name', () => {
    const { automation } = automationFor({ id: 'button', controlType: 50000, name: ' Save ' });
    expect(readAt(automation, point)).toMatchObject({
      reading: { kind: 'name', control: 'Button', text: 'Save' },
    });
  });

  it('reports nothing for an empty spot', () => {
    expect(readAt(automationFor(null).automation, point)).toEqual({
      ok: false,
      reason: 'nothing',
    });
    expect(readAt(automationFor({ id: 'blank', text: '   ' }).automation, point)).toEqual({
      ok: false,
      reason: 'nothing',
    });
  });

  it('releases every element it touched when a call throws', () => {
    const { automation, released } = automationFor({ id: 'leaf', parent: { id: 'parent' } });
    const throwing: Automation = {
      elementAt: (at) => {
        const found = automation.elementAt(at);
        return (
          found && {
            ...found,
            name: () => {
              throw new Error('gone');
            },
          }
        );
      },
    };
    expect(() => readAt(throwing, point)).toThrow('gone');
    expect(released).toEqual(['leaf', 'parent']);
  });

  it('climbs a bounded number of ancestors', () => {
    let chain: FakeSpec = { id: 'top', childText: 'too far' };
    for (let depth = 0; depth < 20; depth += 1) {
      chain = { id: `level${depth}`, parent: chain };
    }
    const { automation, released } = automationFor(chain);
    expect(readAt(automation, point)).toEqual({ ok: false, reason: 'nothing' });
    expect(released).toHaveLength(11);
  });
});

describe('normalizeText', () => {
  it('unifies line endings, spaces and length', () => {
    expect(normalizeText(`${String.fromCharCode(160)}a\rb\r\nc `)).toBe('a\nb\nc');
    expect(normalizeText(`end.${String.fromCharCode(0xfffc)}`)).toBe('end.');
    expect(normalizeText('x'.repeat(maxReadingLength + 5))).toHaveLength(maxReadingLength);
  });
});

describe('controlName', () => {
  it('names known control types and labels the rest', () => {
    expect(controlName(50030)).toBe('Document');
    expect(controlName(1)).toBe('Element');
  });
});

describe('covers', () => {
  const line = [{ x: 100, y: 200, width: 300, height: 20 }];

  it('accepts a point inside any rectangle, with a small tolerance', () => {
    expect(covers(line, { x: 250, y: 210 })).toBe(true);
    expect(covers(line, { x: 97, y: 223 })).toBe(true);
    expect(covers([{ x: 0, y: 0, width: 1, height: 1 }, ...line], { x: 399, y: 219 })).toBe(true);
  });

  it('rejects a point beyond the tolerance', () => {
    expect(covers(line, { x: 95, y: 210 })).toBe(false);
    expect(covers(line, { x: 250, y: 226 })).toBe(false);
    expect(covers([], { x: 0, y: 0 })).toBe(false);
  });

  it('rejects rectangles taller than a line of text', () => {
    expect(covers([{ x: 0, y: 0, width: 1900, height: 900 }], { x: 400, y: 400 })).toBe(false);
  });
});
