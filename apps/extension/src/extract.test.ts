import { beforeEach, describe, expect, it } from 'vitest';
import { extractAt, maxReadingLength, normalizeText, type Box, type Geometry } from './extract';

const point = { x: 50, y: 50 };
const under: Box = { left: 0, top: 40, right: 200, bottom: 60 };
const away: Box = { left: 0, top: 200, right: 200, bottom: 220 };

interface Scene {
  hit: string | null;
  caret?: { selector: string; child?: number };
  boxes?: Box[];
  inline?: string[];
}

function geometryFor(scene: Scene): Geometry {
  const textAt = (selector: string, child = 0): Text => {
    const node = document.querySelector(selector)?.childNodes[child];
    if (!(node instanceof Text)) {
      throw new Error(`no text node in ${selector}`);
    }
    return node;
  };
  return {
    elementAt: () => (scene.hit ? document.querySelector(scene.hit) : null),
    caretAt: () =>
      scene.caret ? { node: textAt(scene.caret.selector, scene.caret.child), offset: 0 } : null,
    boxesOf: () => scene.boxes ?? [under],
    displayOf: (element) =>
      scene.inline?.some((selector) => element.matches(selector)) ? 'inline' : 'block',
  };
}

function render(html: string): void {
  document.body.innerHTML = html;
}

describe('extractAt', () => {
  beforeEach(() => render(''));

  it('reads the whole paragraph around the text under the point', () => {
    render('<p id="p">Sifer reads <b id="b">this</b> sentence.</p>');
    const outcome = extractAt(
      geometryFor({ hit: '#b', caret: { selector: '#b' }, inline: ['#b'] }),
      point,
    );
    expect(outcome).toEqual({
      ok: true,
      reading: {
        source: 'dom',
        kind: 'text',
        control: 'Paragraph',
        text: 'Sifer reads this sentence.',
      },
    });
  });

  it('names headings, list items and links by their role', () => {
    render('<h2 id="h">Latest from our changelog</h2><ul><li id="li">First item</li></ul>');
    expect(extractAt(geometryFor({ hit: '#h', caret: { selector: '#h' } }), point)).toMatchObject({
      reading: { control: 'Heading', text: 'Latest from our changelog' },
    });
    expect(extractAt(geometryFor({ hit: '#li', caret: { selector: '#li' } }), point)).toMatchObject(
      { reading: { control: 'List item', text: 'First item' } },
    );
  });

  it('does not read text that is not under the point', () => {
    render('<div id="card"><p id="p">far away</p></div>');
    expect(
      extractAt(geometryFor({ hit: '#card', caret: { selector: '#p' }, boxes: [away] }), point),
    ).toEqual({ ok: false, reason: 'nothing' });
  });

  it('reads a field with its label', () => {
    render('<label for="city">City</label><input id="city" value="Kigali" />');
    expect(extractAt(geometryFor({ hit: '#city' }), point)).toEqual({
      ok: true,
      reading: { source: 'dom', kind: 'value', control: 'Field', text: 'City: Kigali' },
    });
  });

  it('names an empty field by its placeholder', () => {
    render('<input id="q" placeholder="Search" />');
    expect(extractAt(geometryFor({ hit: '#q' }), point)).toMatchObject({
      reading: { kind: 'name', control: 'Field', text: 'Search' },
    });
  });

  it('reads the chosen option of a select and the state of a checkbox', () => {
    render(
      '<select id="s" aria-label="Country"><option>Kenya</option><option selected>Rwanda</option></select>' +
        '<label><input id="c" type="checkbox" checked /> Remember me</label>',
    );
    expect(extractAt(geometryFor({ hit: '#s' }), point)).toMatchObject({
      reading: { text: 'Country: Rwanda' },
    });
    expect(extractAt(geometryFor({ hit: '#c' }), point)).toMatchObject({
      reading: { control: 'Choice', text: 'Remember me: selected' },
    });
  });

  it('never reads a password field', () => {
    render('<input id="pw" type="password" value="hunter2" />');
    expect(extractAt(geometryFor({ hit: '#pw' }), point)).toEqual({
      ok: false,
      reason: 'protected',
    });
  });

  it('reads a table row with its column headers', () => {
    render(
      '<table><thead><tr><th>Name</th><th>City</th></tr></thead>' +
        '<tbody><tr><td id="n">Ninette</td><td>Kigali</td></tr></tbody></table>',
    );
    expect(extractAt(geometryFor({ hit: '#n', caret: { selector: '#n' } }), point)).toEqual({
      ok: true,
      reading: {
        source: 'dom',
        kind: 'text',
        control: 'Table row',
        text: 'Name: Ninette\nCity: Kigali',
      },
    });
  });

  it('falls back to an accessible name for icons and images', () => {
    render(
      '<button id="btn" aria-label="Close"><svg id="icon"></svg></button><img id="img" alt="Sifer logo" />',
    );
    expect(extractAt(geometryFor({ hit: '#icon' }), point)).toMatchObject({
      reading: { kind: 'name', control: 'Button', text: 'Close' },
    });
    expect(extractAt(geometryFor({ hit: '#img' }), point)).toMatchObject({
      reading: { kind: 'name', text: 'Sifer logo' },
    });
  });

  it('reports nothing for empty space', () => {
    render('<div id="space"></div>');
    expect(extractAt(geometryFor({ hit: '#space' }), point)).toEqual({
      ok: false,
      reason: 'nothing',
    });
    expect(extractAt(geometryFor({ hit: null }), point)).toEqual({ ok: false, reason: 'nothing' });
  });
});

describe('normalizeText', () => {
  it('cleans spacing and caps the length', () => {
    expect(
      normalizeText(`a${String.fromCharCode(160)}b \r\n\n\n\nc${String.fromCharCode(0xfffc)}`),
    ).toBe('a b\n\nc');
    expect(normalizeText('x'.repeat(maxReadingLength + 1))).toHaveLength(maxReadingLength);
  });
});
