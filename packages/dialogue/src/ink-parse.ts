/**
 * The Ink parse layer — [dialogue-narrative.md §2.3](../../../docs/architecture/dialogue-narrative.md).
 *
 * A line reader over an Ink body, Caotang-owned. It compiles nothing: the inkjs compiler
 * is the validator (§2.2, §5), and this parse answers what the graph view, the line
 * table and the findings need. Which knot or stitch a line sits in, where each divert
 * and choice goes, which lines are speakable, and which of them already carry a line id.
 * Where Ink's grammar is richer than a line reader (multi-line conditional blocks, weave
 * nesting), the approximation is named where it happens, and the compile gate is what
 * catches a body this reader misreads.
 *
 * Offsets are into the body the store holds. Comments are masked to spaces before the
 * scan, so every offset survives the masking and a line's `from` is its index in the
 * stored text.
 */

/** The implicit top-level flow before the first knot. Ink's root; a knot name cannot contain parentheses. */
export const ROOT_NODE_ID = '(root)';

/** A divert to `END` or `DONE`. Both end the graph path; the distinction is an engine detail. */
export const END_TARGET = 'END';

/** A divert whose target is a variable, or a name the parse cannot resolve. */
export const DYNAMIC_TARGET = 'divert';

/** A choice whose line has no divert: its flow falls through to the next gather in the same weave. */
export const FALLTHROUGH_TARGET = 'fallthrough';

export type GraphNodeKind = 'root' | 'knot' | 'stitch';

/**
 * Where a line id can go without changing what the line does at runtime.
 *
 * - `inline`: a tag at the end of the text. Ink accepts it on a content line with no divert.
 * - `above`: a tag-only line directly above. Needed for a content line with a divert, since Ink
 *   rejects a tag after a divert; the tag-only form was measured to attach to that line's output.
 * - `bracket`: a tag inside a choice's brackets, where Ink attaches a choice's own tags.
 * - `none`: no placement keeps the output. A choice's spoken tail with a divert, or a no-bracket
 *   choice with one, is in this class: moving the divert to its own line adds a newline to the output.
 */
export type MintMode = 'inline' | 'above' | 'bracket' | 'none';

export interface ParseWarning {
  readonly line: number;
  readonly message: string;
}

/** One speakable line: a dialogue line, or a choice label. Choice labels are their own rows (§6). */
export interface DialogueLine {
  readonly kind: 'line' | 'choice';
  /** Position among the container's speakable lines, in body order. */
  readonly index: number;
  /** The owning node id: `(root)`, a knot id, or `knot.stitch`. */
  readonly node: string;
  /** 1-based line number in the body. */
  readonly line: number;
  /** Offset of the physical line's first character. */
  readonly lineStart: number;
  /** The physical line's leading whitespace. */
  readonly indent: string;
  /** Offset of the speakable text's first character, after any speaker prefix. */
  readonly from: number;
  /** Offset just past the speakable text. */
  readonly to: number;
  /** The speakable text: speaker prefix, tags, diverts and choice brackets removed. */
  readonly text: string;
  /** The `Name:` prefix, as typed, or null. Choice labels never carry one. */
  readonly speaker: string | null;
  /** Choices only: the `{...}` conditions joined with ` && `, or null. */
  readonly condition: string | null;
  /** The valid `lineId` on the line, or null. */
  readonly lineId: string | null;
  /** The raw value of a `lineId` tag that is not valid for this kind of line, or null. */
  readonly malformedId: string | null;
  /** True when the id came from a tag-only line directly above. */
  readonly tagAbove: boolean;
  readonly mint: MintMode;
  /** For `mint: 'bracket'`, the offset of the closing `]`. -1 otherwise. */
  readonly bracketClose: number;
}

/** A divert as written, resolved to the graph's own vocabulary. */
export interface DivertRecord {
  readonly from: string;
  /** A node id, `END`, or `divert` for a variable target or an unresolved name. */
  readonly target: string;
  readonly raw: string;
  readonly line: number;
}

