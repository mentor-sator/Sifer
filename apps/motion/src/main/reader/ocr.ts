import koffi from 'koffi';
import {
  check,
  ComError,
  ComObject,
  comSignatures,
  guid,
  parseGuid,
  pointerOut,
  uintOut,
  using,
} from './com';
import type { OcrLine, OcrWord } from './layout';

const rect = koffi.struct('SiferOcrRect', {
  x: 'float',
  y: 'float',
  width: 'float',
  height: 'float',
});
const plane = koffi.struct('SiferOcrPlane', {
  startIndex: 'int32',
  width: 'int32',
  height: 'int32',
  stride: 'int32',
});

const signatures = {
  create: koffi.proto('__stdcall', 'SiferOcrCreate', 'int32', [
    'void *',
    'int32',
    'int32',
    'int32',
    pointerOut,
  ]),
  withInt: koffi.proto('__stdcall', 'SiferOcrWithInt', 'int32', ['void *', 'int32', pointerOut]),
  withPointer: koffi.proto('__stdcall', 'SiferOcrWithPointer', 'int32', [
    'void *',
    'void *',
    pointerOut,
  ]),
  plane: koffi.proto('__stdcall', 'SiferOcrPlaneOf', 'int32', [
    'void *',
    'int32',
    koffi.out(koffi.pointer(plane)),
  ]),
  bytes: koffi.proto('__stdcall', 'SiferOcrBytes', 'int32', ['void *', pointerOut, uintOut]),
  rect: koffi.proto('__stdcall', 'SiferOcrRectOf', 'int32', [
    'void *',
    koffi.out(koffi.pointer(rect)),
  ]),
};

const slots = {
  engineStatics: { maxImageDimension: 6, fromUserProfile: 10 },
  engine: { recognize: 6 },
  bitmapFactory: { create: 6 },
  bitmap: { lockBuffer: 15 },
  bitmapBuffer: { planeDescription: 7 },
  memoryBuffer: { createReference: 6 },
  byteAccess: { getBuffer: 3 },
  closable: { close: 6 },
  asyncInfo: { status: 7, errorCode: 8, cancel: 9, close: 10 },
  asyncOperation: { results: 8 },
  result: { lines: 6 },
  line: { words: 6 },
  word: { bounds: 6, text: 7 },
  vector: { at: 6, size: 7 },
};

const ids = {
  engineStatics: parseGuid('5bffa85a-3384-3540-9940-699120d428a8'),
  bitmapFactory: parseGuid('c99feb69-2d62-4d47-a6b3-4fdb6a07fdf8'),
  memoryBuffer: parseGuid('fbc4dd2a-245b-11e4-af98-689423260cf8'),
  byteAccess: parseGuid('5b0d3235-4dba-4d44-865e-8f1d0e4fd04d'),
  closable: parseGuid('30d5a829-7fa4-4026-83bb-d75bae4ea99e'),
  asyncInfo: parseGuid('00000036-0000-0000-c000-000000000046'),
};

const classes = {
  engine: 'Windows.Media.Ocr.OcrEngine',
  bitmap: 'Windows.Graphics.Imaging.SoftwareBitmap',
};

const pixelFormatBgra8 = 87;
const bufferAccessWrite = 2;
const asyncStatus = { started: 0, completed: 1 };
const roInitMultithreaded = 1;
const rpcChangedMode = 0x80010106 | 0;
const pollInterval = 4;

export const recognizeDeadline = 2500;

const kernel32 = koffi.load('kernel32.dll');
const moveMemory = kernel32.func(
  'void __stdcall RtlMoveMemory(void *destination, const void *source, size_t length)',
);
const combase = koffi.load('combase.dll');
const roInitialize = combase.func('int32 __stdcall RoInitialize(int32 type)');
const roUninitialize = combase.func('void __stdcall RoUninitialize()');
const windowsCreateString = combase.func('__stdcall', 'WindowsCreateString', 'int32', [
  'str16',
  'uint32',
  pointerOut,
]);
const windowsDeleteString = combase.func('int32 __stdcall WindowsDeleteString(void *text)');
const windowsGetStringRawBuffer = combase.func('__stdcall', 'WindowsGetStringRawBuffer', 'void *', [
  'void *',
  uintOut,
]);
const roGetActivationFactory = combase.func('__stdcall', 'RoGetActivationFactory', 'int32', [
  'void *',
  koffi.pointer(guid),
  pointerOut,
]);

