#!/usr/bin/env node

import { execSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  participatesInLockstep,
  rewriteWorkspaceDeps,
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

let updatedCount = 0;

// Every workspace package — publishable, private, and the workspace
// root — gets the same version. Lockstep is the invariant that lets a
// single read of the root `package.json` answer "what version are we
// shipping right now?"; if private packages drifted, that invariant
// would be silently violated by direct invocations of this script.
for (const pkg of workspacePackages) {
  const packageJsonPath = path.join(pkg.path, 'package.json');
  const content = await fs.readFile(packageJsonPath, 'utf-8');
  const packageJson: PackageJson = JSON.parse(content);

  packageJson.version = version;
  rewriteWorkspaceDeps(packageJson, version);
  await fs.writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);

  console.log(`Updated ${pkg.name} to ${version}`);
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
  rewriteWorkspaceDeps(packageJson, version);
  await fs.writeFile(manifestPath, `${JSON.stringify(packageJson, null, 2)}\n`);
  console.log(
    `Updated ${path.relative(rootDir, manifestPath)} (project-boundary manifest) to ${version}`,
  );
  updatedCount++;
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
