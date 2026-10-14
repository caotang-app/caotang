/**
 * The words of a pace line (goals-progress §2.2). A pace line reads "≈ 1 word/day to finish by 31 Dec 2030", so this gives the
 * count and the noun, and the caller adds "/day": one word is written in the singular, and every other count in the plural.
 * The count is grouped the way the rest of the app groups numbers (en-US).
 */
export function paceWords(perDay: number): string {
  const count = new Intl.NumberFormat('en-US').format(perDay);
  return `${count} ${perDay === 1 ? 'word' : 'words'}`;
}
