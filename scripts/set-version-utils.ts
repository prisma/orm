// Pure helpers consumed by `set-version.ts`. Kept side-effect-free so
// the unit tests in `set-version-utils.test.ts` can exercise them
// without running the full publish-time version-stamp pipeline.

export interface MutablePackageJson {
  name?: string;
  version?: string;
  private?: boolean;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  [key: string]: unknown;
}

const DEP_FIELDS = [
  'dependencies',
  'peerDependencies',
  'devDependencies',
  'optionalDependencies',
] as const;

/**
 * Rewrite every workspace dep spec in `packageJson` to
 * `workspace:<version>`. Mutates in place. Idempotent: re-running with the
 * same version is a no-op.
 *
 * The literal-version form is the mechanism that gives every published
 * package an exact-version pin on its siblings: pnpm rewrites
 * `workspace:<X.Y.Z>` to exactly `X.Y.Z` at publish time, while resolving to
 * the local workspace package during development.
 *
 * Every scope is rewritten rather than one, because every package in this
 * workspace is versioned in lockstep — the published `@prisma/orm-*` shells,
 * the internal `@internal/*` packages they are built from, and the
 * `@internal/*` development packages alike. Singling out one scope would leave
 * the others pinned at whatever version they were last released under.
 *
 * Non-workspace specs (e.g. caret ranges from the registry, catalog entries)
 * are intentionally left alone; only `workspace:` specifiers are rewritten.
 */
export function rewriteWorkspaceDeps(packageJson: MutablePackageJson, version: string): void {
  for (const field of DEP_FIELDS) {
    const deps = packageJson[field];
    if (!deps) continue;
    for (const [name, spec] of Object.entries(deps)) {
      if (typeof spec !== 'string' || !spec.startsWith('workspace:')) continue;
      deps[name] = `workspace:${version}`;
    }
  }
}

/**
 * Whether a manifest that is NOT a workspace member still versions in
 * lockstep with the workspace. A `workspace:` dep spec is the tell:
 * project-boundary manifests (e.g. `examples/bundle-size/src/postgres`,
 * which exists so the emitter can resolve an import root per database)
 * pin workspace packages and go stale on every bump unless swept.
 * Fixture manifests with only registry-style specs are test data and
 * must be left alone.
 */
export function participatesInLockstep(packageJson: MutablePackageJson): boolean {
  for (const field of DEP_FIELDS) {
    const deps = packageJson[field];
    if (!deps) continue;
    for (const spec of Object.values(deps)) {
      if (typeof spec === 'string' && spec.startsWith('workspace:')) return true;
    }
  }
  return false;
}

/**
 * Rewrite one key of a `SKILL.md`'s frontmatter `metadata` map, leaving the
 * rest of the file untouched. Mutation is confined to the metadata block, so
 * the same words appearing in the skill's description or prose are left alone.
 *
 * The Agent Skills spec defines `name` and `description` at the top level and
 * reserves `metadata` (a string-to-string map) for everything else, so the
 * version stamp lives there rather than as a key of our own invention. The
 * value is written quoted: a version is a string, and an unquoted one would
 * parse as a number the moment a release is numbered like one.
 *
 * The stamp is what tells a consumer's `prisma skills sync` whether the copy
 * of the skill in its agent directories still describes the installed
 * packages, so it versions in lockstep with everything else the publish
 * pipeline rewrites. A skill that has lost the key throws rather than shipping
 * an unstamped copy that no consumer can compare against.
 */
export function stampSkillMetadata(skillMd: string, key: string, value: string): string {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(skillMd)?.[1];
  if (frontmatter === undefined) throw new Error('SKILL.md has no frontmatter block');

  const lines = frontmatter.split('\n');
  const metadataAt = lines.findIndex((line) => /^metadata:\s*$/.test(line));
  if (metadataAt === -1) throw new Error('SKILL.md frontmatter has no metadata block');

  const entry = new RegExp(`^(\\s+)${key}:.*$`);
  for (let index = metadataAt + 1; index < lines.length; index++) {
    const line = lines[index];
    // The metadata map ends at the first line that is not one of its entries.
    if (line.trim() !== '' && !/^\s/.test(line)) break;
    const match = entry.exec(line);
    if (match === null) continue;
    lines[index] = `${match[1]}${key}: '${value}'`;
    return skillMd.replace(frontmatter, lines.join('\n'));
  }
  throw new Error(`SKILL.md metadata has no ${key} key to stamp`);
}
