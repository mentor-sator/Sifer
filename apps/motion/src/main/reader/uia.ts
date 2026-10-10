import koffi from 'koffi';
import type { Point } from '../drag';
import {
  check,
  ComError,
  ComObject,
  comSignatures,
  guid,
  intOut,
  parseGuid,
  pointerOut,
  using,
  type Guid,
} from './com';
import {
  covers,
  maxReadingLength,
  type Automation,
  type AutomationNode,
  type ScreenRect,
  type TextHit,
} from './strategy';

const point = koffi.struct('SiferUiaPoint', { x: 'int32', y: 'int32' });

const signatures = {
  getPointer: comSignatures.getPointer,
  atPoint: koffi.proto('__stdcall', 'SiferUiaAtPoint', 'int32', ['void *', point, pointerOut]),
  parentOf: koffi.proto('__stdcall', 'SiferUiaParentOf', 'int32', ['void *', 'void *', pointerOut]),
  patternAs: koffi.proto('__stdcall', 'SiferUiaPatternAs', 'int32', [
    'void *',
    'int32',
    koffi.pointer(guid),
    pointerOut,
  ]),
  expand: koffi.proto('__stdcall', 'SiferUiaExpand', 'int32', ['void *', 'int32']),
  getText: koffi.proto('__stdcall', 'SiferUiaGetText', 'int32', ['void *', 'int32', pointerOut]),
};

const slots = {
  automation: { elementFromPoint: 7, controlViewWalker: 14 },
  walker: { parent: 3 },
  element: { patternAs: 14, controlType: 21, name: 23, isPassword: 35 },
  textPattern: { rangeFromPoint: 3, rangeFromChild: 4 },
  textRange: { expand: 6, boundingRectangles: 10, getText: 12 },
  valuePattern: { value: 4 },
};

const patterns = { value: 10002, text: 10014 };
const textUnit = { line: 3, paragraph: 4 };
const invalidArgument = 0x80070057 | 0;
const clsctxInprocServer = 1;
const coinitMultithreaded = 0;
const rpcChangedMode = 0x80010106 | 0;

const ids = {
  cuiAutomation: parseGuid('ff48dba4-60ef-4201-aa87-54103eef594e'),
  iuiAutomation: parseGuid('30cbe57d-d9d0-452a-ab13-7ac5ac4825ee'),
  textPattern: parseGuid('32eba289-3583-42c9-9c59-3b6d9a1e9b6a'),
  valuePattern: parseGuid('a94cd8b1-0844-4cd6-9d2d-640537ab39e9'),
};

const ole32 = koffi.load('ole32.dll');
const oleaut32 = koffi.load('oleaut32.dll');
const coInitializeEx = ole32.func('int32 __stdcall CoInitializeEx(void *reserved, uint32 mode)');
const coUninitialize = ole32.func('void __stdcall CoUninitialize()');
const coCreateInstance = ole32.func('__stdcall', 'CoCreateInstance', 'int32', [
  koffi.pointer(guid),
  'void *',
  'uint32',
  koffi.pointer(guid),
  pointerOut,
]);
const safeArrayGetLBound = oleaut32.func('__stdcall', 'SafeArrayGetLBound', 'int32', [
  'void *',
  'uint32',
  intOut,
]);
const safeArrayGetUBound = oleaut32.func('__stdcall', 'SafeArrayGetUBound', 'int32', [
  'void *',
  'uint32',
  intOut,
]);
const safeArrayAccessData = oleaut32.func('__stdcall', 'SafeArrayAccessData', 'int32', [
  'void *',
  pointerOut,
]);
const safeArrayUnaccessData = oleaut32.func('int32 __stdcall SafeArrayUnaccessData(void *array)');
const safeArrayDestroy = oleaut32.func('int32 __stdcall SafeArrayDestroy(void *array)');

function takeRects(array: unknown): ScreenRect[] {
  try {
    const lower = [0];
    const upper = [0];
    check('SafeArrayGetLBound', safeArrayGetLBound(array, 1, lower) as number);
    check('SafeArrayGetUBound', safeArrayGetUBound(array, 1, upper) as number);
    const count = (upper[0] ?? -1) - (lower[0] ?? 0) + 1;
    if (count < 4) {
      return [];
    }
    const data: unknown[] = [null];
    check('SafeArrayAccessData', safeArrayAccessData(array, data) as number);
    try {
      const values = koffi.decode(data[0], 'double', count) as Float64Array;
      const rects: ScreenRect[] = [];
      for (let index = 0; index + 3 < values.length; index += 4) {
        rects.push({
          x: values[index] ?? 0,
          y: values[index + 1] ?? 0,
          width: values[index + 2] ?? 0,
          height: values[index + 3] ?? 0,
        });
      }
      return rects;
    } finally {
      safeArrayUnaccessData(array);
    }
  } finally {
    safeArrayDestroy(array);
  }
}

