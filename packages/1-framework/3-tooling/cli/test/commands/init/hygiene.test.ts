import { describe, expect, it } from 'vitest';
import {
  mergeGitattributes,
  requiredGitattributesLines,
} from '../../../src/commands/init/hygiene-gitattributes';
import {
  mergeGitignore,
  REQUIRED_GITIGNORE_ENTRIES,
} from '../../../src/commands/init/hygiene-gitignore';
import {
  ensureEsmModuleType,
  mergePackageScripts,
  REQUIRED_SCRIPTS,
} from '../../../src/commands/init/hygiene-package-scripts';

// ---------------------------------------------------------------------------
// FR3.3 — .gitignore merge
// ---------------------------------------------------------------------------

describe('mergeGitignore (FR3.3)', () => {
  it('writes the full required entry list when the file does not exist', () => {
    const result = mergeGitignore(undefined);
    expect(result).toBe(`${REQUIRED_GITIGNORE_ENTRIES.join('\n')}\n`);
  });

  it('appends only the missing entries when some are already present', () => {
    const existing = 'node_modules/\n';
    const result = mergeGitignore(existing);
    expect(result).toBe('node_modules/\ndist/\n.env\n');
  });

  it('returns null when every required entry is already present (idempotent)', () => {
    const existing = 'node_modules/\ndist/\n.env\n';
    expect(mergeGitignore(existing)).toBeNull();
  });

  it('does not duplicate entries on a re-run (FR9.3)', () => {
    const first = mergeGitignore('node_modules/\n');
    expect(first).not.toBeNull();
    const second = mergeGitignore(first ?? '');
    expect(second).toBeNull();
  });

  it('preserves user-authored comments and blank lines', () => {
    const existing = '# top-level comment\n\nnode_modules/\n# trailing\n';
    const result = mergeGitignore(existing);
    expect(result).toContain('# top-level comment');
    expect(result).toContain('# trailing');
    expect(result).toContain('dist/');
    expect(result).toContain('.env');
  });

  it('treats node_modules without trailing slash as a different entry', () => {
    // The AC pins the trailing-slash form; we don't conflate the two
    // because git treats them differently (slash restricts to dirs).
    const result = mergeGitignore('node_modules\n');
    expect(result).toContain('node_modules\n');
    expect(result).toContain('node_modules/');
  });

  it('appends a leading newline when the existing file lacks one', () => {
    const result = mergeGitignore('node_modules/');
    expect(result).toBe('node_modules/\ndist/\n.env\n');
  });

  it('does not produce a leading blank line when the existing file is empty', () => {
    const result = mergeGitignore('');
    expect(result).toBe(`${REQUIRED_GITIGNORE_ENTRIES.join('\n')}\n`);
    expect(result?.startsWith('\n')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// FR3.4 — .gitattributes merge
// ---------------------------------------------------------------------------

describe('requiredGitattributesLines (FR3.4)', () => {
  it('emits linguist-generated lines for the schema directory', () => {
    const lines = requiredGitattributesLines('src/prisma', 'postgres');
    expect(lines).toContain('src/prisma/contract.json linguist-generated');
    expect(lines).toContain('src/prisma/contract.d.ts linguist-generated');
  });

  it('includes forward-looking artifacts (Decision 5)', () => {
    const lines = requiredGitattributesLines('prisma', 'postgres');
    expect(lines).toContain('prisma/ops.json linguist-generated');
    expect(lines).toContain('prisma/migration.json linguist-generated');
  });

  it('includes migrations-root-anchored lines for the contract snapshot store', () => {
    const lines = requiredGitattributesLines('prisma', 'postgres');
    expect(lines).toContain('migrations/snapshots/**/contract.json linguist-generated');
    expect(lines).toContain('migrations/snapshots/**/contract.d.ts linguist-generated');
  });

  it('keeps the store lines migrations-root-anchored regardless of schema dir', () => {
    const lines = requiredGitattributesLines('src/prisma', 'mongo');
    expect(lines).toContain('migrations/snapshots/**/contract.json linguist-generated');
    expect(lines).toContain('migrations/snapshots/**/contract.d.ts linguist-generated');
    expect(lines).not.toContain(
      'src/prisma/migrations/snapshots/**/contract.json linguist-generated',
    );
  });

  it('respects a non-default schema directory', () => {
    const lines = requiredGitattributesLines('db', 'mongo');
    expect(lines).toContain('db/contract.json linguist-generated');
    // No prisma/ leakage when the schema lives elsewhere.
    expect(lines.every((line) => !line.startsWith('prisma/'))).toBe(true);
  });

  it('strips a trailing slash from the schema directory', () => {
    const lines = requiredGitattributesLines('src/prisma/', 'postgres');
    expect(lines).toContain('src/prisma/contract.json linguist-generated');
    expect(lines.every((line) => !line.startsWith('src/prisma//'))).toBe(true);
  });

  it('emits root-relative paths (no leading "./") when schemaDir is "."', () => {
    const lines = requiredGitattributesLines('.', 'postgres');
    expect(lines).toContain('contract.json linguist-generated');
    expect(lines).toContain('contract.d.ts linguist-generated');
    expect(lines.every((line) => !line.startsWith('./'))).toBe(true);
  });
});

describe('mergeGitattributes (FR3.4)', () => {
  const required = requiredGitattributesLines('src/prisma', 'postgres');

  it('writes the full required line list when the file does not exist', () => {
    const result = mergeGitattributes(undefined, required);
    expect(result).not.toBeNull();
    for (const line of required) {
      expect(result).toContain(line);
    }
  });

  it('appends only the missing lines when some are already present', () => {
    const existing = 'src/prisma/contract.json linguist-generated\n';
    const result = mergeGitattributes(existing, required);
    expect(result).not.toBeNull();
    expect(result).toContain('src/prisma/contract.json linguist-generated');
    expect(result).toContain('src/prisma/contract.d.ts linguist-generated');
    // Pre-existing line should appear exactly once.
    const occurrences =
      (result ?? '').split('src/prisma/contract.json linguist-generated').length - 1;
    expect(occurrences).toBe(1);
  });

  it('returns null when every required line is already present (idempotent / FR9.3)', () => {
    const existing = `${required.join('\n')}\n`;
    expect(mergeGitattributes(existing, required)).toBeNull();
  });

  it('preserves unrelated user-authored attribute lines', () => {
    const existing = '*.lock binary\n';
    const result = mergeGitattributes(existing, required);
    expect(result).toContain('*.lock binary');
    expect(result).toContain('src/prisma/contract.json linguist-generated');
  });

  it('does not produce a leading blank line when the existing file is empty', () => {
    const result = mergeGitattributes('', required);
    expect(result).toBe(`${required.join('\n')}\n`);
    expect(result?.startsWith('\n')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// FR3.5 — package.json#scripts merge with collision detection
// ---------------------------------------------------------------------------

describe('mergePackageScripts (FR3.5)', () => {
  it('adds the contract:emit script when scripts is missing entirely', () => {
    const pkg = JSON.stringify({ name: 'app' }, null, 2);
    const { content, warnings } = mergePackageScripts(pkg, REQUIRED_SCRIPTS);
    expect(content).not.toBeNull();
    expect(warnings).toEqual([]);
    const parsed = JSON.parse(content ?? '');
    expect(parsed.scripts).toEqual({ 'contract:emit': 'prisma contract emit' });
  });

  it('preserves existing user scripts and appends contract:emit', () => {
    const pkg = JSON.stringify({ name: 'app', scripts: { build: 'tsc', test: 'vitest' } }, null, 2);
    const { content, warnings } = mergePackageScripts(pkg, REQUIRED_SCRIPTS);
    expect(content).not.toBeNull();
    expect(warnings).toEqual([]);
    const parsed = JSON.parse(content ?? '');
    expect(parsed.scripts).toEqual({
      build: 'tsc',
      test: 'vitest',
      'contract:emit': 'prisma contract emit',
    });
  });

  it('returns null content when contract:emit is already correct (idempotent / FR9.3)', () => {
    const pkg = JSON.stringify(
      { name: 'app', scripts: { 'contract:emit': 'prisma contract emit' } },
      null,
      2,
    );
    const { content, warnings } = mergePackageScripts(pkg, REQUIRED_SCRIPTS);
    expect(content).toBeNull();
    expect(warnings).toEqual([]);
  });

  it('warns and skips when an existing script name maps to a different command (FR3.5)', () => {
    const pkg = JSON.stringify(
      { name: 'app', scripts: { 'contract:emit': './scripts/custom-emit.sh' } },
      null,
      2,
    );
    const { content, warnings } = mergePackageScripts(pkg, REQUIRED_SCRIPTS);
    expect(content).toBeNull();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('"contract:emit"');
    expect(warnings[0]).toContain('./scripts/custom-emit.sh');
    expect(warnings[0]).toContain('prisma contract emit');
  });

  it("preserves the user's key order (no reshuffle)", () => {
    const pkg = JSON.stringify({ name: 'app', scripts: { z: 'last', a: 'first' } }, null, 2);
    const { content } = mergePackageScripts(pkg, REQUIRED_SCRIPTS);
    expect(content).not.toBeNull();
    const keys = Object.keys(JSON.parse(content ?? '').scripts as Record<string, string>);
    // New entry appends; existing keep their relative order.
    expect(keys).toEqual(['z', 'a', 'contract:emit']);
  });

  it('preserves the trailing newline if the input had one', () => {
    const pkg = `${JSON.stringify({ name: 'app' }, null, 2)}\n`;
    const { content } = mergePackageScripts(pkg, REQUIRED_SCRIPTS);
    expect(content?.endsWith('\n')).toBe(true);
  });

  it('does not add a trailing newline if the input lacked one', () => {
    const pkg = JSON.stringify({ name: 'app' }, null, 2);
    const { content } = mergePackageScripts(pkg, REQUIRED_SCRIPTS);
    expect(content?.endsWith('\n')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// `"type": "module"` enforcement — TML-2494
//
// The scaffolded `prisma/db.ts` uses the ESM-only `with { type: 'json' }`
// import attribute. Without `"type": "module"` in package.json Node either
// emits a MODULE_TYPELESS_PACKAGE_JSON warning (Node 22+ with strip-types)
// or hard-fails on older setups. `init` must align the manifest with the
// code it scaffolds.
// ---------------------------------------------------------------------------

describe('ensureEsmModuleType (TML-2494)', () => {
  it('adds "type": "module" when the field is missing', () => {
    const pkg = JSON.stringify({ name: 'app' }, null, 2);
    const { content, warning } = ensureEsmModuleType(pkg);
    expect(warning).toBeNull();
    expect(content).not.toBeNull();
    const parsed = JSON.parse(content ?? '');
    expect(parsed.type).toBe('module');
  });

  it('returns null content when "type": "module" is already set (idempotent)', () => {
    const pkg = JSON.stringify({ name: 'app', type: 'module' }, null, 2);
    const { content, warning } = ensureEsmModuleType(pkg);
    expect(content).toBeNull();
    expect(warning).toBeNull();
  });

  it('warns and skips when the user explicitly set "type": "commonjs"', () => {
    const pkg = JSON.stringify({ name: 'app', type: 'commonjs' }, null, 2);
    const { content, warning } = ensureEsmModuleType(pkg);
    expect(content).toBeNull();
    expect(warning).not.toBeNull();
    expect(warning).toContain('"type": "commonjs"');
    expect(warning).toContain('module');
  });

  it('normalises a non-string "type" (e.g. null) to "module" without leaving the bogus value', () => {
    const pkg = JSON.stringify({ name: 'app', type: null }, null, 2);
    const { content, warning } = ensureEsmModuleType(pkg);
    expect(warning).toBeNull();
    expect(content).not.toBeNull();
    const parsed = JSON.parse(content ?? '');
    expect(parsed.type).toBe('module');
  });

  it('preserves the trailing newline if the input had one', () => {
    const pkg = `${JSON.stringify({ name: 'app' }, null, 2)}\n`;
    const { content } = ensureEsmModuleType(pkg);
    expect(content?.endsWith('\n')).toBe(true);
  });

  it('does not add a trailing newline if the input lacked one', () => {
    const pkg = JSON.stringify({ name: 'app' }, null, 2);
    const { content } = ensureEsmModuleType(pkg);
    expect(content?.endsWith('\n')).toBe(false);
  });

  it('places "type" right after "name" for readable diffs when name is present', () => {
    const pkg = JSON.stringify({ name: 'app', version: '1.0.0', dependencies: {} }, null, 2);
    const { content } = ensureEsmModuleType(pkg);
    expect(content).not.toBeNull();
    const keys = Object.keys(JSON.parse(content ?? ''));
    expect(keys).toEqual(['name', 'type', 'version', 'dependencies']);
  });
});