const sleeper = new Int32Array(new SharedArrayBuffer(4));

function sleep(milliseconds: number): void {
  Atomics.wait(sleeper, 0, 0, milliseconds);
}

function takeHString(text: unknown): string {
  if (!text) {
    return '';
  }
  try {
    const length = [0];
    const raw = windowsGetStringRawBuffer(text, length) as unknown;
    const size = length[0] ?? 0;
    return raw && size > 0 ? koffi.decode.string16(raw, size) : '';
  } finally {
    windowsDeleteString(text);
  }
}

function factory(name: string, iid: typeof ids.engineStatics): ComObject {
  const handle: unknown[] = [null];
  check('WindowsCreateString', windowsCreateString(name, name.length, handle) as number);
  try {
    const out: unknown[] = [null];
    check('RoGetActivationFactory', roGetActivationFactory(handle[0], iid, out) as number);
    if (!out[0]) {
      throw new Error(`no activation factory for ${name}`);
    }
    return new ComObject(out[0]);
  } finally {
    windowsDeleteString(handle[0]);
  }
}

function close(target: ComObject): void {
  using(target.query(ids.closable), (closable) =>
    closable.invoke('Close', slots.closable.close, comSignatures.call),
  );
}

function vector<T>(view: ComObject, take: (item: ComObject) => T): T[] {
  const size = view.uint('get_Size', slots.vector.size);
  const items: T[] = [];
  for (let index = 0; index < size; index += 1) {
    const item = view.pointerOut('GetAt', slots.vector.at, signatures.withInt, index);
    const taken = using(item, take);
    if (taken !== null) {
      items.push(taken);
    }
  }
  return items;
}

export interface OcrImage {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8Array;
}

export class OcrUnavailable extends Error {}

export interface TextRecognizer {
  recognize(image: OcrImage): OcrLine[];
  dispose(): void;
}

