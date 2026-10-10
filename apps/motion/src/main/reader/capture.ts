import type { Point } from '../drag';
import type { CapturedImage } from './client';

export const contextMargin = 120;

export interface DisplayGeometry {
  readonly id: number;
  readonly bounds: { x: number; y: number; width: number; height: number };
  readonly scaleFactor: number;
}

export interface CaptureRegion {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly point: Point;
}

export interface ScreenImage {
  isEmpty(): boolean;
  getSize(): { width: number; height: number };
  crop(rect: { x: number; y: number; width: number; height: number }): ScreenImage;
  toBitmap(): Buffer;
}

export interface CaptureDependencies {
  display(point: Point): DisplayGeometry;
  screens(size: {
    width: number;
    height: number;
  }): Promise<readonly { displayId: string; image: ScreenImage }[]>;
}

export function physicalSize(display: DisplayGeometry): { width: number; height: number } {
  return {
    width: Math.round(display.bounds.width * display.scaleFactor),
    height: Math.round(display.bounds.height * display.scaleFactor),
  };
}

export function captureRegion(
  dip: Point,
  display: DisplayGeometry,
  reach: number,
  image: { width: number; height: number },
): CaptureRegion | null {
  const scaleX = image.width / display.bounds.width;
  const scaleY = image.height / display.bounds.height;
  const centre = {
    x: Math.round((dip.x - display.bounds.x) * scaleX),
    y: Math.round((dip.y - display.bounds.y) * scaleY),
  };
  if (centre.x < 0 || centre.y < 0 || centre.x >= image.width || centre.y >= image.height) {
    return null;
  }
  const half = Math.round(reach * scaleY);
  const top = Math.max(centre.y - half, 0);
  const bottom = Math.min(centre.y + half, image.height);
  return {
    x: 0,
    y: top,
    width: image.width,
    height: bottom - top,
    point: { x: centre.x, y: centre.y - top },
  };
}

export function createScreenCapture(dependencies: CaptureDependencies) {
  return async (dip: Point, reach: number): Promise<CapturedImage | null> => {
    const display = dependencies.display(dip);
    const sources = await dependencies.screens(physicalSize(display));
    const source =
      sources.find((candidate) => candidate.displayId === String(display.id)) ??
      (sources.length === 1 ? sources[0] : undefined);
    if (!source || source.image.isEmpty()) {
      return null;
    }
    const region = captureRegion(dip, display, reach, source.image.getSize());
    if (!region || region.height === 0) {
      return null;
    }
    const cropped = source.image.crop({
      x: region.x,
      y: region.y,
      width: region.width,
      height: region.height,
    });
    const size = cropped.getSize();
    const bitmap = cropped.toBitmap();
    if (bitmap.length !== size.width * size.height * 4) {
      return null;
    }
    return {
      width: size.width,
      height: size.height,
      pixels: new Uint8Array(bitmap.buffer, bitmap.byteOffset, bitmap.length),
      point: region.point,
    };
  };
}
