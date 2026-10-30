import type {
  EnumValueCoordinate,
  KeepDataEdit,
  OpFactoryCall,
  ResolvedMigrationStatement,
} from '@internal/framework-components/control';
import { ifDefined } from '@internal/utils/defined';
import type { StoredValueReplacement, StoredValueRewrite } from './enum-value-planning';
import type { RowsHoldingValueMark } from './rows-holding-value';

/** What a planned stored value call is about, for its data-loss question. */
export interface StoredValueSubject {
  readonly enumValue: EnumValueCoordinate;
  readonly keepDataEdit?: KeepDataEdit;
}

/** How the stored value code tells a target's removal calls apart and builds its replacement calls. */
export interface StoredValueCallClasses<TRemoval extends OpFactoryCall> {
  isRemoval(call: OpFactoryCall): call is TRemoval;
  /** The call that replaces one stored value with another in the column `removal` removes from. */
  replacementOf(removal: TRemoval, replacement: StoredValueReplacement): OpFactoryCall;
}

/** The edit that keeps the data a removal loses: the removal, replaced by the replacements, in order. */
function keepDataEdit<TRemoval extends OpFactoryCall>(
  removal: TRemoval,
  replacements: readonly StoredValueReplacement[],
  classes: StoredValueCallClasses<TRemoval>,
): KeepDataEdit {
  return {
    remove: removal.renderTypeScript(),
    replaceWith: replacements
      .map((replacement) => classes.replacementOf(removal, replacement).renderTypeScript())
      .join(', '),
  };
}

/**
 * The enum value each removal is about, with the edit that keeps its data when the member keeps
 * its name and only its stored value changes.
 */
export function storedValueSubjects<TRemoval extends OpFactoryCall>(
  calls: ReadonlyMap<OpFactoryCall, StoredValueRewrite>,
  classes: StoredValueCallClasses<TRemoval>,
): ReadonlyMap<OpFactoryCall, StoredValueSubject> {
  const subjects = new Map<OpFactoryCall, StoredValueSubject>();
  for (const [call, rewrite] of calls) {
    if (!classes.isRemoval(call)) continue;
    subjects.set(call, {
      enumValue: rewrite.enumValue,
      ...ifDefined(
        'keepDataEdit',
        rewrite.keepData === undefined
          ? undefined
          : {
              ...keepDataEdit(call, rewrite.keepData, classes),
              ...(rewrite.swapsValues ? { swapsValues: true } : {}),
            },
      ),
    });
  }
  return subjects;
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
  return keepDataEdit(removal, [{ from: mark.value, to: '<stored value>' }], classes);
}

function operationCount(call: OpFactoryCall): number {
  return 'companions' in call && Array.isArray(call.companions) ? 1 + call.companions.length : 1;
}

/** The positions, among the plan's operations, of the operations that carry out `statement`. */
export function storedValueOperationIndexes(
  planCalls: readonly OpFactoryCall[],
  calls: ReadonlyMap<OpFactoryCall, StoredValueRewrite>,
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
