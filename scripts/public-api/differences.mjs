// Shows how a generated API list differs from the committed one, in a form short enough for a
// terminal or a pull request comment: a changed line is shown as a window around its first
// difference from the most similar line on the other side.

const WINDOW = 200;

export const listLines = (text) =>
  text.split('\n').filter((line) => line !== '' && !line.startsWith('#'));

const commonPrefixLength = (a, b) => {
  let index = 0;
  while (index < a.length && index < b.length && a[index] === b[index]) index++;
  return index;
};

// The line itself if it is short, otherwise about WINDOW characters around `index` (or from the
// start when there is no index), with the line's length and where it first differs.
export function excerptAround(line, index = undefined) {
  if (line.length <= WINDOW) return line;
  const start =
    index === undefined
      ? 0
      : Math.min(Math.max(0, index - WINDOW / 2), Math.max(0, line.length - WINDOW));
  const end = start + WINDOW;
  const shown = `${start > 0 ? '…' : ''}${line.slice(start, end)}${end < line.length ? '…' : ''}`;
  const where = index === undefined ? '' : `, first difference at character ${index + 1}`;
  return `${shown} (line of ${line.length} characters${where})`;
}

function firstDifference(line, others) {
  let best;
  for (const other of others) {
    const length = commonPrefixLength(line, other);
    if (best === undefined || length > best) best = length;
  }
  return best;
}

// Lines only in `generated` are added, lines only in `committed` removed. Up to `limit` of each.
export function listDifferences(committed, generated, limit = 10) {
  const before = new Set(listLines(committed));
  const after = new Set(listLines(generated));
  const added = [...after].filter((line) => !before.has(line));
  const removed = [...before].filter((line) => !after.has(line));
  const shown = [
    ...removed
      .slice(0, limit)
      .map((line) => `- ${excerptAround(line, firstDifference(line, added))}`),
    ...added
      .slice(0, limit)
      .map((line) => `+ ${excerptAround(line, firstDifference(line, removed))}`),
  ];
  const hidden = Math.max(0, removed.length - limit) + Math.max(0, added.length - limit);
  if (hidden > 0) shown.push(`  ... and ${hidden} more`);
  if (shown.length === 0 && committed !== generated) {
    shown.push('  (same lines, different order or spacing)');
  }
  return shown;
}
