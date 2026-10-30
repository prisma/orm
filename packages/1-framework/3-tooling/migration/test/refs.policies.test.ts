import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RefEntry } from '../src/refs';
import { advanceRef, readRef, readRefs, writeRef } from '../src/refs';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

const PRODUCTION: RefEntry = {
  hash: HASH_A,
  invariants: ['split-user-name'],
  policies: {
    change: ['migrate'],
    dataProtection: {
      dataLoss: 'data-loss-with-consent',
      accessWidening: 'access-widening-forbidden',
    },
  },
};

let refsDir: string;

beforeEach(async () => {
  refsDir = join(
    tmpdir(),
    `test-refs-policies-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(refsDir, { recursive: true });
});

afterEach(async () => {
  await rm(refsDir, { recursive: true, force: true });
});

async function fileContent(name: string): Promise<unknown> {
  return JSON.parse(await readFile(join(refsDir, `${name}.json`), 'utf-8'));
}

describe('a ref that declares policies', () => {
  it('round-trips through writeRef and readRef', async () => {
    await writeRef(refsDir, 'production', PRODUCTION);
    expect(await fileContent('production')).toEqual(PRODUCTION);
    expect(await readRef(refsDir, 'production')).toEqual(PRODUCTION);
  });

  it('reads a partial declaration', async () => {
    const entry = { hash: HASH_A, invariants: [], policies: { change: ['migrate'] } };
    await writeFile(join(refsDir, 'production.json'), JSON.stringify(entry));
    expect(await readRef(refsDir, 'production')).toEqual(entry);
  });

  it('writes no policies key when the entry has none', async () => {
    await writeRef(refsDir, 'staging', { hash: HASH_A, invariants: [] });
    expect(await fileContent('staging')).toEqual({ hash: HASH_A, invariants: [] });
  });

  it.each([
    ['an unknown key', { change: ['migrate'], dataloss: 'data-loss-forbidden' }],
    ['an unknown data protection key', { dataProtection: { dataloss: 'data-loss-forbidden' } }],
    ['an unknown strategy', { change: ['deploy'] }],
    ['an empty change policy', { change: [] }],
    ['an unknown level', { dataProtection: { accessWidening: 'open' } }],
    ['a list instead of an object', []],
    ['a list as data protection', { dataProtection: [] }],
  ])('is rejected as an invalid ref file when its policies carry %s', async (_, policies) => {
    await writeFile(
      join(refsDir, 'production.json'),
      JSON.stringify({ hash: HASH_A, invariants: [], policies }),
    );
    await expect(readRef(refsDir, 'production')).rejects.toMatchObject({
      code: 'MIGRATION.INVALID_REF_FILE',
    });
    await expect(readRefs(refsDir)).rejects.toMatchObject({
      code: 'MIGRATION.INVALID_REF_FILE',
    });
  });
});

describe('advanceRef', () => {
  it('writes a new ref with no invariants', async () => {
    const written = await advanceRef(refsDir, 'db', HASH_B);
    expect(written).toEqual({ hash: HASH_B, invariants: [] });
    expect(await fileContent('db')).toEqual({ hash: HASH_B, invariants: [] });
  });

  it('moves an existing ref and keeps its invariants and policies', async () => {
    await writeRef(refsDir, 'production', PRODUCTION);
    const written = await advanceRef(refsDir, 'production', HASH_B);
    expect(written).toEqual({ ...PRODUCTION, hash: HASH_B });
    expect(await fileContent('production')).toEqual({ ...PRODUCTION, hash: HASH_B });
  });

  it('moves a nested ref', async () => {
    await writeRef(refsDir, 'envs/production', PRODUCTION);
    expect(await advanceRef(refsDir, 'envs/production', HASH_B)).toEqual({
      ...PRODUCTION,
      hash: HASH_B,
    });
  });
});
