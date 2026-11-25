import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { planWorkspace, releaseOfRootVersion } from './release-plan-workspace.ts';
import {
  lockstepManifest,
  type MutablePackageJson,
  rewriteManifestByPlan,
  rewriteWorkspaceDepsByPlan,
} from './set-version-utils.ts';

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const FIELDS = ['dependencies', 'peerDependencies', 'devDependencies', 'optionalDependencies'];

/** The rule before release levels: every manifest at the version, every `workspace:` specifier exact. */
function oneVersionForAll(manifest: MutablePackageJson, version: string): void {
  manifest.version = version;
  for (const field of FIELDS) {
    const deps = manifest[field];
    if (typeof deps !== 'object' || deps === null) continue;
    for (const [name, spec] of Object.entries(deps)) {
      if (typeof spec !== 'string' || !spec.startsWith('workspace:')) continue;
      const alias = /^workspace:((?:@[^/@]+\/)?[^@]+)@/.exec(spec)?.[1];
      Reflect.set(deps, name, alias ? `workspace:${alias}@${version}` : `workspace:${version}`);
    }
  }
}

const tracked = execFileSync('git', ['ls-files', '--', '*package.json'], {
  cwd: rootDir,
  encoding: 'utf-8',
})
  .split('\n')
  .filter(Boolean)
  .map((rel) => join(rootDir, rel));
const members = new Set(
  (
    JSON.parse(
      execFileSync('pnpm', ['list', '-r', '--json', '--depth', '-1'], {
        cwd: rootDir,
        encoding: 'utf-8',
        maxBuffer: 64 * 1024 * 1024,
      }),
    ) as { path: string }[]
  ).map((pkg) => join(pkg.path, 'package.json')),
);

describe('set-version on the 8.0.0 release candidates writes what one version for all wrote', () => {
  for (const version of ['8.0.0-rc.26', '8.0.0-rc.26-dev.3']) {
    it(`for ${version}, over every tracked manifest`, () => {
      const plan = planWorkspace(rootDir, version);
      const { line } = releaseOfRootVersion(version);
      let compared = 0;
      for (const path of tracked) {
        const text = readFileSync(path, 'utf-8');
        const isMember = members.has(path);
        if (!isMember && lockstepManifest(text) === undefined) continue;
        const expected: MutablePackageJson = JSON.parse(text);
        oneVersionForAll(expected, version);
        const written: MutablePackageJson = JSON.parse(text);
        if (isMember) {
          rewriteManifestByPlan(written, { version, line, plan });
        } else {
          written.version = version;
          rewriteWorkspaceDepsByPlan(written, {
            rootVersion: version,
            line,
            published: new Set(Object.keys(plan)),
            ranges: undefined,
          });
        }
        assert.equal(JSON.stringify(written, null, 2), JSON.stringify(expected, null, 2), path);
        compared++;
      }
      assert.ok(compared > 100, `compared ${compared} manifests`);
    });
  }
});
