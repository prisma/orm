import { AsyncIterableResult } from '@internal/framework-components/runtime';
import { describe, expect, it, vi } from 'vitest';
import * as collectionContract from '../src/collection-contract';
import {
  POLYMORPHIC_DISCRIMINATOR_ALIAS,
  resolvePolymorphismInfo,
} from '../src/collection-contract';
import {
  acquireRuntimeScope,
  createPolymorphicRowMapper,
  createRowEnvelope,
  createStorageRowMapper,
  mapModelDataToStorageRow,
  mapPolymorphicRow,
  mapResultRows,
  mapStorageRowToModelFields,
  stripHiddenMappedFields,
} from '../src/collection-runtime';
import {
  buildMixedPolyContract,
  columnPassedForField,
  fieldUnknown,
  getTestContract,
} from './helpers';

describe('collection-runtime', () => {
  const contract = getTestContract();

  it('mapStorageRowToModelFields() maps the columns fields map and drops any other column', () => {
    expect(
      mapStorageRowToModelFields(contract, 'public', 'Post', { id: 1, user_id: 2, custom: true }),
    ).toEqual({
      id: 1,
      userId: 2,
    });
  });

  it('mapStorageRowToModelFields() maps a row of a model with no fields to an empty row', () => {
    expect(mapStorageRowToModelFields(contract, 'public', 'UnknownModel', { id: 1 })).toEqual({});
  });

  it('prepared row mappers preserve changing keys, aliases, nulls and source ownership', () => {
    const mapRow = createStorageRowMapper(contract, 'public', 'Post');
    const first = Object.freeze({ user_id: 1, title: null });
    const second = Object.freeze({ views: 2, custom: true });
    expect(mapRow(first)).toEqual({ userId: 1, title: null });
    expect(mapRow(second)).toEqual({ views: 2 });
    expect(mapRow(first)).not.toBe(first);
    expect(first).toEqual({ user_id: 1, title: null });
    const noFields = createStorageRowMapper(contract, 'public', 'UnknownModel');
    expect(noFields(first)).toEqual({});
  });

  it('mapModelDataToStorageRow() maps fields and skips undefined values', () => {
    expect(
      mapModelDataToStorageRow(contract, 'public', 'Post', {
        id: 1,
        userId: 2,
        views: undefined,
      }),
    ).toEqual({
      id: 1,
      user_id: 2,
    });
  });

  it('mapModelDataToStorageRow() refuses a name that is not a field', () => {
    expect(() =>
      mapModelDataToStorageRow(contract, 'public', 'Post', { id: 1, custom: 'x' }),
    ).toThrow(fieldUnknown('Post', 'custom'));
    expect(() =>
      mapModelDataToStorageRow(contract, 'public', 'Post', { id: 1, user_id: 2 }),
    ).toThrow(columnPassedForField('Post', 'user_id', 'userId'));
  });

  it('stripHiddenMappedFields() removes mapped fields for hidden columns', () => {
    const mapped = { id: 1, userId: 2, title: 'A' };
    stripHiddenMappedFields(contract, 'public', 'Post', mapped, ['user_id']);

    expect(mapped).toEqual({ id: 1, title: 'A' });
    stripHiddenMappedFields(contract, 'public', 'Post', mapped, []);
    expect(mapped).toEqual({ id: 1, title: 'A' });
  });

  it('stripHiddenMappedFields() leaves the row alone for a hidden column no field maps', () => {
    const mapped = { id: 1, user_id: 2 };
    stripHiddenMappedFields(contract, 'public', 'Post', mapped, ['user_id_extra']);
    expect(mapped).toEqual({ id: 1, user_id: 2 });

    const named = { id: 1, invited_by_id: 3 };
    stripHiddenMappedFields(contract, 'public', 'User', named, ['invited_by_id']);
    expect(named).toEqual({ id: 1, invited_by_id: 3 });
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
  it('precomputes STI, MTI, pinned and fallback maps without looking up metadata per row', () => {
    const contract = buildMixedPolyContract();
    const polyInfo = resolvePolymorphismInfo(contract, 'public', 'Task')!;
    const lookup = vi.spyOn(collectionContract, 'getModelColumnFields');
    const map = createPolymorphicRowMapper(contract, 'public', 'Task', polyInfo);
    const pinned = createPolymorphicRowMapper(contract, 'public', 'Task', polyInfo, 'Feature');
    expect(lookup).toHaveBeenCalledWith(contract, 'public', 'Task');
    const calls = lookup.mock.calls.length;
    for (let invocation = 0; invocation < 2; invocation++) {
      expect(
        map({
          title: 'Bug',
          [POLYMORPHIC_DISCRIMINATOR_ALIAS]: 'bug',
          severity: 'high',
          features__priority: null,
          custom: true,
        }),
      ).toEqual({ title: 'Bug', severity: 'high' });
      expect(
        map({
          title: 'Feature',
          [POLYMORPHIC_DISCRIMINATOR_ALIAS]: 'feature',
          severity: null,
          features__priority: 2,
        }),
      ).toEqual({ title: 'Feature', priority: 2 });
      expect(map({ title: 'Unknown', type: 'unknown', severity: 'high', custom: true })).toEqual({
        title: 'Unknown',
        type: 'unknown',
      });
      expect(pinned({ title: 'Pinned', features__priority: 3 })).toEqual({
        title: 'Pinned',
        priority: 3,
      });
    }
    expect(lookup).toHaveBeenCalledTimes(calls);
    lookup.mockRestore();
  });

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
});
