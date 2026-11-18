import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MigrationToolsError } from '../src/errors';
import type { RefEntry, Refs } from '../src/refs';
import {
  deleteRef,
  readRef,
  readRefs,
  resolveRef,
  resolveRefsByContractHash,
  validateRefName,
  validateRefValue,
  writeRef,
} from '../src/refs';

const HASH_A = `${'a'.repeat(64)}`;
const HASH_B = `${'b'.repeat(64)}`;

const ENTRY_A: RefEntry = { hash: HASH_A, invariants: [] };
const ENTRY_B: RefEntry = { hash: HASH_B, invariants: ['split-user-name'] };

describe('validateRefName', () => {
  it('accepts simple alphanumeric names', () => {
    expect(validateRefName('head')).toBe(true);
    expect(validateRefName('staging')).toBe(true);
    expect(validateRefName('production')).toBe(true);
  });

  it('accepts names with hyphens', () => {
    expect(validateRefName('my-staging')).toBe(true);
    expect(validateRefName('pre-production')).toBe(true);
  });

  it('accepts names with forward slashes', () => {
    expect(validateRefName('envs/staging')).toBe(true);
    expect(validateRefName('team/backend/prod')).toBe(true);
  });

  it('accepts names with digits', () => {
    expect(validateRefName('staging-2')).toBe(true);
    expect(validateRefName('v1')).toBe(true);
  });

  it('rejects empty names', () => {
    expect(validateRefName('')).toBe(false);
  });

  it('rejects names with path traversal sequences', () => {
    expect(validateRefName('..')).toBe(false);
    expect(validateRefName('../etc')).toBe(false);
    expect(validateRefName('envs/../production')).toBe(false);
    expect(validateRefName('./staging')).toBe(false);
  });

  it('rejects names with invalid characters', () => {
    expect(validateRefName('my staging')).toBe(false);
    expect(validateRefName('production!')).toBe(false);
    expect(validateRefName('stage@home')).toBe(false);
    expect(validateRefName('env\\prod')).toBe(false);
  });

  it('rejects names starting or ending with hyphens or slashes', () => {
    expect(validateRefName('-staging')).toBe(false);
    expect(validateRefName('staging-')).toBe(false);
    expect(validateRefName('/staging')).toBe(false);
    expect(validateRefName('staging/')).toBe(false);
  });

  it('rejects names with consecutive slashes', () => {
    expect(validateRefName('envs//staging')).toBe(false);
  });
});

describe('validateRefValue', () => {
  it('accepts the empty sentinel', () => {
    expect(validateRefValue('empty')).toBe(true);
  });

  it('accepts valid 64-char hex hash', () => {
    expect(validateRefValue('a'.repeat(64))).toBe(true);
    expect(validateRefValue('0123456789abcdef'.repeat(4))).toBe(true);
  });

  it('rejects legacy algorithm-prefixed values', () => {
    expect(validateRefValue(`sha256:${'a'.repeat(64)}`)).toBe(false);
    expect(validateRefValue('sha256:empty')).toBe(false);
  });

  it('rejects wrong length hex', () => {
    expect(validateRefValue('abc')).toBe(false);
    expect(validateRefValue('a'.repeat(63))).toBe(false);
    expect(validateRefValue('a'.repeat(65))).toBe(false);
  });

  it('rejects uppercase hex', () => {
    expect(validateRefValue(`${'A'.repeat(64)}`)).toBe(false);
  });

  it('rejects non-hex characters', () => {
    expect(validateRefValue(`${'g'.repeat(64)}`)).toBe(false);
  });

  it('rejects empty string', () => {
    expect(validateRefValue('')).toBe(false);
  });
});

