// @vitest-environment jsdom
/**
 * A flush needs the body, and only the body. This file counts the offset map's
 * builds: a keystroke and the write it leads to must build none, and the first offset-based
 * call after the edit must build exactly one.
 *
 * The count is taken by wrapping `buildProjectionMap` where the adapter imports it, which is
 * why this is its own file: the mock applies to every import of the seam in the file.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAutosave } from '@caotang/store';
import type { Autosave, DocumentWriter } from '@caotang/store';
import * as seam from '../src/seam.js';
import type * as SeamModule from '../src/seam.js';
import { focusDom, mountInto, selectDom, textNodeWith, tiptapOf } from './tiptap-harness.js';

vi.mock('../src/seam.js', async () => {
  const actual = await vi.importActual<typeof SeamModule>('../src/seam.js');
  return { ...actual, buildProjectionMap: vi.fn(actual.buildProjectionMap) };
});

/** Enough paragraphs that a map build is real work, not a rounding error in a count. */
const LONG_BODY = Array.from({ length: 60 }, (_, i) => `Paragraph ${i} with some _emphasis_ and **strong**.`).join('\n\n') + '\n';

let autosave: Autosave | null = null;
afterEach(() => {
  autosave?.dispose();
  autosave = null;
  vi.useRealTimers();
});

describe('a flush builds no offset map', () => {
  it('a keystroke and the write it leads to serialize the body and build no map', async () => {
    vi.useFakeTimers();
    const write = vi.fn<DocumentWriter>(async (request) => ({ revision: request.expectedRevision + 1, changed: true }));
    autosave = createAutosave({ projectId: 'project-1', source: 'write', write });
    const built = vi.mocked(seam.buildProjectionMap);
    built.mockClear();

    const { host, instance } = await mountInto(LONG_BODY, { revision: 4, autosave });
    tiptapOf(focusDom(host)).commands.insertContent('Hi ');
    vi.advanceTimersByTime(800);
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0]![0].body.startsWith('Hi Paragraph 0')).toBe(true);
    expect(built).not.toHaveBeenCalled();

    // The offset path is the one that builds it, once for the document state it is asked about.
    selectDom(host, textNodeWith(focusDom(host), 'emphasis'), 0, 4);
    expect(instance.getSelection()).not.toBeNull();
    expect(built).toHaveBeenCalledTimes(1);
    instance.getSelection();
    expect(built).toHaveBeenCalledTimes(1);
  });
});
