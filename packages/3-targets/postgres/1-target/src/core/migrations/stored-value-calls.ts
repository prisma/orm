import type { Contract } from '@internal/contract/types';
import type {
  RowsHoldingValueMark,
  StoredValueCodec,
  StoredValueReplacement,
  StoredValueRewrite,
} from '@internal/family-sql/control';
import type { CodecLookupWithDescriptors } from '@internal/framework-components/codec';
import {
  type EnumValueCoordinate,
  enumValueCoordinateJson,
  type KeepDataEdit,
  type OpFactoryCall,
  type ResolvedMigrationStatement,
} from '@internal/framework-components/control';
import type { SqlStorage } from '@internal/sql-contract/types';
import { ifDefined } from '@internal/utils/defined';
import {
  type PostgresOpFactoryCall,
  RemoveStoredValueCall,
  ReplaceStoredValueCall,
} from './op-factory-call';
import type { CallMigrationStrategy } from './planner-strategies';
import type { PostgresPlanTargetDetails } from './planner-target-details';
import { emissionSchemaForNamespace } from './resolve-ddl-schema';

/** What a planned stored value call is about, for its data-loss question. */
export interface StoredValueSubject {
  readonly enumValue: EnumValueCoordinate;
  readonly keepDataEdit?: KeepDataEdit;
}

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

/** The edit that keeps the data a removal loses: the removal, replaced by the replacements, in order. */
function keepDataEdit(
  call: RemoveStoredValueCall,
  replacements: readonly StoredValueReplacement[],
): KeepDataEdit {
  return {
    remove: call.renderTypeScript(),
    replaceWith: replacements
      .map(({ from, to }) =>
        new ReplaceStoredValueCall(
          call.schemaName,
          call.tableName,
          call.columnName,
          from,
          to,
          call.many,
          call.codec,
        ).renderTypeScript(),
      )
      .join(', '),
  };
}

/**
 * The enum value each removal is about, with the edit that keeps its data when the member keeps
 * its name and only its stored value changes.
 */
export function storedValueSubjects(
  calls: ReadonlyMap<PostgresOpFactoryCall, StoredValueRewrite>,
): ReadonlyMap<OpFactoryCall, StoredValueSubject> {
  const subjects = new Map<OpFactoryCall, StoredValueSubject>();
  for (const [call, rewrite] of calls) {
    if (!(call instanceof RemoveStoredValueCall)) continue;
    subjects.set(call, {
      enumValue: rewrite.enumValue,
      ...ifDefined(
        'keepDataEdit',
        rewrite.keepData === undefined
          ? undefined
          : {
              ...keepDataEdit(call, rewrite.keepData),
              ...(rewrite.swapsValues ? { swapsValues: true } : {}),
            },
      ),
    });
  }
  return subjects;
}

const RENDER_ONLY_CODECS: Pick<CodecLookupWithDescriptors, 'descriptorFor'> = {
  descriptorFor: () => undefined,
};

/**
 * The edit that keeps the data a failed removal check found, from the check's mark and its
 * operation's column: the removal as `migration.ts` writes it, replaced by a replacement whose new
 * value is the placeholder `"<stored value>"`.
 */
export function keepRowsEdit(
  details: PostgresPlanTargetDetails & { readonly table: string },
  mark: RowsHoldingValueMark,
): KeepDataEdit {
  const codec =
    mark.codecRef === undefined
      ? undefined
      : { codecRef: mark.codecRef, codecs: RENDER_ONLY_CODECS };
  return keepDataEdit(
    new RemoveStoredValueCall(
      details.schema,
      details.table,
      details.name,
      mark.value,
      false,
      codec,
      mark.enumValue,
    ),
    [{ from: mark.value, to: '<stored value>' }],
  );
}

/** The positions, among the plan's operations, of the operations that carry out `statement`. */
export function storedValueOperationIndexes(
  planCalls: readonly PostgresOpFactoryCall[],
  calls: ReadonlyMap<PostgresOpFactoryCall, StoredValueRewrite>,
  statement: ResolvedMigrationStatement,
): readonly number[] {
  const indexes: number[] = [];
  let position = 0;
  for (const call of planCalls) {
    const rewrite = calls.get(call);
    if (rewrite?.statement === statement) indexes.push(position);
    position +=
      'companions' in call && Array.isArray(call.companions) ? 1 + call.companions.length : 1;
  }
  return indexes;
}
