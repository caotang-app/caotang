/**
 * The six vendor templates: the closed set, the exact mapping for one fixed shot per vendor, and the
 * duration sets the D3 evidence gives. A template that maps the wrong key, or accepts a duration the
 * vendor refuses, fails here.
 */
import { describe, expect, it } from 'vitest';

import {
  VIDEO_TEMPLATES,
  VIDEO_TEMPLATE_IDS,
  templateById,
  type ResolvedReference,
  type VideoShotRef,
} from '../src/index.js';

import { refFor } from './fixtures.js';

const PROMPT = { camera: 'Slow dolly-in', subject: 'Elena', action: 'walks down the quay', context: 'Harbour at dusk', style: 'Film grain' };

function resolved(overrides: Partial<ResolvedReference>): ResolvedReference {
  return { type: 'image', source: 'shot', ...overrides };
}

function mapOf(id: string, ref: VideoShotRef, references: readonly ResolvedReference[] = []): Record<string, unknown> {
  const template = templateById(id);
  if (template === undefined) throw new Error(`no template ${id}`);
  return template.map(ref, { references });
}

describe('the closed set of templates (video-prompt-pack.md §5, A4)', () => {
  it('ships the six vendors the spec names, in the spec order', () => {
    expect(VIDEO_TEMPLATE_IDS).toEqual(['runway-gen4', 'veo-3.1', 'kling-2.6', 'sora-2', 'wan-2.6', 'seedance-2.5']);
  });

  it('looks up a template by id and returns undefined for anything else', () => {
    expect(templateById('kling-2.6')?.displayName).toBe('Kling 2.6');
    expect(templateById('pika-1')).toBeUndefined();
  });

  it('gives every template a grammar note and a file-reference policy', () => {
    for (const template of VIDEO_TEMPLATES) {
      expect(template.grammarHints.trim()).not.toBe('');
      expect(['name', 'attach']).toContain(template.fileRefPolicy);
    }
  });

  it('marks every template provisional until C29 verifies its payload and best-take fields (§9, A3)', () => {
    for (const template of VIDEO_TEMPLATES) {
      expect(template.provisional ?? '', template.id).toMatch(/payload field names.*best-take fields.*C29/);
    }
  });
});

describe('the duration sets match the D3 evidence', () => {
  it('gives each vendor the durations its row documents', () => {
    expect(templateById('runway-gen4')?.limits.durations).toEqual([5, 10]);
    expect(templateById('veo-3.1')?.limits.durations).toEqual([4, 6, 8]);
    expect(templateById('kling-2.6')?.limits.durations).toEqual([5, 10]);
    expect(templateById('sora-2')?.limits.durations).toEqual([4, 8, 12, 16, 20]);
    expect(templateById('wan-2.6')?.limits.durations).toEqual([5, 10, 15]);
  });

  it('gives Seedance every union duration that falls inside its documented 4–30 second range', () => {
    expect(templateById('seedance-2.5')?.limits.durations).toEqual([4, 5, 6, 8, 10, 12, 15, 16, 20]);
  });
});

