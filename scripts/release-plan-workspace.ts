// The release plan for this workspace: the plan from
// `packages/0-shared/publish-surface/src/release-plan.ts`, fed with the published packages'
// manifests, their declared levels and kinds. The scripts load the publish-surface sources directly,
// because they run before the workspace is built.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { packageKinds, packageLevels } from '../packages/0-shared/publish-surface/src/levels.ts';
import {
  type DeclaredLevel,
  isNumberedOnItsOwn,
  type PublishedManifest,
  planInputFor,
  planRelease,
  type ReleasePlan,
  releaseOfRootVersion,
} from '../packages/0-shared/publish-surface/src/release-plan.ts';
import { publicShells } from '../packages/0-shared/publish-surface/src/shells.ts';

export const PUBLISHED_DIR = join('packages', '9-public', '@prisma');

export interface WorkspaceManifest extends PublishedManifest {
  readonly private?: boolean;
}

/** The manifest of every package under `packages/9-public/@prisma`, by its folder. */
export function readPublishedManifests(rootDir: string): Map<string, WorkspaceManifest> {
  const manifests = new Map<string, WorkspaceManifest>();
  for (const dir of readdirSync(join(rootDir, PUBLISHED_DIR)).sort()) {
    const manifest: WorkspaceManifest = JSON.parse(
      readFileSync(join(rootDir, PUBLISHED_DIR, dir, 'package.json'), 'utf-8'),
    );
    if (manifest.private !== true) manifests.set(join(PUBLISHED_DIR, dir), manifest);
  }
  return manifests;
}

/** The plan for `rootVersion`, from the published manifests as they are on disk. */
export function planWorkspace(
  rootDir: string,
  rootVersion: string,
  everGa: ReadonlySet<string> = new Set(),
): ReleasePlan {
  return planFrom([...readPublishedManifests(rootDir).values()], rootVersion, everGa);
}

/**
 * The plan for a later release, reached from the workspace's manifests one release at a time: from
 * the `8.0.0` release candidates through `8.0.0` and each minor after it, so a package's version at
 * the asked release follows from the one it had at the release before, as it will when the releases
 * are cut. For printing what a release will hold; `planWorkspace` plans the root version itself.
 */
export function planWorkspaceThrough(
  rootDir: string,
  rootVersion: string,
  everGa: ReadonlySet<string> = new Set(),
): { readonly plan: ReleasePlan; readonly previous: Readonly<Record<string, string>> } {
  const target = releaseOfRootVersion(rootVersion);
  let manifests: PublishedManifest[] = [...readPublishedManifests(rootDir).values()];
  const first = releaseOfRootVersion(
    manifests.find((manifest) => !isNumberedOnItsOwn(packageLevels.get(manifest.name)))?.version ??
      rootVersion,
  );
  const steps: string[] = [];
  if (first.line === 'release-candidates' && target.line === 'levels') {
    for (let minor = 0; minor < target.release.minor; minor++) {
      steps.push(`${target.release.major}.${minor}.0`);
    }
  }
  for (const step of steps) {
    const plan = planFrom(manifests, step, everGa);
    manifests = manifests.map((manifest) => ({
      ...manifest,
      version: plan[manifest.name]?.version ?? manifest.version,
    }));
  }
  return {
    plan: planFrom(manifests, rootVersion, everGa),
    previous:
      steps.length === 0
        ? {}
        : Object.fromEntries(manifests.map((manifest) => [manifest.name, manifest.version])),
  };
}

function planFrom(
  manifests: readonly PublishedManifest[],
  rootVersion: string,
  everGa: ReadonlySet<string>,
): ReleasePlan {
  return planRelease(
    planInputFor({
      rootVersion,
      manifests,
      levels: packageLevels,
      kinds: packageKinds(publicShells),
      everGa,
    }),
  );
}

export function levelOf(name: string): DeclaredLevel | undefined {
  return packageLevels.get(name);
}

/**
 * A plan as a table: package, level, version, tag, and the range on each package it names. A version
 * the package already had at the release before is marked as already published: there is nothing new
 * of it to publish.
 */
export function formatPlanTable(
  plan: ReleasePlan,
  previous: Readonly<Record<string, string>> = {},
): string {
  const rows = Object.entries(plan)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, planned]) => {
      const level = packageLevels.get(name);
      const ranges = Object.entries(planned.ranges)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([named, range]) => `${named} ${range}`);
      return [
        name,
        level === undefined ? '?' : isNumberedOnItsOwn(level) ? 'own-version' : level,
        previous[name] === planned.version
          ? `${planned.version} (already published)`
          : planned.version,
        planned.tag,
        ranges.length === 0 ? '-' : ranges.join(', '),
      ];
    });
  const widths = [0, 1, 2, 3].map((column) =>
    Math.max(...rows.map((row) => (row[column] ?? '').length)),
  );
  return `${rows
    .map((row) =>
      row.map((cell, column) => (column < 4 ? cell.padEnd(widths[column] ?? 0) : cell)).join('  '),
    )
    .join('\n')}\n`;
}

export { releaseOfRootVersion };