function expand(range: ComObject, unit: number): void {
  check('ExpandToEnclosingUnit', range.call(slots.textRange.expand, signatures.expand, unit));
}

function rectsOf(range: ComObject): ScreenRect[] {
  const out: unknown[] = [null];
  check(
    'GetBoundingRectangles',
    range.call(slots.textRange.boundingRectangles, signatures.getPointer, out),
  );
  return out[0] ? takeRects(out[0]) : [];
}

function textOf(range: ComObject): string {
  return (
    range.string('GetText', slots.textRange.getText, signatures.getText, maxReadingLength) ?? ''
  );
}

class UiaNode implements AutomationNode {
  readonly #element: ComObject;
  readonly #walker: ComObject;

  constructor(element: ComObject, walker: ComObject) {
    this.#element = element;
    this.#walker = walker;
  }

  controlType(): number {
    return this.#element.int('get_CurrentControlType', slots.element.controlType);
  }

  isPassword(): boolean {
    return this.#element.int('get_CurrentIsPassword', slots.element.isPassword) !== 0;
  }

  name(): string {
    return this.#element.string('get_CurrentName', slots.element.name, signatures.getPointer) ?? '';
  }

  textAt(at: Point): TextHit | null {
    return using(this.#pattern(patterns.text, ids.textPattern), (pattern) =>
      using(
        pattern.pointerOut(
          'RangeFromPoint',
          slots.textPattern.rangeFromPoint,
          signatures.atPoint,
          at,
        ),
        (range) => {
          expand(range, textUnit.line);
          const bounds = rectsOf(range);
          if (!covers(bounds, at)) {
            return { text: '', bounds };
          }
          expand(range, textUnit.paragraph);
          return { text: textOf(range), bounds };
        },
      ),
    );
  }

  textOf(child: AutomationNode): TextHit | null {
    if (!(child instanceof UiaNode)) {
      return null;
    }
    return using(this.#pattern(patterns.text, ids.textPattern), (pattern) => {
      let range: ComObject | null;
      try {
        range = pattern.pointerOut(
          'RangeFromChild',
          slots.textPattern.rangeFromChild,
          signatures.parentOf,
          child.#element.pointer,
        );
      } catch (error) {
        if (error instanceof ComError && error.hresult === invalidArgument) {
          return { text: '', bounds: [] };
        }
        throw error;
      }
      return (
        using(range, (found) => ({ text: textOf(found), bounds: rectsOf(found) })) ?? {
          text: '',
          bounds: [],
        }
      );
    });
  }

  value(): string | null {
    return using(this.#pattern(patterns.value, ids.valuePattern), (pattern) =>
      pattern.string('get_CurrentValue', slots.valuePattern.value, signatures.getPointer),
    );
  }

  parent(): AutomationNode | null {
    const parent = this.#walker.pointerOut(
      'GetParentElement',
      slots.walker.parent,
      signatures.parentOf,
      this.#element.pointer,
    );
    return parent ? new UiaNode(parent, this.#walker) : null;
  }

  release(): void {
    this.#element.release();
  }

  #pattern(id: number, iid: Guid): ComObject | null {
    return this.#element.pointerOut(
      'GetCurrentPatternAs',
      slots.element.patternAs,
      signatures.patternAs,
      id,
      iid,
    );
  }
}

export interface UiAutomation extends Automation {
  dispose(): void;
}

export function createUiAutomation(): UiAutomation {
  const initialized = coInitializeEx(null, coinitMultithreaded) as number;
  if (initialized < 0 && initialized !== rpcChangedMode) {
    throw new ComError('CoInitializeEx', initialized);
  }
  const owns = initialized >= 0;
  try {
    const out: unknown[] = [null];
    check(
      'CoCreateInstance',
      coCreateInstance(
        ids.cuiAutomation,
        null,
        clsctxInprocServer,
        ids.iuiAutomation,
        out,
      ) as number,
    );
    const automation = new ComObject(out[0]);
    const walker = automation.pointerOut(
      'get_ControlViewWalker',
      slots.automation.controlViewWalker,
      signatures.getPointer,
    );
    if (!walker) {
      automation.release();
      throw new Error('ui automation returned no tree walker');
    }
    return {
      elementAt(at: Point): AutomationNode | null {
        const element = automation.pointerOut(
          'ElementFromPoint',
          slots.automation.elementFromPoint,
          signatures.atPoint,
          at,
        );
        return element ? new UiaNode(element, walker) : null;
      },
      dispose(): void {
        walker.release();
        automation.release();
        if (owns) {
          coUninitialize();
        }
      },
    };
  } catch (error) {
    if (owns) {
      coUninitialize();
    }
    throw error;
  }
}