/** §2.3's `choices[]` entry. One record per divert a choice reaches, or one `fallthrough` record. */
export interface ChoiceRecord {
  readonly from: string;
  readonly label: string;
  readonly target: string;
  readonly condition?: string;
  readonly onceOnly: boolean;
  readonly line: number;
}

/** §2.3's `nodes[]` entry: a knot, a stitch, or the root. */
export interface GraphNode {
  readonly id: string;
  readonly kind: GraphNodeKind;
  /** The top-level knot the node belongs to. Empty for the root. */
  readonly knot: string;
  /** The header's name. Empty for the root. */
  readonly name: string;
  /** 1-based header line. The root is line 1. */
  readonly line: number;
  /** Offset of the header line's first character. The root starts at 0. */
  readonly from: number;
  /** End of the node's own content: the next header of any level, or the body's end. */
  readonly to: number;
  /** End of the node's section including its stitches: the next top-level header, or the body's end. */
  readonly subtreeTo: number;
  readonly lines: readonly DialogueLine[];
  readonly choices: readonly ChoiceRecord[];
  readonly diverts: readonly DivertRecord[];
}

/** A `VAR`, `CONST` or `LIST` declaration, parse-derived (§2.2). */
export interface VariableDecl {
  readonly kind: 'VAR' | 'CONST' | 'LIST';
  readonly name: string;
  /** The text after `=`, verbatim, or empty. */
  readonly default: string;
  readonly line: number;
  readonly from: number;
  readonly to: number;
}

/** A function. Its body is opaque to the graph: Ink forbids diverts inside one, and it is never a path node. */
export interface FunctionDecl {
  readonly name: string;
  readonly line: number;
  readonly from: number;
  readonly to: number;
}

/** §2.3's `DialogueGraph`, a projection over the Ink text. Never stored (codex-panels §2). */
export interface DialogueGraph {
  readonly entry: string;
  /** The root first, then knots and stitches in body order. */
  readonly nodes: readonly GraphNode[];
  readonly choices: readonly ChoiceRecord[];
  readonly variables: readonly VariableDecl[];
  readonly functions: readonly FunctionDecl[];
  readonly warnings: readonly ParseWarning[];
}

export interface PhysicalLine {
  readonly number: number;
  readonly from: number;
  readonly to: number;
  readonly text: string;
}

export interface ParsedInk {
  readonly body: string;
  readonly graph: DialogueGraph;
  /** Every speakable line, in body order. */
  readonly lines: readonly DialogueLine[];
  readonly physical: readonly PhysicalLine[];
}

/** Crockford base32 ids (`@caotang/ids`), `l_` + 10 characters. A choice label's id ends in `_c`. */
export const LINE_ID_PATTERN = /^l_[0-9A-HJKMNP-TV-Z]{10}(?:_c)?$/;

const KNOT_HEADER = /^\s*={2,}\s*(function\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*(\([^)]*\))?\s*=*\s*$/;
const STITCH_HEADER = /^\s*=\s*([A-Za-z_][A-Za-z0-9_]*)\s*$/;
const GATHER_MARK = /^\s*(-+)(?!>)/;
const LABEL = /^\s*\(([A-Za-z_][A-Za-z0-9_]*)\)/;
const CHOICE_MARK = /^\s*([*+](?:\s*[*+])*)/;
const CONDITION = /^\s*\{([^{}]*)\}/;
const BRACKET = /^\s*\[([^\]]*)\]/;
const DIVERT_ALL = /->\s*([A-Za-z_][A-Za-z0-9_.]*|END|DONE)(?![A-Za-z0-9_.])/g;
/**
 * A speaker cue: a Unicode capital, then letters and the name marks, up to four words. `Zoë:` and
 * `Émile:` are cues, so the table never speaks their names. A cue is still a capital-led name
 * (screenplay.md §4); a lowercase or longer prefix is text.
 */
