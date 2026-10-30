import type {
  RowsHoldingValueMark,
  StoredValueCallClasses,
  StoredValueRewrite,
} from '@internal/family-sql/control';
import type { CodecLookupWithDescriptors } from '@internal/framework-components/codec';
import { enumValueCoordinateJson } from '@internal/framework-components/control';
import { RemoveStoredValueCall, ReplaceStoredValueCall } from './op-factory-call';

type StoredValueCall = ReplaceStoredValueCall | RemoveStoredValueCall;

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

/** How the family's stored value code tells SQLite removals apart and builds replacements. */
export const sqliteStoredValueCallClasses: StoredValueCallClasses<RemoveStoredValueCall> = {
  isRemoval: (call): call is RemoveStoredValueCall => call instanceof RemoveStoredValueCall,
  replacementOf: (removal, { from, to }) =>
    new ReplaceStoredValueCall(
      removal.tableName,
      removal.columnName,
      from,
      to,
      removal.codec,
      removal.path?.text,
    ),
};

const RENDER_ONLY_CODECS: Pick<CodecLookupWithDescriptors, 'descriptorFor'> = {
  descriptorFor: () => undefined,
};

/** The removal a failed check's mark describes, as `migration.ts` writes it. */
export function sqliteMarkedRemoval(mark: RowsHoldingValueMark): RemoveStoredValueCall {
  const codec =
    mark.codecRef === undefined
      ? undefined
      : { codecRef: mark.codecRef, codecs: RENDER_ONLY_CODECS };
  return new RemoveStoredValueCall(
    mark.table,
    mark.column,
    mark.value,
    codec,
    mark.enumValue,
    mark.path,
  );
}
