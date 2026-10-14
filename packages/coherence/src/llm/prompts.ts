/**
 * The prompts and output contracts for the two model stages — [coherence.md §5.3](../../../../docs/architecture/coherence.md),
 * which takes them from ConStory's four-stage pipeline (Stage 1 extraction, Stage 2
 * pairwise verification; Stages 3 and 4 are folded into Stage 2's schema and into
 * deterministic code).
 *
 * The category guide is the spec's five categories with a sentence each. The
 * output contracts are the spec's, written as the JSON Schema hints the gateway
 * takes. Shapes are checked again on the way back in (parse.ts), because a hint
 * is a request and not a guarantee.
 */

import type { LlmCategory } from '../model.js';

export const CATEGORY_GUIDE: Readonly<Record<LlmCategory, string>> = {
  'timeline-plot': 'the order and timing of events, durations, what happens before or after what, and plot causality',
  characterization: 'what a character is like: traits, motives, knowledge, relationships, age, injuries, and what they have done',
  'world-building': 'the rules of the world: how magic, technology, institutions, geography and society work',
  factual: 'concrete facts and details: names, numbers, places, objects, physical descriptions, and who holds what',
  'narrative-style': 'point of view, tense, narrative voice, and how the narration presents events',
};

/** ±200 characters of body text on each side of a span, for pairwise verification (§5.3 Stage 2). */
export const PAIR_CONTEXT_CHARS = 200;

/** §5.3 Stage 1: "≤ 20 spans/doc". */
export const SPANS_PER_DOCUMENT = 20;

/** §5.3 Stage 2: "batched ≤ 10 pairs per call". */
export const PAIRS_PER_CALL = 10;

export interface PromptParts {
  readonly system: string;
  readonly user: string;
  readonly jsonSchemaHint: Readonly<Record<string, unknown>>;
}

function categoryList(categories: readonly LlmCategory[]): string {
  return categories.map((category) => `- ${category}: ${CATEGORY_GUIDE[category]}`).join('\n');
}

function extractionSchema(categories: readonly LlmCategory[]): Readonly<Record<string, unknown>> {
  return {
    type: 'object',
    required: ['spans'],
    properties: {
      spans: {
        type: 'array',
        maxItems: SPANS_PER_DOCUMENT,
        items: {
          type: 'object',
          required: ['docId', 'from', 'to', 'quote', 'category', 'note'],
          properties: {
            docId: { type: 'string' },
            from: { type: 'integer', minimum: 0 },
            to: { type: 'integer', minimum: 0 },
            quote: { type: 'string', maxLength: 300 },
            category: { type: 'string', enum: [...categories] },
            note: { type: 'string', maxLength: 300 },
          },
        },
      },
    },
  };
}

/**
 * Stage 1, one call per document. The model gets the focus document's text with
 * its codex and story-so-far layers, and returns the statements that a later
 * pass could find contradicted.
 */
export function extractionPrompt(input: {
  readonly docId: string;
  readonly title: string;
  readonly body: string;
  readonly categories: readonly LlmCategory[];
  readonly codex: string;
  readonly storySoFar: string;
}): PromptParts {
  const system = [
    'You are a continuity extractor for a manuscript.',
    'Find the statements in the focus document that a later passage could contradict: concrete, checkable claims.',
    'Consider only these categories:',
    categoryList(input.categories),
    `Report at most ${SPANS_PER_DOCUMENT} spans. Each span is a verbatim slice of the focus document given by character offsets [from, to) into the document text exactly as provided.`,
    'Do not report opinions, questions, or generic prose. If nothing is checkable, return an empty list.',
    'Respond with JSON only, in the form {"spans": [{"docId", "from", "to", "quote", "category", "note"}]}.',
  ].join('\n');
  const user = [
    'Codex entries relevant to this document:',
    input.codex === '' ? '(none)' : input.codex,
    '',
    'Story so far (synopses of earlier scenes):',
    input.storySoFar === '' ? '(none)' : input.storySoFar,
    '',
    `Focus document "${input.title}" (docId: ${input.docId}):`,
    '--- BEGIN DOCUMENT ---',
    input.body,
    '--- END DOCUMENT ---',
  ].join('\n');
  return { system, user, jsonSchemaHint: extractionSchema(input.categories) };
}

/** One candidate pair, with its two spans and their surrounding context, ready to show the model. */
export interface PairBlock {
  readonly pairId: string;
  readonly category: LlmCategory;
  readonly a: { readonly docId: string; readonly from: number; readonly to: number; readonly quote: string; readonly before: string; readonly after: string };
  readonly b: { readonly docId: string; readonly from: number; readonly to: number; readonly quote: string; readonly before: string; readonly after: string };
}

function passageText(side: 'A' | 'B', span: PairBlock['a']): string {
  return [
    `Passage ${side} (docId ${span.docId}, offsets ${span.from}-${span.to}):`,
    `${span.before}[[${span.quote}]]${span.after}`,
  ].join('\n');
}

const VERDICTS = ['contradictory', 'consistent', 'unclear'] as const;

function verificationSchema(): Readonly<Record<string, unknown>> {
  const evidence = {
    type: 'object',
    required: ['docId', 'from', 'to', 'quote'],
    properties: {
      docId: { type: 'string' },
      from: { type: 'integer', minimum: 0 },
      to: { type: 'integer', minimum: 0 },
      quote: { type: 'string', maxLength: 300 },
    },
  };
  return {
    type: 'object',
    required: ['verdicts'],
    properties: {
      verdicts: {
        type: 'array',
        items: {
          type: 'object',
          required: ['pairId', 'verdict', 'reasoning', 'evidence', 'factGroup'],
          properties: {
            pairId: { type: 'string' },
            verdict: { type: 'string', enum: [...VERDICTS] },
            reasoning: { type: 'string' },
            evidence: { type: 'array', minItems: 2, maxItems: 2, items: evidence },
            factGroup: {
              type: 'object',
              required: ['entity', 'attribute'],
              properties: { entity: { type: 'string' }, attribute: { type: 'string' } },
            },
          },
        },
      },
    },
  };
}

/**
 * Stage 2, one call per batch of up to ten pairs. The model judges each pair on
 * its context and names the entity and attribute the two passages disagree about,
 * so that findings can be grouped (§4.2).
 */
export function verificationPrompt(blocks: readonly PairBlock[]): PromptParts {
  const system = [
    'You judge whether two passages from one manuscript contradict each other.',
    '"contradictory": the two passages cannot both be true of the same story.',
    '"consistent": they can both be true together.',
    '"unclear": the context does not settle it. Prefer "unclear" to a guess.',
    'For each pair, return its pairId, the verdict, reasoning in at most two sentences, the two passages as evidence (copied exactly), and the entity and attribute they concern.',
    'Respond with JSON only, in the form {"verdicts": [...]}.',
  ].join('\n');
  const user = blocks
    .map((block) =>
      [
        `[pair ${block.pairId}] category: ${block.category}`,
        passageText('A', block.a),
        passageText('B', block.b),
      ].join('\n'),
    )
    .join('\n\n');
  return { system, user, jsonSchemaHint: verificationSchema() };
}
