import sqliteDriverDescriptor from '@internal/driver-sqlite/control';
import sqlFamilyDescriptor from '@internal/family-sql/control';
import { createControlStack } from '@internal/framework-components/control';
import { SQL_CHAR_CODEC_ID, SQL_VARCHAR_CODEC_ID } from '@internal/sql-relational-core/ast';
import { sqliteCodecRegistry } from '@internal/target-sqlite/codecs';
import sqliteTargetDescriptor, { sqlitePslTypeConstructors } from '@internal/target-sqlite/control';
import { describe, expect, it } from 'vitest';
import { sqliteAdapterDescriptorMeta } from '../src/core/descriptor-meta';
import sqliteAdapterDescriptor from '../src/exports/control';

const registeredCodecs = sqliteAdapterDescriptorMeta.types.codecTypes.codecDescriptors;

describe('the SQLite adapter descriptor metadata', () => {
  it('registers every codec the target ships', () => {
    expect(registeredCodecs).toEqual(Array.from(sqliteCodecRegistry.values()));
  });

  it('registers no codec that renders a named TypeScript type, which its type imports lack', () => {
    expect(
      registeredCodecs
        .filter((descriptor) => descriptor.renderOutputType !== undefined)
        .map((descriptor) => descriptor.codecId),
    ).toEqual([]);
  });

  it('registers no data types, because the target registers them', () => {
    expect(sqliteAdapterDescriptorMeta).not.toHaveProperty('dataTypes');
  });

  it('contributes the base scalar type constructors the target defines', () => {
    expect(sqliteAdapterDescriptor.authoring?.type).toBe(sqlitePslTypeConstructors);
  });

  it('contributes no data type entries, because the target contributes them', () => {
    expect(sqliteAdapterDescriptor.authoring?.dataTypes).toBeUndefined();
  });
});

describe('the SQLite control stack codec lookup', () => {
  const stack = createControlStack({
    family: sqlFamilyDescriptor,
    target: sqliteTargetDescriptor,
    adapter: sqliteAdapterDescriptor,
    driver: sqliteDriverDescriptor,
    extensions: [],
  });

  it.each([
    [SQL_CHAR_CODEC_ID, 'sqlite/character'],
    [SQL_VARCHAR_CODEC_ID, 'sqlite/character-varying'],
  ])('finds %s, which names %s', (codecId, dataType) => {
    expect(stack.codecLookup.descriptorFor?.(codecId)?.dataType).toBe(dataType);
  });

  it('marks no type constructor or field preset inferred, because SQLite has no contract infer', () => {
    const inferredPaths = (namespace: unknown, path: string): readonly string[] => {
      if (typeof namespace !== 'object' || namespace === null) return [];
      if ('kind' in namespace) return 'inferred' in namespace ? [path] : [];
      return Object.entries(namespace).flatMap(([key, value]) =>
        inferredPaths(value, path === '' ? key : `${path}.${key}`),
      );
    };
    expect([
      ...inferredPaths(stack.authoringContributions.type, ''),
      ...inferredPaths(stack.authoringContributions.field, ''),
    ]).toEqual([]);
  });
});
