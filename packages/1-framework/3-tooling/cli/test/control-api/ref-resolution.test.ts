import { EMPTY_CONTRACT_HASH } from '@internal/migration-tools/constants';
import { parseContractRef, parseMigrationRef } from '@internal/migration-tools/ref-resolution';
import type { Refs } from '@internal/migration-tools/refs';
import { describe, expect, it } from 'vitest';
import {
  resolveContractRef,
  resolveMigrationRef,
  retryCommandFor,
} from '../../src/control-api/operations/ref-resolution';
import { mapRefResolutionError } from '../../src/utils/cli-errors';
import { buildGraph, entry } from '../utils/graph-helpers';

const HASH_A = `abcdef${'0'.repeat(58)}`;
const HASH_B = `abcdef${'1'.repeat(58)}`;
const HASH_UNKNOWN = `${'f'.repeat(64)}`;

const graph = buildGraph([entry(EMPTY_CONTRACT_HASH, HASH_A, 'm1'), entry(HASH_A, HASH_B, 'm2')]);
const refs: Refs = { staging: { hash: HASH_A, invariants: [] } };

describe('resolveContractRef', () => {
  it('passes a resolvable reference through as ok', () => {
    const result = resolveContractRef(HASH_A, { graph, refs });
    const raw = parseContractRef(HASH_A, { graph, refs });
    expect(raw.ok).toBe(true);
    expect(result.ok).toBe(true);
    if (result.ok && raw.ok) {
      expect(result.value).toEqual(raw.value);
    }
  });

  it('maps a not-found failure to the mapRefResolutionError envelope', () => {
    const result = resolveContractRef(HASH_UNKNOWN, { graph, refs });
    const raw = parseContractRef(HASH_UNKNOWN, { graph, refs });
    expect(result.ok).toBe(false);
    if (!result.ok && !raw.ok) {
      expect(result.failure.toEnvelope()).toEqual(mapRefResolutionError(raw.failure).toEnvelope());
      expect(raw.failure.kind).toBe('not-found');
    }
  });

  it('maps an ambiguous prefix to the mapRefResolutionError envelope', () => {
    const result = resolveContractRef('abcdef', { graph, refs });
    const raw = parseContractRef('abcdef', { graph, refs });
    expect(result.ok).toBe(false);
    if (!result.ok && !raw.ok) {
      expect(result.failure.toEnvelope()).toEqual(mapRefResolutionError(raw.failure).toEnvelope());
      expect(raw.failure.kind).toBe('ambiguous');
    }
  });

  it('maps an invalid-format failure to the mapRefResolutionError envelope', () => {
    const result = resolveContractRef('', { graph, refs });
    const raw = parseContractRef('', { graph, refs });
    expect(result.ok).toBe(false);
    if (!result.ok && !raw.ok) {
      expect(result.failure.toEnvelope()).toEqual(mapRefResolutionError(raw.failure).toEnvelope());
      expect(raw.failure.kind).toBe('invalid-format');
    }
  });
});

describe('resolveMigrationRef', () => {
  it('passes a resolvable migration reference through as ok', () => {
    const result = resolveMigrationRef('m2', { graph, refs });
    const raw = parseMigrationRef('m2', { graph, refs });
    expect(raw.ok).toBe(true);
    expect(result.ok).toBe(true);
    if (result.ok && raw.ok) {
      expect(result.value).toEqual(raw.value);
    }
  });

  it('maps a wrong-grammar failure to the mapRefResolutionError envelope', () => {
    const result = resolveMigrationRef('staging', { graph, refs });
    const raw = parseMigrationRef('staging', { graph, refs });
    expect(result.ok).toBe(false);
    if (!result.ok && !raw.ok) {
      expect(result.failure.toEnvelope()).toEqual(mapRefResolutionError(raw.failure).toEnvelope());
      expect(raw.failure.kind).toBe('wrong-grammar');
    }
  });
});

describe('retryCommandFor', () => {
  const status = { commandName: 'migration status', canRunOffline: true };
  const migrate = { commandName: 'db migrate', from: undefined, canRunOffline: false };

  it.each([
    {
      args: { ...status, from: undefined, to: undefined },
      retry: '{bin} migration status --from <contract>',
    },
    {
      args: { ...status, from: undefined, to: 'prod' },
      retry: '{bin} migration status --from <contract> --to prod',
    },
    {
      args: { ...status, from: '@db', to: 'prod' },
      retry: '{bin} migration status --from @db --to prod --db $DATABASE_URL',
    },
    {
      args: { ...status, from: HASH_A, to: '@db' },
      retry: `{bin} migration status --from ${HASH_A} --to @db --db $DATABASE_URL`,
    },
    {
      args: { ...migrate, to: 'prod', advanceRef: 'staging' },
      retry: '{bin} db migrate --to prod --advance-ref staging --db $DATABASE_URL',
    },
    { args: { ...migrate, to: undefined }, retry: '{bin} db migrate --db $DATABASE_URL' },
  ])('repeats the flags as given: $retry', ({ args, retry }) => {
    expect(retryCommandFor(args)).toBe(retry);
  });
});
