/**
 * `export.compile` — agent-harness.md §3 row 11, write-confirm, undo removes the
 * artifact. It is the one tool with two bus commands behind it, and the split is
 * the bus's own (exporter.md §5):
 *
 * - **the whole manuscript** dispatches `export.compile { format, recipeName?, templateId? }`,
 *   which has no scope field at all;
 * - **a part** dispatches `export.compileSelection { includeRootIds, format, recipeName?, templateId? }`,
 *   which names nodes and infers nothing.
 *
 * A saved recipe (`recipeName`) supplies the title page, contents, author, character limit and template. Left
 * without a selection, the recipe names the nodes too: the call dispatches `export.compile` with the recipe's name, and
 * the exporter reads the nodes from the recipe. A recipe on a selection supplies the options only, as the bus's
 * part command does. A manuscript selection with a recipe that names a part is refused, because the two disagree.
 *
 * The harness does the subtree expansion, because the bus will not: a chapter's
 * `includeRootIds` is the chapter and every node under it, listed. A caller who
 * names a folder and does not want its contents says so (`includeSubtrees: false`),
 * and gets a refusal for a folder with nothing of its own, not an empty export.
 *
 * A prompt pack is written for one vendor template, which its `template` (or the recipe's) names
 * (video-prompt-pack.md §5). A pack that names none, or one that is not installed, is refused here, at preflight,
 * so its step is refused before the writer approves its card (agent-harness.md §2), and not at apply.
 */

import { DEFAULT_RECIPE_NAME, EXPORT_FORMATS, ok, type CommandError, type Result } from '@caotang/bus';
import type { ProjectState } from '@caotang/store';
import { VIDEO_TEMPLATE_IDS } from '@caotang/video-prompt-pack';

import { failure, invalidParams, notFound } from '../errors.js';
import { descendantsOf, ANY_NODE, resolveNode } from '../resolve.js';
import { param, type ObjectSpec } from '../schema.js';
import type { CallParams, PreparedCall, PreparedCommand, PrepareContext, ToolValue } from '../types.js';
import { batchRefusal, checkCommand } from './common.js';

export const exportCompileParams: ObjectSpec = param.object(
  'What to compile, and in what format.',
  {
    selection: param.object(
      'The node to compile. The manuscript compiles the whole manuscript; any other node compiles a part. Leave it out when a recipe names the nodes.',
      {
        root: param.string('A node id or a title: manuscript, or any node under it.', { nonBlank: true }),
        includeSubtrees: param.boolean(
          'Include everything under the root. Defaults to true, so a chapter exports with its scenes. False names the node alone.',
          { default: true },
        ),
      },
      ['root'],
    ),
    // The bus's own list, so the agent is offered every format the build compiles (the media formats included) and
    // none it does not. A format added to EXPORT_FORMATS reaches this tool with no edit here.
    format: param.choice('The output format.', [...EXPORT_FORMATS]),
    template: param.string(
      'An export template id. Omit for the default template. A prompt pack names its vendor template here, unless the recipe does.',
      { nonBlank: true },
    ),
    recipeName: param.string(
      'A saved export recipe, by name. It supplies the title page, contents, author, character limit and template, and without a selection, its nodes.',
      { nonBlank: true },
    ),
  },
  ['format'],
);

/** The node a whole-manuscript compile names: the command compiles it, so the outcome lists it (not nothing). */
const WHOLE_MANUSCRIPT: readonly string[] = ['manuscript'];

/** The recipe facts this tool reads: the nodes it names and the template it carries. */
interface RecipeFacts {
  readonly includeRootIds: readonly string[];
  readonly templateId?: string;
}

