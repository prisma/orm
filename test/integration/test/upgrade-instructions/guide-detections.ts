import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { type } from 'arktype';
import matter from 'gray-matter';
import { dirname, join } from 'pathe';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../..');

const GuideChange = type({
  id: 'string',
  'detection?': { 'glob?': 'string', 'matches?': 'string[]', 'contains?': 'string[]' },
});

const GuideFrontMatter = type({ changes: GuideChange.array() });

export type GuideChange = typeof GuideChange.infer;

/** The changes the front matter of the guide at `guidePath`, relative to the repository root, lists. */
export function guideChanges(guidePath: string): readonly GuideChange[] {
  const frontMatter = GuideFrontMatter(
    matter(readFileSync(join(repoRoot, guidePath), 'utf8')).data,
  );
  if (frontMatter instanceof type.errors) throw new Error(`${guidePath}: ${frontMatter.summary}`);
  return frontMatter.changes;
}

/** Change `id` of the guide at `guidePath`. Throws when the guide has no such change. */
export function guideChange(guidePath: string, id: string): GuideChange {
  const change = guideChanges(guidePath).find((candidate) => candidate.id === id);
  if (change === undefined) throw new Error(`${guidePath} has no change ${id}`);
  return change;
}

/** The patterns of a change's detection, compiled with `new RegExp` as the upgrade references tell an agent to run them. Throws when the change has none. */
export function patternsOf(change: GuideChange): readonly RegExp[] {
  const patterns = change.detection?.matches ?? [];
  if (patterns.length === 0) throw new Error(`Change ${change.id} has no detection pattern`);
  return patterns.map((pattern) => new RegExp(pattern));
}

/** The detection patterns of change `id` of the guide at `guidePath`. Throws when the guide has no such change or it has no pattern. */
export function detectionPatterns(guidePath: string, id: string): readonly RegExp[] {
  return patternsOf(guideChange(guidePath, id));
}
