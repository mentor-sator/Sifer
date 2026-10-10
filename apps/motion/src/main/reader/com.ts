import koffi, { type TypeObject } from 'koffi';

export const guid = koffi.struct('SiferComGuid', {
  data1: 'uint32',
  data2: 'uint16',
  data3: 'uint16',
  data4: koffi.array('uint8', 8),
});

export const pointerOut = koffi.out(koffi.pointer('void *'));
export const intOut = koffi.out(koffi.pointer('int32'));
export const uintOut = koffi.out(koffi.pointer('uint32'));

export const comSignatures = {
  call: koffi.proto('__stdcall', 'SiferComCall', 'int32', ['void *']),
  release: koffi.proto('__stdcall', 'SiferComRelease', 'uint32', ['void *']),
  queryInterface: koffi.proto('__stdcall', 'SiferComQuery', 'int32', [
    'void *',
    koffi.pointer(guid),
    pointerOut,
  ]),
  getPointer: koffi.proto('__stdcall', 'SiferComGetPointer', 'int32', ['void *', pointerOut]),
  getInt: koffi.proto('__stdcall', 'SiferComGetInt', 'int32', ['void *', intOut]),
  getUint: koffi.proto('__stdcall', 'SiferComGetUint', 'int32', ['void *', uintOut]),
};

const comSlots = { queryInterface: 0, release: 2 };

export type Guid = { data1: number; data2: number; data3: number; data4: number[] };

export function parseGuid(text: string): Guid {
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

export class ComError extends Error {
  constructor(
    readonly operation: string,
    readonly hresult: number,
  ) {
    super(`${operation} failed with 0x${(hresult >>> 0).toString(16).padStart(8, '0')}`);
  }
}

export function check(operation: string, hresult: number): void {
  if (hresult < 0) {
    throw new ComError(operation, hresult);
  }
}

const oleaut32 = koffi.load('oleaut32.dll');
const sysStringLen = oleaut32.func('uint32 __stdcall SysStringLen(void *text)');
const sysFreeString = oleaut32.func('void __stdcall SysFreeString(void *text)');

export function takeBstr(text: unknown): string {
  try {
    const length = sysStringLen(text) as number;
    return length > 0 ? koffi.decode.string16(text, length) : '';
  } finally {
    sysFreeString(text);
  }
}

export class ComObject {
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

  invoke(operation: string, slot: number, signature: TypeObject, ...args: unknown[]): void {
    check(operation, this.call(slot, signature, ...args));
  }

  pointerOut(operation: string, slot: number, signature: TypeObject, ...args: unknown[]) {
    const out: unknown[] = [null];
    check(operation, this.call(slot, signature, ...args, out));
    return out[0] ? new ComObject(out[0]) : null;
  }

  rawPointer(operation: string, slot: number, signature: TypeObject, ...args: unknown[]): unknown {
    const out: unknown[] = [null];
    check(operation, this.call(slot, signature, ...args, out));
    return out[0] ?? null;
  }

  string(operation: string, slot: number, signature: TypeObject, ...args: unknown[]) {
    const text = this.rawPointer(operation, slot, signature, ...args);
    return text ? takeBstr(text) : null;
  }

  int(operation: string, slot: number): number {
    const out = [0];
    check(operation, this.call(slot, comSignatures.getInt, out));
    return out[0] ?? 0;
  }

  uint(operation: string, slot: number): number {
    const out = [0];
    check(operation, this.call(slot, comSignatures.getUint, out));
    return out[0] ?? 0;
  }

  query(iid: Guid): ComObject {
    const found = this.pointerOut(
      'QueryInterface',
      comSlots.queryInterface,
      comSignatures.queryInterface,
      iid,
    );
    if (!found) {
      throw new Error('QueryInterface returned nothing');
    }
    return found;
  }

  release(): void {
    if (this.#pointer !== null) {
      this.call(comSlots.release, comSignatures.release);
      this.#pointer = null;
    }
  }
}

export function using<T>(value: ComObject | null, use: (value: ComObject) => T): T | null {
  if (!value) {
    return null;
  }
  try {
    return use(value);
  } finally {
    value.release();
  }
}
