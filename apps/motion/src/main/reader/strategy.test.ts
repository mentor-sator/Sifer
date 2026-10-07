import { describe, expect, it } from 'vitest';
import {
  controlName,
  maxReadingLength,
  normalizeText,
  readAt,
  type Automation,
  type AutomationNode,
} from './strategy';

interface FakeSpec {
  id: string;
  controlType?: number;
  password?: boolean;
  name?: string;
  text?: string | null;
  value?: string | null;
  parent?: FakeSpec;
}

function automationFor(spec: FakeSpec | null) {
  const released: string[] = [];
  const asked: string[] = [];
  const node = (current: FakeSpec): AutomationNode => ({
    controlType: () => current.controlType ?? 50020,
    isPassword: () => current.password ?? false,
    name: () => current.name ?? '',
    textAt: (point) => {
      asked.push(`${current.id} text ${point.x},${point.y}`);
      return current.text ?? null;
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
  it('reads the paragraph from the nearest ancestor with a text pattern', () => {
    const document = { id: 'document', controlType: 50030, text: 'First line\r\nSecond' };
    const { automation, released } = automationFor({ id: 'leaf', parent: document });
    expect(readAt(automation, point)).toEqual({
      ok: true,
      reading: {
        source: 'accessibility',
        kind: 'text',
        control: 'Document',
        text: 'First line\nSecond',
      },
    });
    expect(released).toEqual(['leaf', 'document']);
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
      parent: { id: 'window', text: 'whole page' },
    });
    expect(readAt(automation, point)).toMatchObject({
      reading: { kind: 'value', control: 'Edit', text: 'search terms' },
    });
    expect(asked).toEqual(['edit value', 'edit text 10,20']);
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
    let chain: FakeSpec = { id: 'top', text: 'too far' };
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
    expect(normalizeText('x'.repeat(maxReadingLength + 5))).toHaveLength(maxReadingLength);
  });
});

describe('controlName', () => {
  it('names known control types and labels the rest', () => {
    expect(controlName(50030)).toBe('Document');
    expect(controlName(1)).toBe('Element');
  });
});
