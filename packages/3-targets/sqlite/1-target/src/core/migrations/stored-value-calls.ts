import type {
  RowsHoldingValueMark,
  StoredKeyFill,
  StoredKeyRewrite,
  StoredValueCallClasses,
  StoredValueRewrite,
  VariantRowRewrite,
} from '@internal/family-sql/control';
import type { CodecLookupWithDescriptors, TypeLookups } from '@internal/framework-components/codec';
import { enumValueCoordinateJson } from '@internal/framework-components/control';
import {
  DeleteRowsCall,
  FillStoredKeyCall,
  RemoveStoredKeyCall,
  RemoveStoredValueCall,
  RenameStoredKeyCall,
  ReplaceStoredValueCall,
} from './op-factory-call';

type StoredValueCall = ReplaceStoredValueCall | RemoveStoredValueCall;

/** The calls that carry out a plan's stored value rewrites, each with the rewrite it carries out. */
export function sqliteStoredValueCalls(
  rewrites: readonly StoredValueRewrite[],
  codecs: Pick<CodecLookupWithDescriptors, 'descriptorFor'>,
): ReadonlyMap<StoredValueCall, StoredValueRewrite> {
  return new Map(
    rewrites.map((rewrite): readonly [StoredValueCall, StoredValueRewrite] => {
      const codec =
        rewrite.codecRef === undefined ? undefined : { codecRef: rewrite.codecRef, codecs };
      const { member } = rewrite;
      return [
        rewrite.to === undefined
          ? new RemoveStoredValueCall(
              rewrite.table,
              rewrite.column,
              rewrite.from,
              codec,
              enumValueCoordinateJson(rewrite.enumValue),
              member?.path,
              member?.nullable === true ? true : undefined,
            )
          : new ReplaceStoredValueCall(
              rewrite.table,
              rewrite.column,
              rewrite.from,
              rewrite.to,
              codec,
              member?.path,
            ),
        rewrite,
      ];
    }),
  );
}

/** The calls that carry out a plan's key rewrites of value object fields, each with the rewrite it carries out. */
export function sqliteStoredKeyCalls(
  rewrites: readonly StoredKeyRewrite[],
): ReadonlyMap<RenameStoredKeyCall | RemoveStoredKeyCall, StoredKeyRewrite> {
  return new Map(
    rewrites.map((rewrite) => [
      rewrite.to === undefined
        ? new RemoveStoredKeyCall(rewrite.table, rewrite.column, rewrite.path)
        : new RenameStoredKeyCall(rewrite.table, rewrite.column, rewrite.path, rewrite.to),
      rewrite,
    ]),
  );
}

/** The calls that carry out a plan's fills of value object fields, each with the fill it carries out. */
export function sqliteStoredKeyFillCalls(
  fills: readonly StoredKeyFill[],
  types: TypeLookups,
): ReadonlyMap<FillStoredKeyCall, StoredKeyFill> {
  return new Map(
    fills.map((fill) => [
      new FillStoredKeyCall(
        fill.table,
        fill.column,
        fill.path,
        fill.value,
        fill.codecRef === undefined ? undefined : { codecRef: fill.codecRef, types },
      ),
      fill,
    ]),
  );
}

/** The calls that carry out a plan's row rewrites of variants, each with the rewrite it carries out. */
export function sqliteVariantRowCalls(
  rewrites: readonly VariantRowRewrite[],
  codecs: Pick<CodecLookupWithDescriptors, 'descriptorFor'>,
): ReadonlyMap<DeleteRowsCall | ReplaceStoredValueCall, VariantRowRewrite> {
  return new Map(
    rewrites.map((rewrite) => {
      const codec = { codecRef: rewrite.codecRef, codecs };
      return [
        rewrite.to === undefined
          ? new DeleteRowsCall(
              rewrite.table,
              rewrite.column,
              rewrite.from,
              codec,
              rewrite.variantTable === undefined
                ? []
                : [
                    {
                      table: rewrite.variantTable.table,
                      columns: rewrite.variantTable.columns,
                      references: rewrite.variantTable.references,
                    },
                  ],
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
