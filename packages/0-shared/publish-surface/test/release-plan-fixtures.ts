import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packageLevels } from '../src/levels';
import type { PackageKind, ReleasePlan } from '../src/release-plan';
import { publicShells } from '../src/shells';

const SCOPE = '@prisma/orm-';

const publishedRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '9-public',
  '@prisma',
);

/** The published packages as the repository holds them: who names whom, what kind each is, and its level. */
export function realGraph() {
  const manifests: { name: string; peerDependencies?: Record<string, string> }[] = readdirSync(
    publishedRoot,
  ).map((dir) => JSON.parse(readFileSync(join(publishedRoot, dir, 'package.json'), 'utf8')));
  const uses: Record<string, readonly string[]> = Object.fromEntries(
    manifests.map((manifest) => [
      manifest.name,
      Object.keys(manifest.peerDependencies ?? {}).filter((peer) => peer.startsWith(SCOPE)),
    ]),
  );
  const kinds: Record<string, PackageKind> = {
    ...Object.fromEntries([...publicShells].map(([name, shell]) => [name, shell.kind])),
    '@prisma/orm-better-auth': 'library-integration',
  };
  return {
    levels: packageLevels,
    kinds,
    uses,
    currentAll: (version: string): Record<string, string> =>
      Object.fromEntries(manifests.map((manifest) => [manifest.name, version])),
    gaPackages: (): ReadonlySet<string> =>
      new Set([...packageLevels].filter(([, level]) => level === 'ga').map(([name]) => name)),
  };
}

function rowsOf(plan: ReleasePlan): string[] {
  return Object.entries(plan)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, planned]) => {
      const ranges = Object.entries(planned.ranges)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([named, range]) => `${named.slice(SCOPE.length)} ${range}`);
      return [
        name.slice(SCOPE.length),
        planned.version,
        planned.tag,
        ranges.length === 0 ? '-' : ranges.join(', '),
      ].join(' ');
    });
}

function parseRows(text: string): string[] {
  return text
    .trim()
    .split('\n')
    .map((line) => line.trim().replace(/ {2,}/g, ' '));
}

/** A plan as table rows, and a written table in the same form, so the two compare line by line. */
export const planTable = Object.assign(rowsOf, {
  parse: parseRows,
  versions: (text: string): Record<string, string> =>
    Object.fromEntries(
      parseRows(text).map((row) => {
        const [name, version] = row.split(' ');
        return [`${SCOPE}${name}`, version ?? ''];
      }),
    ),
});
