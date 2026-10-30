import type {
  RowsHoldingValueMark,
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
import { ifDefined } from '@internal/utils/defined';
import { RemoveStoredValueCall, ReplaceStoredValueCall } from './op-factory-call';

type StoredValueCall = ReplaceStoredValueCall | RemoveStoredValueCall;

/** What a planned stored value call is about, for its data-loss question. */
export interface StoredValueSubject {
  readonly enumValue: EnumValueCoordinate;
  readonly keepDataEdit?: KeepDataEdit;
}

/** The calls that carry out a plan's stored value rewrites, each with the rewrite it carries out. */
export function sqliteStoredValueCalls(
  rewrites: readonly StoredValueRewrite[],
  codecs: Pick<CodecLookupWithDescriptors, 'descriptorFor'>,
): ReadonlyMap<StoredValueCall, StoredValueRewrite> {
  return new Map(
    rewrites.map((rewrite): readonly [StoredValueCall, StoredValueRewrite] => {
      const codec = { codecRef: rewrite.codecRef, codecs };
      return [
        rewrite.to === undefined
          ? new RemoveStoredValueCall(
              rewrite.table,
              rewrite.column,
              rewrite.from,
              codec,
              enumValueCoordinateJson(rewrite.enumValue),
            )
          : new ReplaceStoredValueCall(
              rewrite.table,
              rewrite.column,
              rewrite.from,
              rewrite.to,
              codec,
            ),
        rewrite,
      ];
    }),
  );
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
          call.tableName,
          call.columnName,
          from,
          to,
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
  calls: ReadonlyMap<StoredValueCall, StoredValueRewrite>,
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
  table: string,
  column: string,
  mark: RowsHoldingValueMark,
): KeepDataEdit {
  const codec =
    mark.codecRef === undefined
      ? undefined
      : { codecRef: mark.codecRef, codecs: RENDER_ONLY_CODECS };
  return keepDataEdit(new RemoveStoredValueCall(table, column, mark.value, codec, mark.enumValue), [
    { from: mark.value, to: '<stored value>' },
  ]);
}

/** The positions, among the plan's operations, of the operations that carry out `statement`. */
export function storedValueOperationIndexes(
  planCalls: readonly OpFactoryCall[],
  calls: ReadonlyMap<StoredValueCall, StoredValueRewrite>,
  statement: ResolvedMigrationStatement,
): readonly number[] {
  const indexes: number[] = [];
  let position = 0;
  for (const call of planCalls) {
    const rewrite =
      call instanceof ReplaceStoredValueCall || call instanceof RemoveStoredValueCall
        ? calls.get(call)
        : undefined;
    if (rewrite?.statement === statement) indexes.push(position);
    position +=
      'companions' in call && Array.isArray(call.companions) ? 1 + call.companions.length : 1;
  }
  return indexes;
}
