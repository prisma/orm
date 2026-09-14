import { domainModelsAtDefaultNamespace } from '@internal/contract/types';
import { AsyncIterableResult } from '@internal/framework-components/runtime';
import { describe, expect, it } from 'vitest';
import {
  POLYMORPHIC_DISCRIMINATOR_ALIAS,
  resolvePolymorphismInfo,
} from '../src/collection-contract';
import {
  acquireRuntimeScope,
  createRowEnvelope,
  createStorageRowMapper,
  mapModelDataToStorageRow,
  mapPolymorphicRow,
  mapResultRows,
  mapStorageRowToModelFields,
  stripHiddenMappedFields,
} from '../src/collection-runtime';
import { buildMixedPolyContract, getTestContract } from './helpers';

describe('collection-runtime', () => {
  const contract = getTestContract();

  it('mapStorageRowToModelFields() maps known columns and falls back otherwise', () => {
    expect(
      mapStorageRowToModelFields(contract, 'public', 'Post', { id: 1, user_id: 2, custom: true }),
    ).toEqual({
      id: 1,
      userId: 2,
      custom: true,
    });
    expect(mapStorageRowToModelFields(contract, 'public', 'UnknownModel', { id: 1 })).toEqual({
      id: 1,
    });
  });

  it('prepared row mappers preserve changing keys, aliases, nulls and source ownership', () => {
    const mapRow = createStorageRowMapper(contract, 'public', 'Post');
    const first = Object.freeze({ user_id: 1, title: null });
    const second = Object.freeze({ views: 2, custom: true });
    expect(mapRow(first)).toEqual({ userId: 1, title: null });
    expect(mapRow(second)).toEqual({ views: 2, custom: true });
    expect(mapRow(first)).not.toBe(first);
    expect(first).toEqual({ user_id: 1, title: null });
    const fallback = createStorageRowMapper(contract, 'public', 'UnknownModel');
    expect(fallback(first)).toEqual({ user_id: 1, title: null });
    expect(fallback(first)).not.toBe(first);
  });

  it('mapModelDataToStorageRow() maps fields and skips undefined values', () => {
    expect(
      mapModelDataToStorageRow(contract, 'public', 'Post', {
        id: 1,
        userId: 2,
        views: undefined,
        custom: 'x',
      }),
    ).toEqual({
      id: 1,
      user_id: 2,
      custom: 'x',
    });
  });

  it('mapModelDataToStorageRow() falls back to input keys when model mappings are missing', () => {
    expect(
      mapModelDataToStorageRow(contract, 'public', 'UnknownModel', {
        customField: 1,
        optionalField: undefined,
      }),
    ).toEqual({
      customField: 1,
    });
  });

  it('stripHiddenMappedFields() removes mapped fields for hidden columns', () => {
    const mapped = { id: 1, userId: 2, title: 'A' };
    stripHiddenMappedFields(contract, 'public', 'Post', mapped, ['user_id']);

    expect(mapped).toEqual({ id: 1, title: 'A' });
    stripHiddenMappedFields(contract, 'public', 'Post', mapped, []);
    expect(mapped).toEqual({ id: 1, title: 'A' });
  });

  it('stripHiddenMappedFields() falls back to raw column names when mappings are missing', () => {
    const unknownTableMapped = { custom_col: 1 };
    stripHiddenMappedFields(contract, 'public', 'UnknownModel', unknownTableMapped, ['custom_col']);
    expect(unknownTableMapped).toEqual({});

    const unknownColumnMapped = { id: 1, custom_col: 2 };
    stripHiddenMappedFields(contract, 'public', 'User', unknownColumnMapped, ['custom_col']);
    expect(unknownColumnMapped).toEqual({ id: 1 });
  });

  it('createRowEnvelope() retains raw and mapped values', () => {
    expect(createRowEnvelope(contract, 'public', 'Post', { id: 1, user_id: 2 })).toEqual({
      raw: { id: 1, user_id: 2 },
      mapped: { id: 1, userId: 2 },
    });
  });

  it('mapResultRows() maps async iterable rows', async () => {
    const source = new AsyncIterableResult(
      (async function* () {
        yield 1;
        yield 2;
      })(),
    );

    const mapped = mapResultRows(source, (value) => value * 10);
    expect(await mapped.toArray()).toEqual([10, 20]);
  });

  it('acquireRuntimeScope() handles direct runtimes and connection scopes', async () => {
    const directRuntime = {
      query: () => new AsyncIterableResult((async function* () {})()),
      execute: async () => ({ affectedRows: 0 }),
    } as never;
    const direct = await acquireRuntimeScope(directRuntime);
    expect(direct.scope).toBe(directRuntime);
    expect(direct.release).toBeUndefined();

    let released = false;
    const connectionRuntime = {
      async connection() {
        return {
          query: () => new AsyncIterableResult((async function* () {})()),
          execute: async () => ({ affectedRows: 0 }),
          release: async () => {
            released = true;
          },
        };
      },
    } as never;
    const scoped = await acquireRuntimeScope(connectionRuntime);
    expect(scoped.release).toBeTypeOf('function');
    await scoped.release?.();
    expect(released).toBe(true);

    const noReleaseRuntime = {
      async connection() {
        return {
          query: () => new AsyncIterableResult((async function* () {})()),
          execute: async () => ({ affectedRows: 0 }),
        };
      },
    } as never;
    const noRelease = await acquireRuntimeScope(noReleaseRuntime);
    expect(noRelease.release).toBeUndefined();
  });

  it('acquireRuntimeScope() release callback falls back when release returns undefined', async () => {
    const runtime = {
      async connection() {
        return {
          query: () => new AsyncIterableResult((async function* () {})()),
          execute: async () => ({ affectedRows: 0 }),
          release: () => undefined,
        };
      },
    } as never;

    const scoped = await acquireRuntimeScope(runtime);
    await expect(scoped.release?.()).resolves.toBeUndefined();
  });
});