export function prepareExportCompile(params: CallParams, context: PrepareContext): Result<PreparedCall, CommandError> {
  const { state } = context;
  const selection = params['selection'] as { root?: string; includeSubtrees?: boolean } | undefined;
  const format = String(params['format']);
  const templateId = typeof params['template'] === 'string' ? params['template'] : undefined;
  const recipeName = typeof params['recipeName'] === 'string' ? params['recipeName'] : undefined;

  // The recipe is read here, so a name the project does not hold is refused, and its template is known, before the call is planned.
  const recipe = recipeName === undefined ? undefined : savedRecipe(state, recipeName);
  if (recipeName !== undefined && recipe === undefined) {
    return failure(unknownRecipe(recipeName, savedRecipeNames(state))) as Result<PreparedCall, CommandError>;
  }
  if (format === 'promptpack') {
    const refused = promptPackVendorRefusal(templateId ?? recipe?.templateId);
    if (refused !== undefined) return failure(refused) as Result<PreparedCall, CommandError>;
  }

  if (selection === undefined) {
    if (recipe === undefined || recipeName === undefined) {
      return failure(
        invalidParams(
          'name a selection or a saved recipe, because the call compiles nothing without one',
          'give selection.root (the manuscript, or a node under it), or a recipeName that names the nodes',
          'params.selection',
        ),
      ) as Result<PreparedCall, CommandError>;
    }
    // The recipe names the nodes, and the whole-manuscript command reads them from it (exporter.md §5).
    const command = templateId === undefined ? { format, recipeName } : { format, recipeName, templateId };
    const checked = checkCommand(context, 'export.compile', command);
    if (!checked.ok) {
      return failure(batchRefusal([{ target: 'params', error: checked.error }], 1, 'correct the call and resend it')) as Result<
        PreparedCall,
        CommandError
      >;
    }
    // The outcome names the nodes the command compiles: the manuscript, for a whole-manuscript recipe, and the recipe's own nodes for a part.
    return isWholeManuscript(recipe)
      ? commandCall('export.compile', command, 'manuscript', format, WHOLE_MANUSCRIPT, recipeName)
      : commandCall('export.compile', command, 'part', format, [...recipe.includeRootIds], recipeName);
  }

  const includeSubtrees = selection.includeSubtrees !== false;
  const root = resolveNode(state, selection.root ?? '', ANY_NODE, 'node', 'params.selection.root');
  if (!root.ok) return failure(root.error) as Result<PreparedCall, CommandError>;

  if (root.value.id === 'root') {
    return failure(
      invalidParams(
        'the project root is not a part you can export',
        'select the manuscript to export the whole manuscript, or a node under it to export a part',
        'params.selection.root',
      ),
    ) as Result<PreparedCall, CommandError>;
  }

  if (root.value.id === 'manuscript') {
    if (!includeSubtrees) {
      return failure(
        invalidParams(
          'the manuscript has no text of its own, so compiling it without its contents would export nothing',
          'leave includeSubtrees at true to export the whole manuscript',
          'params.selection.includeSubtrees',
        ),
      ) as Result<PreparedCall, CommandError>;
    }
    if (recipe !== undefined && recipeName !== undefined && !isWholeManuscript(recipe)) {
      return failure(
        invalidParams(
          `the recipe "${recipeName}" names a part of the book, not the manuscript`,
          'leave selection out to compile that part through the recipe, or leave recipeName out to compile the manuscript as it stands',
          'params.recipeName',
        ),
      ) as Result<PreparedCall, CommandError>;
    }
    const command = {
      format,
      ...(recipeName === undefined ? {} : { recipeName }),
      ...(templateId === undefined ? {} : { templateId }),
    };
    const checked = checkCommand(context, 'export.compile', command);
    if (!checked.ok) {
      return failure(batchRefusal([{ target: 'params', error: checked.error }], 1, 'correct the call and resend it')) as Result<
        PreparedCall,
        CommandError
      >;
    }
    return commandCall('export.compile', command, 'manuscript', format, WHOLE_MANUSCRIPT, recipeName);
  }

  if (root.value.type === 'folder' && !includeSubtrees) {
    return failure(
      invalidParams(
        `"${root.value.title}" is a folder and has no text of its own, so with includeSubtrees false it would export nothing`,
        'leave includeSubtrees at true to export the folder with what is under it, or name a document',
        'params.selection.includeSubtrees',
      ),
    ) as Result<PreparedCall, CommandError>;
  }

  const includeRootIds = includeSubtrees
    ? [root.value.id, ...descendantsOf(state, root.value.id).map((node) => node.id)]
    : [root.value.id];
  const command = {
    includeRootIds,
    format,
    ...(recipeName === undefined ? {} : { recipeName }),
    ...(templateId === undefined ? {} : { templateId }),
  };
  const checked = checkCommand(context, 'export.compileSelection', command);
  if (!checked.ok) {
    return failure(batchRefusal([{ target: 'params', error: checked.error }], 1, 'correct the call and resend it')) as Result<
      PreparedCall,
      CommandError
    >;
  }
  return commandCall('export.compileSelection', command, 'part', format, includeRootIds, recipeName);
}