describe('the exact mapping for one fixed shot per vendor', () => {
  it('Runway composes camera first, in the `[camera]: [scene]. [details].` shape', () => {
    const ref = refFor('runway-gen4', { prompt: PROMPT, durationSec: 5, aspectRatio: '16:9', seed: 42 });
    expect(mapOf('runway-gen4', ref)).toEqual({
      promptText: 'Slow dolly-in: Elena walks down the quay. Harbour at dusk. Film grain.',
      duration: 5,
      ratio: '16:9',
      seed: 42,
    });
  });

  it('Runway names its first frame and its reference images as files, never as uploads', () => {
    const ref = refFor('runway-gen4', { prompt: PROMPT, durationSec: 10 });
    const refs = [resolved({ type: 'firstFrame', fileName: 'a_first.png' }), resolved({ type: 'character', fileName: 'a_elena.png' })];
    expect(mapOf('runway-gen4', ref, refs)).toMatchObject({ promptImage: 'a_first.png', referenceImages: ['a_elena.png'] });
  });

  it('Veo puts the audio cues first and quotes the dialogue', () => {
    const ref = refFor('veo-3.1', {
      prompt: PROMPT,
      audio: { ambient: 'foghorn', dialogue: '"We leave at dawn."' },
      durationSec: 6,
      aspectRatio: '16:9',
      resolution: '1080p',
    });
    expect(mapOf('veo-3.1', ref)).toEqual({
      prompt: 'Ambient sound: foghorn. Slow dolly-in. Elena walks down the quay. Dialogue: "We leave at dawn." Harbour at dusk. Film grain.',
      durationSeconds: 6,
      aspectRatio: '16:9',
      resolution: '1080p',
    });
  });

  it('Kling sends the camera-first prose, the negative prompt and the first frame', () => {
    const ref = refFor('kling-2.6', { prompt: PROMPT, durationSec: 10, aspectRatio: '1:1', negativePrompt: 'blurry' });
    expect(mapOf('kling-2.6', ref, [resolved({ type: 'firstFrame', fileName: 'a_first.png' })])).toEqual({
      prompt: 'Slow dolly-in. Elena walks down the quay. Harbour at dusk. Film grain.',
      negative_prompt: 'blurry',
      duration: 10,
      aspect_ratio: '1:1',
      image: 'a_first.png',
    });
  });

  it('Sora derives the frame size from the aspect ratio and the resolution, and names its characters', () => {
    const ref = refFor('sora-2', { prompt: PROMPT, durationSec: 8, aspectRatio: '9:16', resolution: '1080p' });
    const refs = [resolved({ type: 'character', source: 'codex', entryId: 'c_elena', assetId: 'a_elena', fileName: 'a_elena.png', label: 'Elena' })];
    expect(mapOf('sora-2', ref, refs)).toEqual({
      prompt: 'Slow dolly-in. Elena walks down the quay. Harbour at dusk. Film grain.',
      seconds: 8,
      size: '1080x1920',
      characters: [{ name: 'Elena', file: 'a_elena.png' }],
    });
  });

  it('Wan always sends prompt_extend: false unless the writer turned it on', () => {
    const ref = refFor('wan-2.6', { prompt: PROMPT, durationSec: 15, aspectRatio: '4:3', resolution: '720p', seed: 7, negativePrompt: 'text overlay' });
    expect(mapOf('wan-2.6', ref, [resolved({ type: 'firstFrame', fileName: 'a_first.png' })])).toEqual({
      prompt: 'Slow dolly-in. Elena walks down the quay. Harbour at dusk. Film grain.',
      negative_prompt: 'text overlay',
      duration: 15,
      aspect_ratio: '4:3',
      resolution: '720p',
      seed: 7,
      prompt_extend: false,
      img_url: 'a_first.png',
    });
  });

  it('Seedance names its reference images as a list and sends no first frame', () => {
    const ref = refFor('seedance-2.5', { prompt: PROMPT, durationSec: 4, aspectRatio: '16:9' });
    const refs = [resolved({ type: 'image', fileName: 'a_elena.png' }), resolved({ type: 'character', fileName: 'a_ferry.png' })];
    expect(mapOf('seedance-2.5', ref, refs)).toEqual({
      prompt: 'Slow dolly-in. Elena walks down the quay. Harbour at dusk. Film grain.',
      duration: 4,
      ratio: '16:9',
      reference_images: ['a_elena.png', 'a_ferry.png'],
    });
  });

  it('a template never cuts the text it sends, even when the text is over the cap', () => {
    const long = 'x'.repeat(600);
    const ref = refFor('runway-gen4', { prompt: { subject: long }, durationSec: 5 });
    const promptText = mapOf('runway-gen4', ref).promptText;
    expect(typeof promptText).toBe('string');
    expect((promptText as string).length).toBeGreaterThan(512);
    expect(promptText).toContain(long);
  });
});