const SPEAKER_PREFIX = /^(\p{Lu}[\p{L}'.-]*(?:\s+\p{Lu}[\p{L}'.-]*){0,3})\s*:\s+/u;
const LINE_ID_TAG = /lineId:\s*([^\s#\]]+)/;
const VARIABLE = /^\s*(VAR|CONST|LIST)\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:=\s*(.*?))?\s*$/;
const INCLUDE = /^\s*INCLUDE\b/;
/** A multi-line conditional block's opener (`{ cond:`): logic, not speech. Its branches are gathers (`- else:`). */
const BLOCK_OPENER = /^\s*\{[^}]*:\s*$/;
/**
 * A branch of an open block, `- value: text`: the value, then the text after its colon. A brace or a
 * bracket in the head means an inline conditional, which is not a branch.
 */
const BRANCH_HEAD = /^([^:{}[\]]*):(.*)$/;

/**
 * Replaces each comment with spaces, keeping every newline and every offset. Ink has
 * double-slash line comments and slash-star block comments; a block may span lines.
 */
export function maskComments(body: string): string {
  let out = '';
  let i = 0;
  let inBlock = false;
  while (i < body.length) {
    const ch = body.charAt(i);
    if (inBlock) {
      if (body.startsWith('*/', i)) {
        out += '  ';
        i += 2;
        inBlock = false;
      } else {
        out += ch === '\n' || ch === '\r' ? ch : ' ';
        i += 1;
      }
    } else if (body.startsWith('/*', i)) {
      out += '  ';
      i += 2;
      inBlock = true;
    } else if (body.startsWith('//', i)) {
      while (i < body.length && body.charAt(i) !== '\n' && body.charAt(i) !== '\r') {
        out += ' ';
        i += 1;
      }
    } else {
      out += ch;
      i += 1;
    }
  }
  return out;
}

/** Splits on `\n`, dropping a `\r` before it. Offsets index the text they came from. */
export function physicalLines(text: string): PhysicalLine[] {
  const lines: PhysicalLine[] = [];
  let from = 0;
  for (let i = 0; i <= text.length; i += 1) {
    if (i === text.length || text.charAt(i) === '\n') {
      let to = i;
      if (to > from && text.charAt(to - 1) === '\r') to -= 1;
      lines.push({ number: lines.length + 1, from, to, text: text.slice(from, to) });
      from = i + 1;
    }
  }
  return lines;
}

/** A tag-only line's `lineId`, waiting for the speakable line it sits above. */
interface CarriedTag {
  readonly value: string;
}

interface PendingChoice {
  readonly label: string;
  readonly condition: string | null;
  readonly onceOnly: boolean;
  readonly line: number;
  readonly depth: number;
  readonly rawTargets: string[];
  readonly node: string;
}

interface MutableNode {
  readonly id: string;
  readonly kind: GraphNodeKind;
  readonly knot: string;
  readonly name: string;
  readonly line: number;
  readonly from: number;
  readonly lines: DialogueLine[];
  readonly choices: PendingChoice[];
  readonly rawDiverts: { raw: string; line: number }[];
}

interface Scan {
  readonly warnings: ParseWarning[];
  readonly variables: VariableDecl[];
  readonly functions: { name: string; line: number; from: number }[];
  readonly headers: { offset: number; level: 1 | 2 }[];
  readonly nodes: MutableNode[];
  readonly labels: Map<string, string>;
  readonly lines: DialogueLine[];
  /** The choices still open, innermost last. A gather or header closes them. */
  readonly open: { depth: number; choice: PendingChoice }[];
}

interface Segment {
  /** Offset of the speakable text, relative to the segment. */
  readonly textStart: number;
  readonly textEnd: number;
  readonly speaker: string | null;
  readonly diverts: readonly string[];
  /** The text from the first `#` on, or the empty string. */
  readonly tag: string;
}

/**
 * Reads one segment of a line: a whole content line, the head of a choice, or the text
 * after a choice's brackets. A choice head takes no speaker prefix, so `* Yes: sure`
 * keeps its whole label.
 */
function readSegment(segment: string, allowSpeaker: boolean): Segment {
  const hashAt = segment.indexOf('#');
  const body = hashAt >= 0 ? segment.slice(0, hashAt) : segment;
  const tag = hashAt >= 0 ? segment.slice(hashAt) : '';
  const diverts = [...body.matchAll(DIVERT_ALL)].map((m) => m[1] ?? '');
  const firstDivert = body.indexOf('->');
  const limit = firstDivert >= 0 ? firstDivert : body.length;
  const lead = body.length - body.trimStart().length;
  const head = body.slice(lead, limit);
  const prefix = allowSpeaker ? SPEAKER_PREFIX.exec(head) : null;
  const afterPrefix = prefix ? prefix[0].length : 0;
  const speaker = prefix ? (prefix[1] ?? null) : null;
  const rest = head.slice(afterPrefix);
  const textStart = lead + afterPrefix + (rest.length - rest.trimStart().length);
  return { textStart, textEnd: textStart + rest.trim().length, speaker, diverts, tag };
}

function checkedId(value: string, kind: 'line' | 'choice'): { id: string | null; malformed: string | null } {
  const suffixOk = kind === 'choice' ? value.endsWith('_c') : !value.endsWith('_c');
  return LINE_ID_PATTERN.test(value) && suffixOk ? { id: value, malformed: null } : { id: null, malformed: value };
}

/** Where a speakable line's id goes: `content` and `tail` are text lines, `choice` a head, `bracket` a bracketed label. */
type Place = 'content' | 'tail' | 'choice' | 'bracket';

/** The id fields of a speakable line: its own tag first, else the tag-only line above it. */
function idFields(
  tag: string,
  kind: 'line' | 'choice',
  carried: CarriedTag | null,
  hasDivert: boolean,
  place: Place,
): Pick<DialogueLine, 'lineId' | 'malformedId' | 'tagAbove' | 'mint'> {
  const mint = placeOf(hasDivert, place);
  const tagged = LINE_ID_TAG.exec(tag);
  if (tagged) {
    const own = checkedId(tagged[1] ?? '', kind);
    return { lineId: own.id, malformedId: own.malformed, tagAbove: false, mint };
  }
  if (carried !== null) {
    const above = checkedId(carried.value, kind);
    return { lineId: above.id, malformedId: above.malformed, tagAbove: above.id !== null, mint };
  }
  return { lineId: null, malformedId: null, tagAbove: false, mint };
}

function placeOf(hasDivert: boolean, place: Place): MintMode {
  if (place === 'bracket') return 'bracket';
  if (place === 'choice') return hasDivert ? 'none' : 'inline';
  if (!hasDivert) return 'inline';
  return place === 'content' ? 'above' : 'none';
}

function recordDiverts(scan: Scan, node: MutableNode, raws: readonly string[], line: number): void {
  for (const raw of raws) node.rawDiverts.push({ raw, line });
  const innermost = scan.open[scan.open.length - 1];
  if (innermost !== undefined) innermost.choice.rawTargets.push(...raws);
}

function addLine(scan: Scan, node: MutableNode, line: Omit<DialogueLine, 'index'>): void {
  const full: DialogueLine = { ...line, index: scan.lines.length };
  scan.lines.push(full);
  node.lines.push(full);
}

/**
 * Emits a content segment as a dialogue line when it has speakable text, and records its
 * diverts. `segment` is always a suffix of the physical line, so its offset is the line's
 * end minus its own length.
 */
function emitContent(
  scan: Scan,
  node: MutableNode,
  segment: string,
  line: PhysicalLine,
  indent: string,
  carried: CarriedTag | null,
  place: 'content' | 'tail',
): void {
  const seg = readSegment(segment, true);
  if (seg.diverts.length > 0) recordDiverts(scan, node, seg.diverts, line.number);
  const body = segment.slice(seg.textStart, seg.textEnd);
  if (body === '') return;
  const base = line.from + line.text.length - segment.length;
  addLine(scan, node, {
    kind: 'line',
    node: node.id,
    line: line.number,
    lineStart: line.from,
    indent,
    from: base + seg.textStart,
    to: base + seg.textEnd,
    text: body,
    speaker: seg.speaker,
    condition: null,
    ...idFields(seg.tag, 'line', carried, seg.diverts.length > 0, place),
    bracketClose: -1,
  });
}

function closeChoicesAt(scan: Scan, depth: number): void {
  while (scan.open.length > 0 && (scan.open[scan.open.length - 1]?.depth ?? 0) >= depth) scan.open.pop();
}

/** A choice's line: its marker, optional label, conditions, and bracket or head text. */
function parseChoiceLine(scan: Scan, node: MutableNode, line: PhysicalLine, indent: string, carried: CarriedTag | null, match: RegExpExecArray): void {
  const marker = match[1] ?? '';
  const depth = [...marker].filter((ch) => ch === '*' || ch === '+').length;
  const onceOnly = marker.trimEnd().endsWith('*');
  closeChoicesAt(scan, depth);
  const text = line.text;
  let rest = text.slice(match[0].length);
  const label = LABEL.exec(rest);
  if (label) {
    scan.labels.set(`${node.knot}|${label[1] ?? ''}`, node.id);
    rest = rest.slice(label[0].length);
  }
  const conditions: string[] = [];
  let cond = CONDITION.exec(rest);
  while (cond) {
    conditions.push((cond[1] ?? '').trim());
    rest = rest.slice(cond[0].length);
    cond = CONDITION.exec(rest);
  }
  const condition = conditions.length > 0 ? conditions.join(' && ') : null;
  const bracket = BRACKET.exec(rest);
  const restStart = line.from + text.length - rest.length;

  if (bracket) {
    const inner = bracket[1] ?? '';
    const innerStart = restStart + bracket[0].indexOf('[') + 1;
    const bracketClose = restStart + bracket[0].length - 1;
    const hashAt = inner.indexOf('#');
    const pre = hashAt >= 0 ? inner.slice(0, hashAt) : inner;
    const labelText = pre.trim();
    const choice: PendingChoice = { label: labelText, condition, onceOnly, line: line.number, depth, rawTargets: [], node: node.id };
    node.choices.push(choice);
    scan.open.push({ depth, choice });
    if (labelText !== '') {
      const labelFrom = innerStart + (pre.length - pre.trimStart().length);
      addLine(scan, node, {
        kind: 'choice',
        node: node.id,
        line: line.number,
        lineStart: line.from,
        indent,
        from: labelFrom,
        to: labelFrom + labelText.length,
        text: labelText,
        speaker: null,
        condition,
        ...idFields(hashAt >= 0 ? inner.slice(hashAt) : '', 'choice', carried, false, 'bracket'),
        bracketClose,
      });
    }
    const afterBracket = rest.slice(bracket[0].length);
    emitContent(scan, node, afterBracket, line, indent, labelText === '' ? carried : null, 'tail');
    return;
  }

  const seg = readSegment(rest, false);
  const labelText = rest.slice(seg.textStart, seg.textEnd);
  const choice: PendingChoice = { label: labelText, condition, onceOnly, line: line.number, depth, rawTargets: [], node: node.id };
  node.choices.push(choice);
  scan.open.push({ depth, choice });
  if (seg.diverts.length > 0) recordDiverts(scan, node, seg.diverts, line.number);
  if (labelText !== '') {
    const labelFrom = restStart + seg.textStart;
    addLine(scan, node, {
      kind: 'choice',
      node: node.id,
      line: line.number,
      lineStart: line.from,
      indent,
      from: labelFrom,
      to: labelFrom + labelText.length,
      text: labelText,
      speaker: null,
      condition,
      ...idFields(seg.tag, 'choice', carried, seg.diverts.length > 0, 'choice'),
      bracketClose: -1,
    });
  }
}

/**
 * Parses an Ink body. Pure: the same body always yields the same graph, and nothing is
 * compiled here. Lines inside a function are skipped, since a function has no graph role.
 */
export function parseInk(body: string): ParsedInk {
  const physical = physicalLines(maskComments(body));
  const root: MutableNode = { id: ROOT_NODE_ID, kind: 'root', knot: '', name: '', line: 1, from: 0, lines: [], choices: [], rawDiverts: [] };
  const scan: Scan = {
    warnings: [],
    variables: [],
    functions: [],
    headers: [],
    nodes: [root],
    labels: new Map(),
    lines: [],
    open: [],
  };
  let current: MutableNode | null = root;
  let topKnot = '';
  /** A tag-only line's id, carried to the next non-blank line only. */
  let carried: CarriedTag | null = null;
  /** How many multi-line conditional blocks are open. A header closes them all: a block cannot span a knot. */
  let blockDepth = 0;

  for (const line of physical) {
    const text = line.text;
    if (text.trim() === '') continue;
    const tagAbove = carried;
    carried = null;

    const knot = KNOT_HEADER.exec(text);
    if (knot) {
      scan.headers.push({ offset: line.from, level: 1 });
      scan.open.length = 0;
      blockDepth = 0;
      const name = knot[2] ?? '';
      if (knot[1] !== undefined) {
        scan.functions.push({ name, line: line.number, from: line.from });
        current = null;
        continue;
      }
      topKnot = name;
      if (scan.nodes.some((n) => n.id === name)) scan.warnings.push({ line: line.number, message: `knot "${name}" is declared twice` });
      current = addNode(scan, { id: name, kind: 'knot', knot: name, name, line: line.number, from: line.from });
      continue;
    }

    const stitch = STITCH_HEADER.exec(text);
    if (stitch) {
      scan.headers.push({ offset: line.from, level: 2 });
      scan.open.length = 0;
      blockDepth = 0;
      if (current === null) continue;
      const name = stitch[1] ?? '';
      const id = topKnot === '' ? name : `${topKnot}.${name}`;
      if (scan.nodes.some((n) => n.id === id)) scan.warnings.push({ line: line.number, message: `stitch "${id}" is declared twice` });
      current = addNode(scan, { id, kind: 'stitch', knot: topKnot, name, line: line.number, from: line.from });
      continue;
    }

    const variable = VARIABLE.exec(text);
    if (variable) {
      const decl = (variable[3] ?? '').trim();
      scan.variables.push({
        kind: (variable[1] ?? 'VAR') as VariableDecl['kind'],
        name: variable[2] ?? '',
        default: decl,
        line: line.number,
        from: line.from,
        to: line.to,
      });
      // `VAR dest = -> knot` makes the knot reachable through `-> dest`, so the target is a reference from the root.
      for (const match of decl.matchAll(DIVERT_ALL)) root.rawDiverts.push({ raw: match[1] ?? '', line: line.number });
      continue;
    }

    if (current === null) continue;
    const node: MutableNode = current;

    if (/^\s*\}/.test(text)) blockDepth = Math.max(0, blockDepth - 1);
    if (/^\s*[~}]/.test(text)) continue;
    if (INCLUDE.test(text)) {
      scan.warnings.push({ line: line.number, message: 'INCLUDE is not followed: the parse reads one body' });
      continue;
    }
    if (/^\s*#/.test(text)) {
      const bare = LINE_ID_TAG.exec(text);
      carried = bare ? { value: bare[1] ?? '' } : null;
      continue;
    }

    const indent = /^\s*/.exec(text)?.[0] ?? '';

    const gather = GATHER_MARK.exec(text);
    if (gather) {
      closeChoicesAt(scan, (gather[1] ?? '').length);
      let rest = text.slice(gather[0].length);
      const label = LABEL.exec(rest);
      if (label) {
        scan.labels.set(`${topKnot}|${label[1] ?? ''}`, node.id);
        rest = rest.slice(label[0].length);
      }
      if (blockDepth > 0 && !rest.includes('->')) {
        // A branch of an open block: its value is logic, and the text after its colon is what speaks.
        // A bare `- else:` or `- value:` opens a branch whose text is on the lines below, so it speaks nothing.
        const branch = BRANCH_HEAD.exec(rest);
        if (branch) {
          const after = branch[2] ?? '';
          if (after.trim() === '') continue;
          rest = after;
        }
      }
      emitContent(scan, node, rest, line, indent, tagAbove, 'content');
      continue;
    }

    const choice = CHOICE_MARK.exec(text);
    if (choice) {
      parseChoiceLine(scan, node, line, indent, tagAbove, choice);
      continue;
    }

    if (BLOCK_OPENER.test(text)) {
      blockDepth += 1;
      continue;
    }
    emitContent(scan, node, text, line, indent, tagAbove, 'content');
  }

  return finish(body, physical, scan);
}

