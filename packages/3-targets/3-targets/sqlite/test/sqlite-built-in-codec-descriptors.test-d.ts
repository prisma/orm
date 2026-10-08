import type { CodecInstanceContext } from '@internal/framework-components/codec';
import type { SqlCharCodec, SqlIntCodec } from '@internal/sql-relational-core/ast';
import { expectTypeOf, test } from 'vitest';
import type {
  AnySqliteCodecDescriptor,
  SqliteCodecDescriptorRegistry,
} from '../src/core/codec-descriptor';
import {
  codecDescriptors,
  type SqliteBigintCodec,
  type SqliteBlobCodec,
  sqliteBigintColumn,
  sqliteBlobColumn,
  sqliteIntegerDescriptor,
  sqliteSqlCharDescriptor,
  sqliteSqlIntDescriptor,
} from '../src/core/codecs';
import { sqliteCodecDescriptorRegistry } from '../src/core/registry';
import type { CodecTypes } from '../src/exports/codec-types';

test('canonical descriptors are target-typed without losing tuple membership', () => {
  expectTypeOf(codecDescriptors).toExtend<readonly AnySqliteCodecDescriptor[]>();
  expectTypeOf<(typeof codecDescriptors)[number]>().toExtend<AnySqliteCodecDescriptor>();
});

test('generic adapters preserve factory result types', () => {
  expectTypeOf(sqliteSqlCharDescriptor.factory({ length: 12 })).toEqualTypeOf<
    (ctx: CodecInstanceContext) => SqlCharCodec
  >();
  expectTypeOf(sqliteSqlIntDescriptor.factory()).toEqualTypeOf<
    (ctx: CodecInstanceContext) => SqlIntCodec
  >();
});

test('target descriptors preserve existing factory and column-helper results', () => {
  expectTypeOf(sqliteIntegerDescriptor.factory()).toEqualTypeOf<
    (ctx: CodecInstanceContext) => import('../src/core/codecs').SqliteIntegerCodec
  >();
  expectTypeOf(sqliteBlobColumn().codecFactory).toEqualTypeOf<
    (ctx: CodecInstanceContext) => SqliteBlobCodec
  >();
  expectTypeOf(sqliteBigintColumn().codecFactory).toEqualTypeOf<
    (ctx: CodecInstanceContext) => SqliteBigintCodec
  >();
});

test('typed registry exposes only SQLite descriptors', () => {
  expectTypeOf(sqliteCodecDescriptorRegistry).toEqualTypeOf<SqliteCodecDescriptorRegistry>();
  expectTypeOf(sqliteCodecDescriptorRegistry.descriptorFor('sqlite/integer@1')).toEqualTypeOf<
    AnySqliteCodecDescriptor | undefined
  >();
});

test('codec types retain generic and native descriptor membership', () => {
  expectTypeOf<CodecTypes['sql/char@1']['input']>().toEqualTypeOf<string>();
  expectTypeOf<CodecTypes['sql/varchar@1']['output']>().toEqualTypeOf<string>();
  expectTypeOf<CodecTypes['sql/int@1']['output']>().toEqualTypeOf<number>();
  expectTypeOf<CodecTypes['sql/float@1']['input']>().toEqualTypeOf<number>();
  expectTypeOf<CodecTypes['sqlite/blob@1']['output']>().toEqualTypeOf<Uint8Array>();
  expectTypeOf<CodecTypes['sqlite/bigint@1']['input']>().toEqualTypeOf<bigint>();
});
