import koffi from 'koffi';

const kernel32 = koffi.load('kernel32.dll');

const openProcess = kernel32.func(
  'void * __stdcall OpenProcess(uint32 access, int32 inherit, uint32 processId)',
);
const queryFullProcessImageName = kernel32.func(
  '__stdcall',
  'QueryFullProcessImageNameW',
  'int32',
  ['void *', 'uint32', 'void *', koffi.inout(koffi.pointer('uint32'))],
);
const closeHandle = kernel32.func('int32 __stdcall CloseHandle(void *handle)');

const queryLimitedInformation = 0x1000;
const maxPath = 32_768;

export function processName(processId: number): string | null {
  if (processId <= 0) {
    return null;
  }
  const handle = openProcess(queryLimitedInformation, 0, processId) as unknown;
  if (!handle) {
    return null;
  }
  try {
    const buffer = Buffer.alloc(maxPath * 2);
    const size = [maxPath];
    if (!queryFullProcessImageName(handle, 0, buffer, size)) {
      return null;
    }
    const path = buffer.toString('utf16le', 0, (size[0] ?? 0) * 2);
    return path.slice(path.lastIndexOf('\\') + 1).toLowerCase();
  } finally {
    closeHandle(handle);
  }
}
