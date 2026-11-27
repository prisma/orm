import type { ExtractCodecTypes } from '@internal/sql-contract/types';
import { expectTypeOf, test } from 'vitest';
import { pgvectorContract } from './contract-declaration-portability.fixture';

type ContractCodecTypes = ExtractCodecTypes<typeof pgvectorContract>;
type PgvectorCodecTypes = NonNullable<
  (typeof pgvectorContract.extensions.pgvector)['__codecTypes']
>;

test('exported contracts retain pgvector public type metadata', () => {
  const extension = pgvectorContract.extensions.pgvector;

  expectTypeOf(pgvectorContract.target).toEqualTypeOf<'postgres'>();
  expectTypeOf(pgvectorContract.targetFamily).toEqualTypeOf<'sql'>();
  expectTypeOf(extension.kind).toEqualTypeOf<'extension'>();
  expectTypeOf(extension.id).toEqualTypeOf<'pgvector'>();
  expectTypeOf(extension.familyId).toEqualTypeOf<'sql'>();
  expectTypeOf(extension.targetId).toEqualTypeOf<'postgres'>();
  expectTypeOf(extension.authoring.type.pgvector.Vector.kind).toEqualTypeOf<'typeConstructor'>();
  expectTypeOf(extension.types.codecTypes.import.package).toEqualTypeOf<`${string}/codec-types`>();
  expectTypeOf<PgvectorCodecTypes['pg/vector@1']['input']>().toEqualTypeOf<number[]>();
  expectTypeOf<PgvectorCodecTypes['pg/vector@1']['output']>().toEqualTypeOf<number[]>();
  expectTypeOf<ContractCodecTypes['pg/vector@1']['input']>().toEqualTypeOf<number[]>();
  expectTypeOf<ContractCodecTypes['pg/vector@1']['output']>().toEqualTypeOf<number[]>();
  expectTypeOf<ContractCodecTypes['pg/vector@1']['traits']>().toEqualTypeOf<'equality'>();
});
