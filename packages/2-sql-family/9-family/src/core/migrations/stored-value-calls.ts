import type {
  EnumValueCoordinate,
  KeepDataEdit,
  OpFactoryCall,
  ResolvedMigrationStatement,
} from '@internal/framework-components/control';
import type { StoredValueReplacement, StoredValueRewrite } from './enum-value-planning';
import type { RowsHoldingValueMark } from './rows-holding-value';

/** What a planned stored value call is about, for its data-loss question. */
export interface StoredValueSubject {
  readonly enumValue: EnumValueCoordinate;
}

/** How the stored value code tells a target's removal calls apart and builds its replacement calls. */
export interface StoredValueCallClasses<TRemoval extends OpFactoryCall> {
  isRemoval(call: OpFactoryCall): call is TRemoval;
  /** The call that replaces one stored value with another in the column `removal` removes from. */
  replacementOf(removal: TRemoval, replacement: StoredValueReplacement): OpFactoryCall;
}

/** The enum value each removal is about. */
export function storedValueSubjects<TRemoval extends OpFactoryCall>(
  calls: ReadonlyMap<OpFactoryCall, StoredValueRewrite>,
  classes: StoredValueCallClasses<TRemoval>,
): ReadonlyMap<OpFactoryCall, StoredValueSubject> {
  return new Map(
    [...calls]
      .filter(([call]) => classes.isRemoval(call))
      .map(([call, rewrite]) => [call, { enumValue: rewrite.enumValue }]),
  );
}

/**
 * The edit that keeps the data a failed removal check found: `removal`, the call the check's mark
 * and its column describe, replaced by a replacement whose new value is the placeholder
 * `"<stored value>"`.
 */
export function keepRowsEdit<TRemoval extends OpFactoryCall>(
  removal: TRemoval,
  mark: RowsHoldingValueMark,
  classes: StoredValueCallClasses<TRemoval>,
): KeepDataEdit {
  return {
    remove: removal.renderTypeScript(),
    replaceWith: classes
      .replacementOf(removal, { from: mark.value, to: '<stored value>' })
      .renderTypeScript(),
  };
}

function operationCount(call: OpFactoryCall): number {
  return 'companions' in call && Array.isArray(call.companions) ? 1 + call.companions.length : 1;
}

/** The positions, among the plan's operations, of the operations that carry out `statement`. */
export function storedValueOperationIndexes(
  planCalls: readonly OpFactoryCall[],
  calls: ReadonlyMap<OpFactoryCall, { readonly statement: ResolvedMigrationStatement | undefined }>,
  statement: ResolvedMigrationStatement,
): readonly number[] {
  const indexes: number[] = [];
  let position = 0;
  for (const call of planCalls) {
    if (calls.get(call)?.statement === statement) indexes.push(position);
    position += operationCount(call);
  }
  return indexes;
}
