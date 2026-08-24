/**
 * The `prisma-8` agent skill ships inside the tarball of every package an
 * application depends on directly, so the skill a user has always describes
 * the version they installed.
 *
 * That claim is only worth as much as the artifact that proves it, and every
 * way it can break is invisible to a test that inspects the working tree: the
 * manifest can list `"skills"` in `files` while `prepack` staged nothing; the
 * staged copy can be a leftover from an older run; `.gitignore` ignores the
 * staged directory, and a packer that consults ignore rules would drop it from
 * the tarball while leaving it on disk. So this packs each package the way the
 * publish workflow does and reads the skill back out of the tarball.
 *
 * Deleting the staged tree first is what makes `prepack` the only thing that
 * can produce what the tarball carries — including the relative path it
 * invokes the sync script through.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { publicShells, type ShellName } from '../src/shells';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const facades: ShellName[] = ['@prisma/orm-postgres', '@prisma/orm-sqlite', '@prisma/orm-mongo'];
const SKILL_NAME = 'prisma-8';

interface Manifest {
  readonly version: string;
  readonly files?: readonly string[];
  readonly scripts?: Readonly<Record<string, string>>;
}

function packageDir(facade: ShellName): string {
  const shell = publicShells.get(facade);
  if (shell === undefined) throw new Error(`unknown shell ${facade}`);
  return join(repoRoot, shell.dir);
}

function manifestAt(dir: string): Manifest {
  const manifest: Manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  return manifest;
}

/**
 * One entry of the frontmatter `metadata` map, where the Agent Skills spec
 * puts extensions like our version stamp.
 */
function metadataValue(skillMd: string, key: string): string | undefined {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(skillMd)?.[1];
  if (frontmatter === undefined) return undefined;
  const metadata = /^metadata:\s*\n((?:[ \t]+.*\n?)+)/m.exec(frontmatter)?.[1];
  if (metadata === undefined) return undefined;
  const value = new RegExp(`^\\s+${key}: *(.+)$`, 'm').exec(metadata)?.[1];
  return value?.trim().replace(/^['"]|['"]$/g, '');
}

/** Every file under `dir`, as paths relative to it, sorted. */
function filesUnder(dir: string): readonly string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf-8' })
    .filter((entry) => statSync(join(dir, entry)).isFile())
    .sort();
}

const workspaces: string[] = [];

afterAll(() => {
  for (const dir of workspaces) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * Packs the package the way the publish workflow does — `pnpm pack`, which
 * runs the same `prepack` — and unpacks the result. Returns the tarball's
 * `package/` root.
 */
function packAndUnpack(facade: ShellName): string {
  const work = mkdtempSync(join(tmpdir(), 'skill-packaging-'));
  workspaces.push(work);
  // Only `prepack` may supply what the tarball carries.
  rmSync(join(packageDir(facade), 'skills'), { recursive: true, force: true });
  execFileSync('pnpm', ['pack', '--pack-destination', work], {
    cwd: packageDir(facade),
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  const tarball = readdirSync(work).find((file) => file.endsWith('.tgz'));
  if (tarball === undefined) throw new Error(`pnpm pack produced no tarball for ${facade}`);
  execFileSync('tar', ['xzf', tarball], { cwd: work });
  return join(work, 'package');
}

describe('the skill source in the repository', () => {
  it('carries the stamp the version sweep maintains', () => {
    const rootVersion = manifestAt(repoRoot).version;
    const source = readFileSync(join(repoRoot, 'skills', SKILL_NAME, 'SKILL.md'), 'utf8');
    expect(metadataValue(source, 'library_version')).toBe(rootVersion);
  });
});

describe.each(facades)('%s', (facade) => {
  it('publishes the skills directory', () => {
    expect(manifestAt(packageDir(facade)).files).toContain('skills');
  });

  it('refreshes the skill tree on prepack', () => {
    expect(manifestAt(packageDir(facade)).scripts?.['prepack']).toContain(
      `sync-package-skills.ts ${facade}`,
    );
  });

  it('carries the whole skill tree in its tarball, stamped with what shipped it', () => {
    const packedRoot = packAndUnpack(facade);
    const packedSkillDir = join(packedRoot, 'skills', SKILL_NAME);

    expect(
      existsSync(join(packedSkillDir, 'SKILL.md')),
      `the ${facade} tarball has no skills/${SKILL_NAME}/SKILL.md`,
    ).toBe(true);

    const packedSkill = readFileSync(join(packedSkillDir, 'SKILL.md'), 'utf8');
    expect(metadataValue(packedSkill, 'library')).toBe(facade);
    expect(metadataValue(packedSkill, 'library_version')).toBe(manifestAt(packedRoot).version);

    // The tarball and the repository's tracked tree must serve the same
    // instructions: the only difference is the package each copy names.
    const sourceDir = join(repoRoot, 'skills', SKILL_NAME);
    expect(filesUnder(packedSkillDir)).toEqual(filesUnder(sourceDir));
    for (const file of filesUnder(sourceDir)) {
      if (file === 'SKILL.md') continue;
      expect(readFileSync(join(packedSkillDir, file), 'utf8')).toBe(
        readFileSync(join(sourceDir, file), 'utf8'),
      );
    }
    const sourceSkill = readFileSync(join(sourceDir, 'SKILL.md'), 'utf8');
    expect(packedSkill).toBe(sourceSkill.replace(/^(\s+)library:.*$/m, `$1library: '${facade}'`));
  }, 60_000);
});