function addNode(scan: Scan, spec: Pick<MutableNode, 'id' | 'kind' | 'knot' | 'name' | 'line' | 'from'>): MutableNode {
  const node: MutableNode = { ...spec, lines: [], choices: [], rawDiverts: [] };
  scan.nodes.push(node);
  return node;
}

function finish(body: string, physical: readonly PhysicalLine[], scan: Scan): ParsedInk {
  const bodyEnd = body.length;
  const nextHeader = (offset: number, level: 1 | 'any'): number => {
    for (const h of scan.headers) {
      if (h.offset > offset && (level === 'any' || h.level === 1)) return h.offset;
    }
    return bodyEnd;
  };
  const ids = new Set(scan.nodes.map((n) => n.id));
  const variableNames = new Set(scan.variables.map((v) => v.name));

  const resolve = (raw: string, node: MutableNode, line: number): string => {
    if (raw === 'END' || raw === 'DONE') return END_TARGET;
    if (node.knot !== '' && ids.has(`${node.knot}.${raw}`)) return `${node.knot}.${raw}`;
    if (ids.has(raw)) return raw;
    const label = scan.labels.get(`${node.knot}|${raw}`);
    if (label !== undefined) return label;
    if (variableNames.has(raw)) return DYNAMIC_TARGET;
    scan.warnings.push({ line, message: `divert target "${raw}" is not a knot, stitch or label in this body` });
    return DYNAMIC_TARGET;
  };

  const nodes: GraphNode[] = scan.nodes.map((node) => {
    const to = node.kind === 'root' ? nextHeader(-1, 'any') : nextHeader(node.from, 'any');
    const subtreeTo = node.kind === 'knot' ? nextHeader(node.from, 1) : node.kind === 'root' ? nextHeader(-1, 1) : to;
    const diverts: DivertRecord[] = node.rawDiverts.map((d) => ({ from: node.id, target: resolve(d.raw, node, d.line), raw: d.raw, line: d.line }));
    const choices: ChoiceRecord[] = [];
    for (const c of node.choices) {
      const targets = c.rawTargets.length === 0 ? [FALLTHROUGH_TARGET] : c.rawTargets.map((raw) => resolve(raw, node, c.line));
      for (const target of targets) {
        choices.push({
          from: c.node,
          label: c.label,
          target,
          ...(c.condition !== null ? { condition: c.condition } : {}),
          onceOnly: c.onceOnly,
          line: c.line,
        });
      }
    }
    return {
      id: node.id,
      kind: node.kind,
      knot: node.knot,
      name: node.name,
      line: node.line,
      from: node.kind === 'root' ? 0 : node.from,
      to,
      subtreeTo,
      lines: node.lines,
      choices,
      diverts,
    };
  });

  const graph: DialogueGraph = {
    entry: ROOT_NODE_ID,
    nodes,
    choices: nodes.flatMap((n) => n.choices),
    variables: scan.variables.map((v) => ({ ...v })),
    functions: scan.functions.map((f) => ({ name: f.name, line: f.line, from: f.from, to: nextHeader(f.from, 1) })),
    warnings: scan.warnings,
  };
  return { body, graph, lines: scan.lines, physical };
}

/** The node whose own content covers a body offset, or undefined inside a function. */
export function nodeAtOffset(graph: DialogueGraph, offset: number): GraphNode | undefined {
  return graph.nodes.find((node) => (node.kind === 'root' ? offset < node.to : offset >= node.from && offset < node.to));
}

export function findNode(graph: DialogueGraph, id: string): GraphNode | undefined {
  return graph.nodes.find((n) => n.id === id);
}

/** The knot and stitch ids, in body order: what a draft may continue from. */
export function beatIds(graph: DialogueGraph): string[] {
  return graph.nodes.filter((n) => n.kind !== 'root').map((n) => n.id);
}
