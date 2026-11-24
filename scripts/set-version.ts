#!/usr/bin/env node

import { execSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { planWorkspace, releaseOfRootVersion } from './release-plan-workspace.ts';
import {
  participatesInLockstep,
  restampExtensionVersion,
  rewriteManifestByPlan,
  rewriteWorkspaceDepsByPlan,
  stampSkillMetadata,
} from './set-version-utils.ts';

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const version = process.argv[2];

if (!version) {
  const script = path.relative(process.cwd(), process.argv[1]);
  console.error(`Usage: node ${script} <version>`);
  console.error(`Example: node ${script} 0.1.0-dev.123`);
  process.exit(1);
}

interface PnpmPackage {
  name: string;
  version: string;
  path: string;
  private: boolean;
}

interface PackageJson {
  name: string;
  version: string;
  private?: boolean;
  [key: string]: unknown;
}

const output = execSync('pnpm list -r --json', {
  cwd: rootDir,
  encoding: 'utf-8',
});

const workspacePackages: PnpmPackage[] = JSON.parse(output);

const previousVersion: string = JSON.parse(
  await fs.readFile(path.join(rootDir, 'package.json'), 'utf-8'),
).version;

let updatedCount = 0;

// Each published package's version and its specifiers on ours come from the release plan, read
// from the manifests before anything is rewritten. On the 8.0.0 release candidates that is the root
// version everywhere, as it always was. Private packages, examples, apps and the root follow the
// root version, so a single read of the root `package.json` still says which release this is.
const plan = planWorkspace(rootDir, version);
const { line } = releaseOfRootVersion(version);
const published = new Set(Object.keys(plan));

for (const pkg of workspacePackages) {
  const packageJsonPath = path.join(pkg.path, 'package.json');
  const content = await fs.readFile(packageJsonPath, 'utf-8');
  const packageJson: PackageJson = JSON.parse(content);
  rewriteManifestByPlan(packageJson, { version, line, plan });
  await fs.writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);

  console.log(`Updated ${pkg.name} to ${packageJson.version}`);
  updatedCount++;
}

// Project-boundary manifests (tracked package.json files that are not
// workspace members but carry `workspace:` pins, e.g. the per-database
// halves of examples/bundle-size) version in lockstep too. Without this
// sweep they go stale on every bump and fail at install once the old
// version leaves the registry.
const memberPaths = new Set(workspacePackages.map((pkg) => path.join(pkg.path, 'package.json')));
const trackedManifests = execSync("git ls-files -- '*package.json'", {
  cwd: rootDir,
  encoding: 'utf-8',
})
  .split('\n')
  .filter(Boolean)
  .map((rel) => path.join(rootDir, rel))
  .filter((abs) => !memberPaths.has(abs));

for (const manifestPath of trackedManifests) {
  const packageJson: PackageJson = JSON.parse(await fs.readFile(manifestPath, 'utf-8'));
  if (!participatesInLockstep(packageJson)) continue;
  packageJson.version = version;
  rewriteWorkspaceDepsByPlan(packageJson, {
    rootVersion: version,
    line,
    published,
    ranges: undefined,
  });
  await fs.writeFile(manifestPath, `${JSON.stringify(packageJson, null, 2)}\n`);
  console.log(
    `Updated ${path.relative(rootDir, manifestPath)} (project-boundary manifest) to ${version}`,
  );
  updatedCount++;
}

// Extension packs stamp their own package version into every contract they
// contribute to, so the tracked emitted artefacts (examples and extension
// test fixtures) carry the old version after a bump and `fixtures:check`
// diffs them. Restamping here is exactly the change a re-emit would make.
// Migration snapshots are content-addressed and are never rewritten.
const trackedArtefacts = execSync("git ls-files -- '*contract.json' '*contract.d.ts'", {
  cwd: rootDir,
  encoding: 'utf-8',
})
  .split('\n')
  .filter((rel) => rel && !/(^|\/)migrations\/snapshots\//.test(rel));

for (const rel of trackedArtefacts) {
  const artefactPath = path.join(rootDir, rel);
  const before = await fs.readFile(artefactPath, 'utf-8');
  const after = restampExtensionVersion(before, previousVersion, version);
  if (after === before) continue;
  await fs.writeFile(artefactPath, after);
  console.log(`Restamped extension version in ${rel}`);
}

// The user-facing skills ship inside the `@prisma/orm-*` tarballs and carry
// the version they were published with in their frontmatter, so a consumer
// can tell whether its synced copy still matches its installed packages.
const skillPath = path.join(rootDir, 'skills', 'prisma-8', 'SKILL.md');
await fs.writeFile(
  skillPath,
  stampSkillMetadata(await fs.readFile(skillPath, 'utf-8'), 'library_version', version),
);
console.log(`Stamped ${path.relative(rootDir, skillPath)} with library_version ${version}`);

console.log(`\nDone! Updated ${updatedCount} packages.`);