describe('mapPolymorphicRow()', () => {
  it('maps STI Bug row: includes base + Bug fields, excludes Feature fields', () => {
    const contract = buildMixedPolyContract();
    const polyInfo = resolvePolymorphismInfo(contract, 'public', 'Task')!;

    const row = { id: 1, title: 'Crash', type: 'bug', severity: 'critical' };
    const result = mapPolymorphicRow(contract, 'public', 'Task', polyInfo, row);

    expect(result).toEqual({ id: 1, title: 'Crash', type: 'bug', severity: 'critical' });
  });

  it('maps STI row and strips non-matching variant columns (NULL for other STI variants)', () => {
    const contract = buildMixedPolyContract();
    const polyInfo = resolvePolymorphismInfo(contract, 'public', 'Task')!;

    const row = { id: 1, title: 'Crash', type: 'bug', severity: 'critical', priority: null };
    const result = mapPolymorphicRow(contract, 'public', 'Task', polyInfo, row);

    expect(result).toEqual({ id: 1, title: 'Crash', type: 'bug', severity: 'critical' });
    expect(result).not.toHaveProperty('priority');
  });

  it('maps MTI Feature row: includes base + Feature fields via table-qualified aliases', () => {
    const contract = buildMixedPolyContract();
    const polyInfo = resolvePolymorphismInfo(contract, 'public', 'Task')!;

    const row = {
      id: 2,
      title: 'Dark mode',
      type: 'feature',
      severity: null,
      features__priority: 1,
    };
    const result = mapPolymorphicRow(contract, 'public', 'Task', polyInfo, row);

    expect(result).toEqual({ id: 2, title: 'Dark mode', type: 'feature', priority: 1 });
    expect(result).not.toHaveProperty('severity');
  });

  it('uses a hidden discriminator without exposing it in the mapped row', () => {
    const contract = buildMixedPolyContract();
    const polyInfo = resolvePolymorphismInfo(contract, 'public', 'Task')!;

    const row = {
      id: 2,
      [POLYMORPHIC_DISCRIMINATOR_ALIAS]: 'feature',
      features__priority: 1,
    };
    const result = mapPolymorphicRow(contract, 'public', 'Task', polyInfo, row);

    expect(result).toEqual({ id: 2, priority: 1 });
  });

  it('maps row with known variant using variantName override', () => {
    const contract = buildMixedPolyContract();
    const polyInfo = resolvePolymorphismInfo(contract, 'public', 'Task')!;

    const row = { id: 1, title: 'Crash', type: 'bug', severity: 'high' };
    const result = mapPolymorphicRow(contract, 'public', 'Task', polyInfo, row, 'Bug');

    expect(result).toEqual({ id: 1, title: 'Crash', type: 'bug', severity: 'high' });
  });

  it('falls back to base-only mapping for unknown discriminator values', () => {
    const contract = buildMixedPolyContract();
    const polyInfo = resolvePolymorphismInfo(contract, 'public', 'Task')!;

    const row = {
      id: 3,
      title: 'Unknown',
      type: 'epic',
      severity: null,
      features__priority: null,
    };
    const result = mapPolymorphicRow(contract, 'public', 'Task', polyInfo, row);

    expect(result).toEqual({ id: 3, title: 'Unknown', type: 'epic' });
  });

  it('preserves identity-mapped fields (no explicit column mapping)', () => {
    const contract = buildMixedPolyContract();
    // Remove explicit column mappings to create identity-mapped fields
    const models = domainModelsAtDefaultNamespace(contract.domain) as unknown as Record<
      string,
      Record<string, unknown>
    >;
    models['Task']!['storage'] = {
      table: 'tasks',
      fields: { id: {}, title: {}, type: {} },
    };
    models['Bug']!['storage'] = {
      table: 'tasks',
      fields: { severity: {} },
    };
    models['Feature']!['storage'] = {
      table: 'features',
      fields: { priority: {} },
    };

    const polyInfo = resolvePolymorphismInfo(contract, 'public', 'Task')!;

    const stiRow = { id: 1, title: 'Crash', type: 'bug', severity: 'high' };
    expect(mapPolymorphicRow(contract, 'public', 'Task', polyInfo, stiRow)).toEqual({
      id: 1,
      title: 'Crash',
      type: 'bug',
      severity: 'high',
    });

    const mtiRow = { id: 2, title: 'Feature', type: 'feature', features__priority: 5 };
    expect(mapPolymorphicRow(contract, 'public', 'Task', polyInfo, mtiRow)).toEqual({
      id: 2,
      title: 'Feature',
      type: 'feature',
      priority: 5,
    });

    const unknownRow = { id: 3, title: 'Unknown', type: 'epic' };
    expect(mapPolymorphicRow(contract, 'public', 'Task', polyInfo, unknownRow)).toEqual({
      id: 3,
      title: 'Unknown',
      type: 'epic',
    });
  });
});
