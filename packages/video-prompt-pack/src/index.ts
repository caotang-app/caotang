/**
 * `@caotang/video-prompt-pack` — the AI-video prompt authoring engine, headless (video-prompt-pack.md, M4).
 *
 * What is in here:
 *  - the normalized shot schema, the codex visual-reference rules and the reference resolution order;
 *  - the six vendor templates, as data plus mapping functions, and the pack-time validation over their limits;
 *  - the shot-scoped context assembly (L2–L5) and the reply parsers;
 *  - `prompt.draft` and `prompt.variant`, each as a staging half that calls an injected model and a commit
 *    half that writes nothing until it is applied;
 *  - the JSON pack, the Markdown pack and the CSV shot list, rendered from one run;
 *  - the two tools in the harness's registry entry shape, declared and not registered.
 *
 * What is not: the UI, the bus command that sets a shot's `vendorRefs` (storyboard.md), the compile-recipe
 * wiring that adds `promptpack` to the exporter's formats, the provider adapter, and any vendor call. A
 * vendor call does not exist anywhere in this package, and that is the BYOK boundary (§1, §6).
 */

export * from './model.js';
export * from './port.js';
export * from './errors.js';

export { childrenOf, folderChain, scopeIdsOf, shotById, shotNumbers, storyboardRank, vendorRefOf, withVendorRef } from './shot.js';

export {
  defineTemplate,
  type AcceptContext,
  type MapContext,
  type ReferenceRules,
  type RequiredField,
  type TemplateDefinition,
  type VendorLimits,
  type VendorPayload,
  type VideoVendorTemplate,
} from './template.js';
export { genericIssues, type RuleSubject } from './validate.js';
export { VIDEO_TEMPLATES, VIDEO_TEMPLATE_IDS, templateById } from './templates/index.js';

export {
  detectShotMentions,
  resolveReferences,
  shotSurfaces,
  type ReferenceProvenance,
  type ReferenceResolution,
  type ResolveInput,
  type SuppliedEntry,
  type WithheldEntry,
} from './references.js';

export {
  SHOT_CONTEXT_BUDGET,
  assembleShotContext,
  promptLine,
  type ContextInput,
  type LayerPreview,
  type ShotContext,
  type ShotLayer,
} from './context.js';

export { DRAFT_FIELDS, parseDraftReply, parseJsonReply, parseVariantReply, type DraftField, type DraftReply } from './parse.js';

export {
  DRAFT_SHOT_LIMIT,
  cameraPhrase,
  commitPromptDraft,
  requireTemplate,
  stagePromptDraft,
  type PromptDraftCommit,
  type PromptDraftProposal,
  type PromptDraftRequest,
  type PromptDraftWrite,
  type ShotDraft,
  type ShotRefusal,
} from './draft.js';

export {
  VARIATIONS,
  applyVariation,
  currentValueOf,
  fieldOf,
  stagePromptVariant,
  variantPickProposal,
  type VariantAlternative,
  type VariantProposal,
  type VariantRequest,
  type Variation,
} from './variant.js';

export {
  fileNameFor,
  mentionWords,
  preparePack,
  renderPromptPack,
  withheldWords,
  type PackArtifact,
  type PackRun,
  type PackShot,
  type RenderOutcome,
} from './pack.js';

export {
  PROMPT_PACK_TOOL_ENTRIES,
  PROMPT_PACK_TOOL_NAMES,
  commitPromptDraftTool,
  isPromptPackToolName,
  pickVariantTool,
  stagePromptDraftTool,
  stagePromptVariantTool,
  type CommitData,
  type PromptPackParamSpec,
  type PromptPackParamsObject,
  type PromptPackToolContext,
  type PromptPackToolEntry,
  type PromptPackToolMeta,
  type PromptPackToolName,
  type PromptPackToolRisk,
  type ToolFailure,
  type ToolResult,
  type ToolSuccess,
} from './tools.js';
