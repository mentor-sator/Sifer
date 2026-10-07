import koffi, { type TypeObject } from 'koffi';
import type { Point } from '../drag';
import { maxReadingLength, type Automation, type AutomationNode } from './strategy';

const point = koffi.struct('SiferUiaPoint', { x: 'int32', y: 'int32' });
const guid = koffi.struct('SiferUiaGuid', {
  data1: 'uint32',
  data2: 'uint16',
  data3: 'uint16',
  data4: koffi.array('uint8', 8),
});

const pointerOut = koffi.out(koffi.pointer('void *'));
const intOut = koffi.out(koffi.pointer('int32'));

const signatures = {
  release: koffi.proto('__stdcall', 'SiferUiaRelease', 'uint32', ['void *']),
  getPointer: koffi.proto('__stdcall', 'SiferUiaGetPointer', 'int32', ['void *', pointerOut]),
  getInt: koffi.proto('__stdcall', 'SiferUiaGetInt', 'int32', ['void *', intOut]),
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
  release: 2,
  automation: { elementFromPoint: 7, controlViewWalker: 14 },
  walker: { parent: 3 },
  element: { patternAs: 14, controlType: 21, name: 23, isPassword: 35 },
  textPattern: { rangeFromPoint: 3 },
  textRange: { expand: 6, getText: 12 },
  valuePattern: { value: 4 },
};

const patterns = { value: 10002, text: 10014 };
const textUnitParagraph = 4;
const clsctxInprocServer = 1;
const coinitMultithreaded = 0;
const rpcChangedMode = 0x80010106 | 0;

type Guid = { data1: number; data2: number; data3: number; data4: number[] };

function parseGuid(text: string): Guid {
  const hex = text.replace(/-/g, '');
  return {
    data1: Number.parseInt(hex.slice(0, 8), 16),
    data2: Number.parseInt(hex.slice(8, 12), 16),
    data3: Number.parseInt(hex.slice(12, 16), 16),
    data4: Array.from({ length: 8 }, (_, index) =>
      Number.parseInt(hex.slice(16 + index * 2, 18 + index * 2), 16),
    ),
  };
}

const ids = {
  cuiAutomation: parseGuid('ff48dba4-60ef-4201-aa87-54103eef594e'),
  iuiAutomation: parseGuid('30cbe57d-d9d0-452a-ab13-7ac5ac4825ee'),
  textPattern: parseGuid('32eba289-3583-42c9-9c59-3b6d9a1e9b6a'),
  valuePattern: parseGuid('a94cd8b1-0844-4cd6-9d2d-640537ab39e9'),
};

export class ComError extends Error {
  constructor(
    readonly operation: string,
    readonly hresult: number,
  ) {
    super(`${operation} failed with 0x${(hresult >>> 0).toString(16).padStart(8, '0')}`);
  }
}

function check(operation: string, hresult: number): void {
  if (hresult < 0) {
    throw new ComError(operation, hresult);
  }
}

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
const sysStringLen = oleaut32.func('uint32 __stdcall SysStringLen(void *text)');
const sysFreeString = oleaut32.func('void __stdcall SysFreeString(void *text)');

class ComObject {
  #pointer: unknown;

  constructor(pointer: unknown) {
    this.#pointer = pointer;
  }

  get pointer(): unknown {
    if (this.#pointer === null) {
      throw new Error('com object already released');
    }
    return this.#pointer;
  }

  call(slot: number, signature: TypeObject, ...args: unknown[]): number {
    const self = this.pointer;
    const table = koffi.decode(self, 'void *') as unknown;
    const method = koffi.decode(table, slot * koffi.sizeof('void *'), 'void *') as unknown;
    return koffi.call(method, signature, self, ...args) as number;
  }

  pointerOut(operation: string, slot: number, signature: TypeObject, ...args: unknown[]) {
    const out: unknown[] = [null];
    check(operation, this.call(slot, signature, ...args, out));
    return out[0] ? new ComObject(out[0]) : null;
  }

  string(operation: string, slot: number, signature: TypeObject, ...args: unknown[]) {
    const out: unknown[] = [null];
    check(operation, this.call(slot, signature, ...args, out));
    return out[0] ? takeString(out[0]) : null;
  }

  int(operation: string, slot: number): number {
    const out = [0];
    check(operation, this.call(slot, signatures.getInt, out));
    return out[0] ?? 0;
  }

  release(): void {
    if (this.#pointer !== null) {
      this.call(slots.release, signatures.release);
      this.#pointer = null;
    }
  }
}

function takeString(text: unknown): string {
  try {
    const length = sysStringLen(text) as number;
    return length > 0 ? (koffi.decode.string16(text, length) as string) : '';
  } finally {
    sysFreeString(text);
  }
}

function using<T>(value: ComObject | null, use: (value: ComObject) => T): T | null {
  if (!value) {
    return null;
  }
  try {
    return use(value);
  } finally {
    value.release();
  }
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

  textAt(at: Point): string | null {
    return using(this.#pattern(patterns.text, ids.textPattern), (pattern) =>
      using(
        pattern.pointerOut(
          'RangeFromPoint',
          slots.textPattern.rangeFromPoint,
          signatures.atPoint,
          at,
        ),
        (range) => {
          check(
            'ExpandToEnclosingUnit',
            range.call(slots.textRange.expand, signatures.expand, textUnitParagraph),
          );
          return range.string(
            'GetText',
            slots.textRange.getText,
            signatures.getText,
            maxReadingLength,
          );
        },
      ),
    );
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
