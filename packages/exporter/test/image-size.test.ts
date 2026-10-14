/**
 * The cover's pixel size, read from the header of a PNG, a JPEG or a WebP (the EPUB retail note, epub-metadata.md). The bytes are
 * built here from the published layouts, so each case is one header with a known size, and a cut or foreign header gives none.
 */

import { describe, expect, it } from 'vitest';

import { imageSizeOf } from '../src/image-size.js';

/** A PNG with an IHDR chunk, which is all the size needs. */
function pngOf(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0x00, 0x00, 0x00, 0x0d], 8);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

/** A JPEG: an APP0 segment first, so the parser has to step over one, then the SOF0 frame header that carries the size. */
function jpegOf(width: number, height: number): Uint8Array {
  const app0 = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00];
  const sof0 = [0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
  return Uint8Array.from([0xff, 0xd8, ...app0, ...sof0, 0xff, 0xd9]);
}

/** A WebP RIFF container whose first chunk is `chunk`, with the payload given. The payload is padded to ten bytes, as a real header is. */
function webpOf(chunk: string, payload: readonly number[]): Uint8Array {
  const data = [...payload, ...new Array<number>(Math.max(0, 10 - payload.length)).fill(0)];
  const le32 = (value: number): number[] => [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >>> 24) & 0xff];
  const ascii = (text: string): number[] => [...text].map((char) => char.charCodeAt(0));
  return Uint8Array.from([...ascii('RIFF'), ...le32(4 + 8 + data.length), ...ascii('WEBP'), ...ascii(chunk), ...le32(data.length), ...data]);
}

/** A lossy frame: the frame tag, the start code, then the width and height as 14-bit little-endian numbers. */
function webpVp8(width: number, height: number): Uint8Array {
  return webpOf('VP8 ', [0x00, 0x00, 0x00, 0x9d, 0x01, 0x2a, width & 0xff, width >> 8, height & 0xff, height >> 8]);
}

/** A lossless frame: the signature, then width minus one and height minus one packed into 28 bits, little-endian. */
function webpVp8l(width: number, height: number): Uint8Array {
  const packed = (width - 1) | ((height - 1) << 14);
  return webpOf('VP8L', [0x2f, packed & 0xff, (packed >> 8) & 0xff, (packed >> 16) & 0xff, (packed >>> 24) & 0xff]);
}

/** An extended header: the canvas width and height, each minus one, as 24-bit little-endian numbers. */
function webpVp8x(width: number, height: number): Uint8Array {
  const u24 = (value: number): number[] => [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff];
  return webpOf('VP8X', [0x00, 0x00, 0x00, 0x00, ...u24(width - 1), ...u24(height - 1)]);
}

describe('imageSizeOf: the pixel size from a cover header', () => {
  it('reads a PNG from its IHDR chunk, width first', () => {
    expect(imageSizeOf(pngOf(1600, 2400))).toEqual({ width: 1600, height: 2400 });
  });

  it('reads a JPEG from its frame header, stepping over an APP0 segment', () => {
    expect(imageSizeOf(jpegOf(800, 600))).toEqual({ width: 800, height: 600 });
  });

  it('reads a lossy WebP, a lossless WebP and an extended WebP', () => {
    expect(imageSizeOf(webpVp8(1400, 900))).toEqual({ width: 1400, height: 900 });
    expect(imageSizeOf(webpVp8l(1000, 2000))).toEqual({ width: 1000, height: 2000 });
    expect(imageSizeOf(webpVp8x(3000, 1500))).toEqual({ width: 3000, height: 1500 });
  });

  it('gives no size for bytes that are none of the three formats', () => {
    expect(imageSizeOf(new TextEncoder().encode('not an image at all, just text'))).toBeUndefined();
    expect(imageSizeOf(new Uint8Array())).toBeUndefined();
  });

  it('gives no size for a header cut short, rather than a size read past its end', () => {
    expect(imageSizeOf(pngOf(1600, 2400).subarray(0, 20))).toBeUndefined();
    expect(imageSizeOf(jpegOf(800, 600).subarray(0, 24))).toBeUndefined();
    expect(imageSizeOf(webpVp8(1400, 900).subarray(0, 26))).toBeUndefined();
  });

  it('gives no size for a JPEG whose image data starts before any frame header', () => {
    const scanFirst = Uint8Array.from([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02, 0x00, 0x00, 0x00, 0x00]);
    expect(imageSizeOf(scanFirst)).toBeUndefined();
  });
});
