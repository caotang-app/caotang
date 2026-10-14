/**
 * Hand a file to the browser's own download path. The object URL is revoked after a
 * tick, so the download has started before the URL goes away. The type defaults to the
 * project bundle's, which is what the first caller sends.
 */
export function downloadBytes(bytes: Uint8Array, filename: string, mime = 'application/zip'): void {
  // `BlobPart` wants a plain ArrayBuffer-backed view; copying keeps the type honest for
  // any Uint8Array a caller passes in.
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const url = URL.createObjectURL(new Blob([copy], { type: mime }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
