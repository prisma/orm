import type { Contract } from '@internal/contract/types';
import type {
  RowsHoldingValueMark,
  StoredValueCallClasses,
  StoredValueCodec,
  StoredValueRewrite,
} from '@internal/family-sql/control';
import type { CodecLookupWithDescriptors } from '@internal/framework-components/codec';
import { enumValueCoordinateJson } from '@internal/framework-components/control';
import type { SqlStorage } from '@internal/sql-contract/types';
import {
  type PostgresOpFactoryCall,
  RemoveStoredValueCall,
  ReplaceStoredValueCall,
} from './op-factory-call';
import type { CallMigrationStrategy } from './planner-strategies';
import { emissionSchemaForNamespace } from './resolve-ddl-schema';

/** The calls that carry out a plan's stored value rewrites, each with the rewrite it carries out. */
export function postgresStoredValueCalls(
  rewrites: readonly StoredValueRewrite[],
  contract: Contract<SqlStorage>,
  codecs: Pick<CodecLookupWithDescriptors, 'descriptorFor'>,
): ReadonlyMap<PostgresOpFactoryCall, StoredValueRewrite> {
  return new Map(
    rewrites.map((rewrite): readonly [PostgresOpFactoryCall, StoredValueRewrite] => {
      const schemaName = emissionSchemaForNamespace(contract, rewrite.namespaceId);
      const codec: StoredValueCodec = { codecRef: rewrite.codecRef, codecs };
      const call =
        rewrite.to === undefined
          ? new RemoveStoredValueCall(
              schemaName,
              rewrite.table,
              rewrite.column,
              rewrite.from,
              rewrite.many,
              codec,
              enumValueCoordinateJson(rewrite.enumValue),
            )
          : new ReplaceStoredValueCall(
              schemaName,
              rewrite.table,
              rewrite.column,
              rewrite.from,
              rewrite.to,
              rewrite.many,
              codec,
            );
      return [call, rewrite];
    }),
  );
}

/** Puts the stored value calls among the calls the diff plans, which order them. */
export function storedValueCallsStrategy(
  calls: readonly PostgresOpFactoryCall[],
): CallMigrationStrategy {
  return (issues) => (calls.length === 0 ? { kind: 'no_match' } : { kind: 'match', issues, calls });
}

/** How the family's stored value code tells Postgres removals apart and builds replacements. */
export const postgresStoredValueCallClasses: StoredValueCallClasses<RemoveStoredValueCall> = {
  isRemoval: (call): call is RemoveStoredValueCall => call instanceof RemoveStoredValueCall,
  replacementOf: (removal, { from, to }) =>
    new ReplaceStoredValueCall(
      removal.schemaName,
      removal.tableName,
      removal.columnName,
      from,
      to,
      removal.many,
      removal.codec,
      removal.path?.text,
    ),
};

const RENDER_ONLY_CODECS: Pick<CodecLookupWithDescriptors, 'descriptorFor'> = {
  descriptorFor: () => undefined,
};

/** The removal a failed check's mark describes, in the schema its operation names, as `migration.ts` writes it. */
export function postgresMarkedRemoval(
  schema: string,
  mark: RowsHoldingValueMark,
): RemoveStoredValueCall {
  const codec =
    mark.codecRef === undefined
      ? undefined
      : { codecRef: mark.codecRef, codecs: RENDER_ONLY_CODECS };
  return new RemoveStoredValueCall(
    schema,
    mark.table,
    mark.column,
    mark.value,
    false,
    codec,
    mark.enumValue,
    mark.path,
  );
}
