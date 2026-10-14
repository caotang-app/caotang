/**
 * The Ink fixtures the dialogue tests read — dialogue-narrative.md §8's fixture set. Each is a
 * whole body the compiler accepts (except where it is named as broken) and whose parse is known.
 */

/** A branching container: root divert, a knot with bracket, conditional and fall-through choices, a stitch, a second knot. */
export const TAVERN = [
  'VAR gold = 3',
  '-> tavern',
  '',
  '=== tavern ===',
  'The innkeeper looks up.',
  "Innkeeper: Ah, a traveller. What'll it be?",
  '* [Order an ale] -> ale',
  '* {gold > 5} [Pay off the tab] -> END',
  '+ [Leave quietly]',
  '  You slip out the door.',
  '  -> leave',
  '- Nobody stops you.',
  '-> END',
  '',
  '= ale',
  'Ale arrives, foaming.',
  'Innkeeper: Enjoy.',
  '-> tavern',
  '',
  '=== leave ===',
  'The street is cold.',
  '-> END',
  '',
].join('\n');

/** The same tavern with every spoken line and choice label already tagged, as the save path leaves it. */
export const TAVERN_TAGGED = [
  'VAR gold = 3',
  '-> tavern',
  '',
  '=== tavern ===',
  'The innkeeper looks up. # lineId: l_0000000001',
  "Innkeeper: Ah, a traveller. What'll it be? # lineId: l_0000000002",
  '* [Order an ale # lineId: l_0000000003_c] -> ale',
  '* {gold > 5} [Pay off the tab # lineId: l_0000000004_c] -> END',
  '+ [Leave quietly # lineId: l_0000000005_c]',
  '  # lineId: l_0000000006',
  '  You slip out the door.',
  '  -> leave',
  '- Nobody stops you. # lineId: l_0000000007',
  '-> END',
  '',
  '= ale',
  'Ale arrives, foaming. # lineId: l_0000000008',
  "Innkeeper: Enjoy. # lineId: l_0000000009",
  '-> tavern',
  '',
  '=== leave ===',
  'The street is cold. # lineId: l_0000000010',
  '-> END',
  '',
].join('\n');

/** A loose end (middle runs out of flow) and an unreachable knot (orphan is never diverted to). */
export const LOOSE_AND_DEAD = [
  '-> start',
  '=== start ===',
  'Hello there.',
  '-> middle',
  '=== middle ===',
  'The room is quiet.',
  '=== orphan ===',
  'Nobody comes here.',
  '-> END',
  '',
].join('\n');

/** A knot whose only incoming divert names one of its stitches: reached, though the knot itself is never named. */
export const STITCH_ONLY = ['-> hub.a', '=== hub ===', '= a', 'Reached by name.', '-> END', ''].join('\n');

/** A cue for a character who is in the codex, a cue for one who is not, and a cue naming a non-character entry. */
export const SPEAKERS = ['-> scene', '=== scene ===', 'Alice: Hello.', 'Bob: Who is that?', 'Lantern: Hmm.', '-> END', ''].join('\n');

/** A whole story: an intro cluster (intro, cell, a call_out that uses a function and a global), and a market knot that stands alone. */
export const WHOLE_STORY = [
  'VAR coins = 0',
  'VAR unused_flag = false',
  '-> intro',
  '',
  '=== intro ===',
  'You wake in a cell.',
  '* [Look around] -> cell',
  '* [Call out] -> call_out',
  '',
  '=== cell ===',
  'Bars on every side.',
  '-> intro',
  '',
  '=== call_out ===',
  '~ coins = bump(coins)',
  'A guard answers.',
  '-> END',
  '',
  '=== function bump(x) ===',
  '~ return x + 1',
  '',
  '=== market ===',
  'Stalls everywhere.',
  '-> END',
  '',
].join('\n');

/** A story whose two knots divert to each other, so they must stay one container. */
export const TWO_WAY = ['-> ping', '=== ping ===', 'Ping.', '-> pong', '=== pong ===', 'Pong.', '-> ping', ''].join('\n');

/** A minimal, valid draft: one new knot with one spoken line and an END. */
export const DRAFT_OK = ['=== reply ===', 'Thanks for the drink.', '-> END'].join('\n');

/** A draft with a syntax error the compiler rejects: a choice bracket that never closes. */
export const DRAFT_BROKEN = ['=== reply ===', '* [Unclosed choice', '-> END'].join('\n');

/** A draft whose only problem is a flow that runs out: a warning, not an error. */
export const DRAFT_WARNS = ['=== reply ===', 'The flow just stops here.'].join('\n');

/**
 * Global declarations written under knots, each used by a cluster of its own: `coins` (VAR under `b`, used by `c`),
 * `mood` (LIST under `lounge`, used by `street`), and `spare` (VAR under `a`, used by nothing).
 */
export const DECLARED_UNDER_KNOT = [
  '-> a',
  '=== a ===',
  'VAR spare = 1',
  'A stands alone.',
  '-> END',
  '',
  '=== b ===',
  'VAR coins = 0',
  'Coins sit on the counter.',
  '-> END',
  '',
  '=== c ===',
  'You hold {coins} coins.',
  '~ coins = coins + 1',
  '-> END',
  '',
  '=== lounge ===',
  'LIST mood = calm, angry',
  'Your mood is {mood}.',
  '-> END',
  '',
  '=== street ===',
  '~ mood = mood.angry',
  'Anger.',
  '-> END',
  '',
].join('\n');

/** A divert-valued VAR at the top of the body names `vault`, and `hub` uses it: `hub` and `vault` must share a container. */
export const DIVERT_VAR = ['VAR dest = -> vault', '-> hub', '=== hub ===', 'Hi.', '-> dest', '=== vault ===', 'Dark.', '-> END', ''].join('\n');

/** A multi-line conditional block: a value branch, a value branch with its text below, and an `else` with text. */
export const BLOCK_BRANCHES = ['VAR mood = 1', '-> s', '=== s ===', '{ mood:', '- 1: Glad to see you.', '- 2:', '  Oh no.', '- else: Hmm.', '}', '-> END', ''].join('\n');

/** Two cues whose names open with a Unicode capital, and a plain line. */
export const CUE_NAMES = ['-> s', '=== s ===', 'Zoë: Bonjour.', 'Émile: Salut.', 'Plain line.', '-> END', ''].join('\n');

/** A gather line that ends in a colon, outside any conditional block: speech, not a branch opener. */
export const COLON_GATHER = ['-> s', '=== s ===', '  Hi.', '- Here they are:', '  Nice.', '-> END', ''].join('\n');
