import { inflateRawSync } from 'node:zlib';

/**
 * The files of a zip archive, by name, for a test that needs to look inside an EPUB or a bundle. It reads the central
 * directory and then each entry's bytes, stored or deflated, with Node's own inflate. It is a reader for the archives this
 * app writes, not a zip library: a compression method it does not know, or a zip64 archive, is refused rather than guessed.
 */
export function zipEntries(bytes: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();

  // The end-of-central-directory record sits in the last 22 bytes, unless an archive comment follows it.
  let end = -1;
  for (let at = bytes.length - 22; at >= 0 && at >= bytes.length - 22 - 0xffff; at -= 1) {
    if (view.getUint32(at, true) === 0x06054b50) {
      end = at;
      break;
    }
  }
  if (end < 0) throw new Error('not a zip archive: no end-of-central-directory record');

  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const entries = new Map<string, Uint8Array>();
  for (let index = 0; index < count; index += 1) {
    if (view.getUint32(at, true) !== 0x02014b50) throw new Error('not a zip archive: a central directory entry is missing');
    const method = view.getUint16(at + 10, true);
    const compressedSize = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const localOffset = view.getUint32(at + 42, true);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    at += 46 + nameLength + extraLength + commentLength;

    // The local header repeats the name, and carries its own extra field, so its lengths are read again.
    if (view.getUint32(localOffset, true) !== 0x04034b50) throw new Error(`${name} has no local header where the archive says`);
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const data = bytes.subarray(start, start + compressedSize);
    if (method === 0) entries.set(name, data.slice());
    else if (method === 8) entries.set(name, new Uint8Array(inflateRawSync(data)));
    else throw new Error(`${name} is compressed with method ${method}, which this reader does not know`);
  }
  return entries;
}

/** One file of an archive as text, or a thrown error naming the file when the archive does not hold it. */
export function textEntry(entries: Map<string, Uint8Array>, name: string): string {
  const bytes = entries.get(name);
  if (bytes === undefined) throw new Error(`the archive has no ${name}`);
  return new TextDecoder().decode(bytes);
}