/**
 * The recipe a name names, as the project holds it. A project that stores no recipes holds the default one, which compiles the whole
 * manuscript (exporter.md §4), so its name is found here as well.
 */
function savedRecipe(state: ProjectState, name: string): RecipeFacts | undefined {
  const stored = state.manifest.recipes;
  if (stored === undefined) return name === DEFAULT_RECIPE_NAME ? { includeRootIds: ['manuscript'] } : undefined;
  return stored.find((recipe) => recipe.name === name);
}

function savedRecipeNames(state: ProjectState): string[] {
  return state.manifest.recipes === undefined ? [DEFAULT_RECIPE_NAME] : state.manifest.recipes.map((recipe) => recipe.name);
}

/** Whether a recipe compiles the whole manuscript, and so a whole-manuscript command can carry it. */
function isWholeManuscript(recipe: RecipeFacts | undefined): boolean {
  return recipe === undefined || (recipe.includeRootIds.length === 1 && recipe.includeRootIds[0] === 'manuscript');
}

function unknownRecipe(name: string, known: readonly string[]): CommandError {
  return notFound(
    `there is no saved recipe named "${name}"`,
    known.length === 0
      ? 'no recipe is saved, so compile without recipeName, or give selection.root'
      : `name one of the saved recipes: ${known.map((recipe) => `"${recipe}"`).join(', ')}`,
    'params.recipeName',
  );
}

/**
 * The refusal for a prompt pack that names no installed vendor template, or none. The list is the video prompt pack's own
 * (`VIDEO_TEMPLATE_IDS`), which the exporter reads at apply: a pack the apply would refuse is refused here instead.
 */
function promptPackVendorRefusal(vendor: string | undefined): CommandError | undefined {
  const installed = `name one of the installed templates in template: ${VIDEO_TEMPLATE_IDS.join(', ')}`;
  if (vendor === undefined) {
    return invalidParams('a prompt pack is written for one vendor template, and this compile names none', installed, 'params.template');
  }
  if (!(VIDEO_TEMPLATE_IDS as readonly string[]).includes(vendor)) {
    return invalidParams(`"${vendor}" is not an installed vendor template`, installed, 'params.template');
  }
  return undefined;
}

function commandCall(
  name: 'export.compile' | 'export.compileSelection',
  command: Record<string, unknown>,
  scope: 'manuscript' | 'part',
  format: string,
  includeRootIds: readonly string[],
  recipe: string | undefined,
): Result<PreparedCall, CommandError> {
  const commands: PreparedCommand[] = [{ name, params: command }];
  const named = recipe === undefined ? '' : ` with the recipe "${recipe}"`;
  return ok({
    commands,
    // `dispatch` is the bus command the call will run, with the params the bus checks. The MCP server's write-confirm reads it from the
    // preflight, and asks the exporter whether that command would be refused, before it asks the writer anything (session.check).
    preview: { scope, format, nodes: includeRootIds.length, dispatch: { name, params: command } },
    finish: (done) => {
      const outcome = done[0]?.outcome;
      const value: ToolValue = {
        data: {
          scope,
          format,
          command: name,
          includeRootIds: [...includeRootIds],
          result: outcome?.result ?? null,
          ...(recipe === undefined ? {} : { recipe }),
        },
        summary:
          scope === 'manuscript'
            ? `compiled the manuscript to ${format}${named}`
            : `compiled ${includeRootIds.length} ${includeRootIds.length === 1 ? 'node' : 'nodes'} to ${format}${named}`,
        affected: outcome === undefined ? [] : [...outcome.affected],
        ...(outcome?.undoGroupId === undefined ? {} : { undoGroupId: outcome.undoGroupId }),
      };
      return ok(value);
    },
  });
}