describe('writeRef', () => {
  let refsDir: string;

  beforeEach(async () => {
    refsDir = join(
      tmpdir(),
      `test-refs-write-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
  });

  afterEach(async () => {
    await rm(refsDir, { recursive: true, force: true });
  });

  it('creates ref file with correct JSON', async () => {
    await writeRef(refsDir, 'staging', ENTRY_A);
    const content = JSON.parse(await readFile(join(refsDir, 'staging.json'), 'utf-8'));
    expect(content).toEqual({ hash: HASH_A, invariants: [] });
  });

  it('creates ref file with invariants', async () => {
    await writeRef(refsDir, 'production', ENTRY_B);
    const content = JSON.parse(await readFile(join(refsDir, 'production.json'), 'utf-8'));
    expect(content).toEqual({ hash: HASH_B, invariants: ['split-user-name'] });
  });

  it('creates parent directories for slashed names', async () => {
    await writeRef(refsDir, 'envs/staging', ENTRY_A);
    const content = JSON.parse(await readFile(join(refsDir, 'envs', 'staging.json'), 'utf-8'));
    expect(content).toEqual({ hash: HASH_A, invariants: [] });
  });

  it('creates deeply nested directories for multi-segment names', async () => {
    await writeRef(refsDir, 'team/backend/prod', ENTRY_B);
    const content = JSON.parse(
      await readFile(join(refsDir, 'team', 'backend', 'prod.json'), 'utf-8'),
    );
    expect(content).toEqual({ hash: HASH_B, invariants: ['split-user-name'] });
  });

  it('overwrites existing ref file', async () => {
    await writeRef(refsDir, 'staging', ENTRY_A);
    await writeRef(refsDir, 'staging', ENTRY_B);
    const content = JSON.parse(await readFile(join(refsDir, 'staging.json'), 'utf-8'));
    expect(content).toEqual({ hash: HASH_B, invariants: ['split-user-name'] });
  });

  it('rejects invalid ref names', async () => {
    try {
      await writeRef(refsDir, '../escape', ENTRY_A);
      expect.fail('expected error');
    } catch (e) {
      expect(MigrationToolsError.is(e)).toBe(true);
      expect((e as MigrationToolsError).code).toBe('MIGRATION.INVALID_REF_NAME');
    }
  });

  it('rejects invalid hash values', async () => {
    try {
      await writeRef(refsDir, 'staging', { hash: 'not-a-hash', invariants: [] });
      expect.fail('expected error');
    } catch (e) {
      expect(MigrationToolsError.is(e)).toBe(true);
      expect((e as MigrationToolsError).code).toBe('MIGRATION.INVALID_REF_VALUE');
    }
  });
});

describe('readRef', () => {
  let refsDir: string;

  beforeEach(async () => {
    refsDir = join(tmpdir(), `test-refs-read-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(refsDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(refsDir, { recursive: true, force: true });
  });

  it('reads a valid ref file', async () => {
    await writeFile(join(refsDir, 'staging.json'), JSON.stringify(ENTRY_A));
    const entry = await readRef(refsDir, 'staging');
    expect(entry).toEqual(ENTRY_A);
  });

  it('reads a ref with slashed name', async () => {
    await mkdir(join(refsDir, 'envs'), { recursive: true });
    await writeFile(join(refsDir, 'envs', 'staging.json'), JSON.stringify(ENTRY_A));
    const entry = await readRef(refsDir, 'envs/staging');
    expect(entry).toEqual(ENTRY_A);
  });

  it('throws UNKNOWN_REF for non-existent ref', async () => {
    try {
      await readRef(refsDir, 'nonexistent');
      expect.fail('expected error');
    } catch (e) {
      expect(MigrationToolsError.is(e)).toBe(true);
      expect((e as MigrationToolsError).code).toBe('MIGRATION.UNKNOWN_REF');
    }
  });

  it('throws UNKNOWN_REF when refs directory does not exist', async () => {
    const missingDir = join(refsDir, 'does-not-exist');
    try {
      await readRef(missingDir, 'staging');
      expect.fail('expected error');
    } catch (e) {
      expect(MigrationToolsError.is(e)).toBe(true);
      expect((e as MigrationToolsError).code).toBe('MIGRATION.UNKNOWN_REF');
    }
  });

  it('throws INVALID_REF_FILE on malformed JSON', async () => {
    await writeFile(join(refsDir, 'staging.json'), '{not valid json');
    try {
      await readRef(refsDir, 'staging');
      expect.fail('expected error');
    } catch (e) {
      expect(MigrationToolsError.is(e)).toBe(true);
      expect((e as MigrationToolsError).code).toBe('MIGRATION.INVALID_REF_FILE');
    }
  });

  it('throws INVALID_REF_FILE when file has invalid hash', async () => {
    await writeFile(join(refsDir, 'staging.json'), JSON.stringify({ hash: 'bad', invariants: [] }));
    try {
      await readRef(refsDir, 'staging');
      expect.fail('expected error');
    } catch (e) {
      expect(MigrationToolsError.is(e)).toBe(true);
      expect((e as MigrationToolsError).code).toBe('MIGRATION.INVALID_REF_FILE');
    }
  });

  it('throws INVALID_REF_FILE when file is missing invariants', async () => {
    await writeFile(join(refsDir, 'staging.json'), JSON.stringify({ hash: HASH_A }));
    try {
      await readRef(refsDir, 'staging');
      expect.fail('expected error');
    } catch (e) {
      expect(MigrationToolsError.is(e)).toBe(true);
      expect((e as MigrationToolsError).code).toBe('MIGRATION.INVALID_REF_FILE');
    }
  });

  it('throws INVALID_REF_NAME for invalid ref names', async () => {
    try {
      await readRef(refsDir, '../escape');
      expect.fail('expected error');
    } catch (e) {
      expect(MigrationToolsError.is(e)).toBe(true);
      expect((e as MigrationToolsError).code).toBe('MIGRATION.INVALID_REF_NAME');
    }
  });
});

describe('readRefs', () => {
  let refsDir: string;

  beforeEach(async () => {
    refsDir = join(
      tmpdir(),
      `test-refs-readall-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
  });

  afterEach(async () => {
    await rm(refsDir, { recursive: true, force: true });
  });

  it('returns empty record when refs directory does not exist', async () => {
    const refs = await readRefs(refsDir);
    expect(refs).toEqual({});
  });

  it('returns empty record for empty directory', async () => {
    await mkdir(refsDir, { recursive: true });
    const refs = await readRefs(refsDir);
    expect(refs).toEqual({});
  });

  it('reads multiple ref files', async () => {
    await mkdir(refsDir, { recursive: true });
    await writeFile(join(refsDir, 'staging.json'), JSON.stringify(ENTRY_A));
    await writeFile(join(refsDir, 'production.json'), JSON.stringify(ENTRY_B));
    const refs = await readRefs(refsDir);
    expect(refs).toEqual({ staging: ENTRY_A, production: ENTRY_B });
  });

  it('reconstructs slashed names from subdirectories', async () => {
    await mkdir(join(refsDir, 'envs'), { recursive: true });
    await writeFile(join(refsDir, 'envs', 'staging.json'), JSON.stringify(ENTRY_A));
    await writeFile(join(refsDir, 'envs', 'production.json'), JSON.stringify(ENTRY_B));
    const refs = await readRefs(refsDir);
    expect(refs).toEqual({ 'envs/staging': ENTRY_A, 'envs/production': ENTRY_B });
  });

  it('reads deeply nested refs', async () => {
    await mkdir(join(refsDir, 'team', 'backend'), { recursive: true });
    await writeFile(join(refsDir, 'team', 'backend', 'prod.json'), JSON.stringify(ENTRY_A));
    const refs = await readRefs(refsDir);
    expect(refs).toEqual({ 'team/backend/prod': ENTRY_A });
  });

  it('mixes top-level and nested refs', async () => {
    await mkdir(join(refsDir, 'envs'), { recursive: true });
    await writeFile(join(refsDir, 'head.json'), JSON.stringify(ENTRY_A));
    await writeFile(join(refsDir, 'envs', 'staging.json'), JSON.stringify(ENTRY_B));
    const refs = await readRefs(refsDir);
    expect(refs).toEqual({ head: ENTRY_A, 'envs/staging': ENTRY_B });
  });

  it('ignores non-json files', async () => {
    await mkdir(refsDir, { recursive: true });
    await writeFile(join(refsDir, 'staging.json'), JSON.stringify(ENTRY_A));
    await writeFile(join(refsDir, 'README.md'), '# Refs');
    const refs = await readRefs(refsDir);
    expect(refs).toEqual({ staging: ENTRY_A });
  });

  it('ignores paired contract snapshot json files', async () => {
    await mkdir(refsDir, { recursive: true });
    await writeFile(join(refsDir, 'db.json'), JSON.stringify(ENTRY_A));
    await writeFile(
      join(refsDir, 'db.contract.json'),
      JSON.stringify({
        targetFamily: 'sql',
        target: 'postgres',
        profileHash: HASH_B,
        storage: { storageHash: HASH_A },
        models: {},
      }),
    );
    const refs = await readRefs(refsDir);
    expect(refs).toEqual({ db: ENTRY_A });
  });

  it('throws INVALID_REF_FILE for malformed file', async () => {
    await mkdir(refsDir, { recursive: true });
    await writeFile(join(refsDir, 'staging.json'), '{bad json');
    try {
      await readRefs(refsDir);
      expect.fail('expected error');
    } catch (e) {
      expect(MigrationToolsError.is(e)).toBe(true);
      expect((e as MigrationToolsError).code).toBe('MIGRATION.INVALID_REF_FILE');
    }
  });
});

describe('deleteRef', () => {
  let refsDir: string;

  beforeEach(async () => {
    refsDir = join(
      tmpdir(),
      `test-refs-delete-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await mkdir(refsDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(refsDir, { recursive: true, force: true });
  });

  it('deletes a ref file', async () => {
    await writeFile(join(refsDir, 'staging.json'), JSON.stringify(ENTRY_A));
    await deleteRef(refsDir, 'staging');
    const refs = await readRefs(refsDir);
    expect(refs).toEqual({});
  });

  it('deletes a nested ref and cleans empty parent directories', async () => {
    await mkdir(join(refsDir, 'envs'), { recursive: true });
    await writeFile(join(refsDir, 'envs', 'staging.json'), JSON.stringify(ENTRY_A));
    await deleteRef(refsDir, 'envs/staging');
    const refs = await readRefs(refsDir);
    expect(refs).toEqual({});
    // The envs/ directory should be cleaned up
    try {
      await readFile(join(refsDir, 'envs', 'staging.json'), 'utf-8');
      expect.fail('file should not exist');
    } catch (e) {
      expect((e as NodeJS.ErrnoException).code).toBe('ENOENT');
    }
  });

  it('does not delete sibling refs when deleting a nested ref', async () => {
    await mkdir(join(refsDir, 'envs'), { recursive: true });
    await writeFile(join(refsDir, 'envs', 'staging.json'), JSON.stringify(ENTRY_A));
    await writeFile(join(refsDir, 'envs', 'production.json'), JSON.stringify(ENTRY_B));
    await deleteRef(refsDir, 'envs/staging');
    const refs = await readRefs(refsDir);
    expect(refs).toEqual({ 'envs/production': ENTRY_B });
  });

  it('throws UNKNOWN_REF for non-existent ref', async () => {
    try {
      await deleteRef(refsDir, 'nonexistent');
      expect.fail('expected error');
    } catch (e) {
      expect(MigrationToolsError.is(e)).toBe(true);
      expect((e as MigrationToolsError).code).toBe('MIGRATION.UNKNOWN_REF');
    }
  });

  it('throws INVALID_REF_NAME for invalid ref names', async () => {
    try {
      await deleteRef(refsDir, '../escape');
      expect.fail('expected error');
    } catch (e) {
      expect(MigrationToolsError.is(e)).toBe(true);
      expect((e as MigrationToolsError).code).toBe('MIGRATION.INVALID_REF_NAME');
    }
  });
});

describe('resolveRef', () => {
  it('resolves existing ref to RefEntry', () => {
    const refs: Refs = { staging: ENTRY_A, production: ENTRY_B };
    expect(resolveRef(refs, 'staging')).toEqual(ENTRY_A);
  });

  it('throws for unknown ref name', () => {
    const refs: Refs = { staging: ENTRY_A };
    try {
      resolveRef(refs, 'production');
      expect.fail('expected error');
    } catch (e) {
      expect(MigrationToolsError.is(e)).toBe(true);
      expect((e as MigrationToolsError).code).toBe('MIGRATION.UNKNOWN_REF');
    }
  });

  it('throws for invalid ref name', () => {
    const refs: Refs = { staging: ENTRY_A };
    try {
      resolveRef(refs, '../escape');
      expect.fail('expected error');
    } catch (e) {
      expect(MigrationToolsError.is(e)).toBe(true);
      expect((e as MigrationToolsError).code).toBe('MIGRATION.INVALID_REF_NAME');
    }
  });

  it('throws UNKNOWN_REF for prototype-chain lookups (e.g. "constructor")', () => {
    const refs: Refs = { staging: ENTRY_A };
    try {
      resolveRef(refs, 'constructor');
      expect.fail('expected error');
    } catch (e) {
      expect(MigrationToolsError.is(e)).toBe(true);
      expect((e as MigrationToolsError).code).toBe('MIGRATION.UNKNOWN_REF');
    }
  });
});

describe('round-trip', () => {
  let refsDir: string;

  beforeEach(async () => {
    refsDir = join(tmpdir(), `test-refs-rt-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  });

  afterEach(async () => {
    await rm(refsDir, { recursive: true, force: true });
  });

  it('writeRef then readRef round-trips', async () => {
    await writeRef(refsDir, 'staging', ENTRY_B);
    const entry = await readRef(refsDir, 'staging');
    expect(entry).toEqual(ENTRY_B);
  });

  it('multiple writeRef then readRefs round-trips', async () => {
    await writeRef(refsDir, 'staging', ENTRY_A);
    await writeRef(refsDir, 'production', ENTRY_B);
    await writeRef(refsDir, 'envs/dev', { hash: HASH_A, invariants: ['seed-countries'] });
    const refs = await readRefs(refsDir);
    expect(refs).toEqual({
      staging: ENTRY_A,
      production: ENTRY_B,
      'envs/dev': { hash: HASH_A, invariants: ['seed-countries'] },
    });
  });

  it('writeRef then deleteRef then readRefs', async () => {
    await writeRef(refsDir, 'staging', ENTRY_A);
    await writeRef(refsDir, 'production', ENTRY_B);
    await deleteRef(refsDir, 'staging');
    const refs = await readRefs(refsDir);
    expect(refs).toEqual({ production: ENTRY_B });
  });
});

const HASH_BRANCH_A = `${'c'.repeat(64)}`;
const HASH_POSTGIS = `${'f'.repeat(64)}`;

describe('resolveRefsByContractHash', () => {
  let refsDir: string;

  beforeEach(async () => {
    refsDir = join(await mkdtemp(join(tmpdir(), 'resolve-refs-')), 'refs');
    await mkdir(refsDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(dirname(refsDir), { recursive: true, force: true });
  });

  it('returns an empty map when the refs directory does not exist', async () => {
    const map = await resolveRefsByContractHash(join(refsDir, 'nope'));
    expect(map.size).toBe(0);
  });

  it('groups multiple refs that share a hash into a single sorted bucket', async () => {
    await writeRef(refsDir, 'staging', { hash: HASH_BRANCH_A, invariants: [] });
    await writeRef(refsDir, 'production', { hash: HASH_BRANCH_A, invariants: [] });
    await writeRef(refsDir, 'db', { hash: HASH_POSTGIS, invariants: [] });

    const map = await resolveRefsByContractHash(refsDir);

    expect(map.get(HASH_BRANCH_A)).toEqual(['production', 'staging']);
    expect(map.get(HASH_POSTGIS)).toEqual(['db']);
  });
});