export function createTextRecognizer(): TextRecognizer {
  const initialized = roInitialize(roInitMultithreaded) as number;
  if (initialized < 0 && initialized !== rpcChangedMode) {
    throw new ComError('RoInitialize', initialized);
  }
  const owns = initialized >= 0;
  const held: ComObject[] = [];
  try {
    const statics = factory(classes.engine, ids.engineStatics);
    held.push(statics);
    const bitmaps = factory(classes.bitmap, ids.bitmapFactory);
    held.push(bitmaps);
    const maxDimension = statics.uint(
      'get_MaxImageDimension',
      slots.engineStatics.maxImageDimension,
    );
    const engine = statics.pointerOut(
      'TryCreateFromUserProfileLanguages',
      slots.engineStatics.fromUserProfile,
      comSignatures.getPointer,
    );
    if (!engine) {
      throw new OcrUnavailable('no ocr language is installed for this user');
    }
    held.push(engine);

    const fill = (bitmap: ComObject, image: OcrImage): void => {
      const buffer = bitmap.pointerOut(
        'LockBuffer',
        slots.bitmap.lockBuffer,
        signatures.withInt,
        bufferAccessWrite,
      );
      using(buffer, (locked) => {
        const description = { startIndex: 0, width: 0, height: 0, stride: 0 };
        locked.invoke(
          'GetPlaneDescription',
          slots.bitmapBuffer.planeDescription,
          signatures.plane,
          0,
          description,
        );
        using(locked.query(ids.memoryBuffer), (memory) =>
          using(
            memory.pointerOut(
              'CreateReference',
              slots.memoryBuffer.createReference,
              comSignatures.getPointer,
            ),
            (reference) => {
              using(reference.query(ids.byteAccess), (access) => {
                const data: unknown[] = [null];
                const capacity = [0];
                access.invoke(
                  'GetBuffer',
                  slots.byteAccess.getBuffer,
                  signatures.bytes,
                  data,
                  capacity,
                );
                const size = description.startIndex + description.stride * image.height;
                if (description.stride < image.width * 4 || size > (capacity[0] ?? 0)) {
                  throw new OcrUnavailable('bitmap buffer is smaller than the image');
                }
                const packed = Buffer.alloc(size);
                const row = image.width * 4;
                for (let y = 0; y < image.height; y += 1) {
                  packed.set(
                    image.pixels.subarray(y * row, (y + 1) * row),
                    description.startIndex + y * description.stride,
                  );
                }
                moveMemory(data[0], packed, size);
              });
              close(reference);
            },
          ),
        );
        close(locked);
      });
    };

    const finished = (operation: ComObject): ComObject | null => {
      return using(operation.query(ids.asyncInfo), (info) => {
        const deadline = Date.now() + recognizeDeadline;
        let status = info.int('get_Status', slots.asyncInfo.status);
        while (status === asyncStatus.started && Date.now() < deadline) {
          sleep(pollInterval);
          status = info.int('get_Status', slots.asyncInfo.status);
        }
        if (status === asyncStatus.started) {
          info.call(slots.asyncInfo.cancel, comSignatures.call);
          info.call(slots.asyncInfo.close, comSignatures.call);
          throw new ComError('RecognizeAsync timed out', 0x800705b4 | 0);
        }
        if (status !== asyncStatus.completed) {
          const code = info.int('get_ErrorCode', slots.asyncInfo.errorCode);
          info.call(slots.asyncInfo.close, comSignatures.call);
          throw new ComError('RecognizeAsync', code);
        }
        const result = operation.pointerOut(
          'GetResults',
          slots.asyncOperation.results,
          comSignatures.getPointer,
        );
        info.call(slots.asyncInfo.close, comSignatures.call);
        return result;
      });
    };

    const word = (item: ComObject): OcrWord => {
      const bounds = { x: 0, y: 0, width: 0, height: 0 };
      item.invoke('get_BoundingRect', slots.word.bounds, signatures.rect, bounds);
      const text = takeHString(
        item.rawPointer('get_Text', slots.word.text, comSignatures.getPointer),
      );
      return { text, bounds };
    };

    return {
      recognize(image: OcrImage): OcrLine[] {
        if (image.width > maxDimension || image.height > maxDimension) {
          throw new OcrUnavailable('image is larger than the ocr engine accepts');
        }
        const bitmap = bitmaps.pointerOut(
          'SoftwareBitmap.Create',
          slots.bitmapFactory.create,
          signatures.create,
          pixelFormatBgra8,
          image.width,
          image.height,
        );
        return (
          using(bitmap, (created) => {
            fill(created, image);
            const operation = engine.pointerOut(
              'RecognizeAsync',
              slots.engine.recognize,
              signatures.withPointer,
              created.pointer,
            );
            const lines =
              using(operation, (pending) =>
                using(finished(pending), (result) =>
                  using(
                    result.pointerOut('get_Lines', slots.result.lines, comSignatures.getPointer),
                    (view) =>
                      vector(view, (line) => ({
                        words:
                          using(
                            line.pointerOut(
                              'get_Words',
                              slots.line.words,
                              comSignatures.getPointer,
                            ),
                            (words) => vector(words, word),
                          ) ?? [],
                      })),
                  ),
                ),
              ) ?? [];
            close(created);
            return lines;
          }) ?? []
        );
      },
      dispose(): void {
        for (const object of held.reverse()) {
          object.release();
        }
        if (owns) {
          roUninitialize();
        }
      },
    };
  } catch (error) {
    for (const object of held.reverse()) {
      object.release();
    }
    if (owns) {
      roUninitialize();
    }
    throw error;
  }
}
