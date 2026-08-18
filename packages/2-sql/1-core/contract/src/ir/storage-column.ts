import type { ColumnDefault, ControlPolicy, ValueSetRef } from '@internal/contract/types';
import { freezeNode } from '@internal/framework-components/ir';
import type { CheckKind } from '@internal/sql-schema-ir/naming';
import { contractError } from '../contract-errors';
import { SqlNode } from './sql-node';

/**
 * Hydration / construction input shape for {@link StorageColumn}. Mirrors
 * the on-disk storage JSON envelope exactly so the family-base
 * serializer's hydration walker can hand an arktype-validated literal
 * straight to `new`.
 *
 * `typeParams` and `typeRef` remain mutually exclusive (one or the
 * other, not both); the constructor preserves whichever caller-side
 * choice the input encodes.
 */
type StorageColumnMultiplicity =
  | { readonly many: true; readonly elementNullable: true }
  | { readonly many?: boolean; readonly elementNullable?: never };

export type StorageColumnInput = {
  readonly nativeType: string;
  readonly codecId: string;
  readonly nullable: boolean;
  readonly typeParams?: Record<string, unknown>;
  readonly typeRef?: string;
  readonly default?: ColumnDefault;
  readonly control?: ControlPolicy;
  readonly valueSet?: ValueSetRef;
  /** Generated-check kinds the author declined for this column. Presence means opted out; never an empty array. */
  readonly noCheck?: readonly CheckKind[];
} & StorageColumnMultiplicity;

/**
 * SQL Contract IR node for a single column entry in `StorageTable.columns`.
 *
 * Single concrete family-shared class — every SQL target reads the
 * same column shape today, so there is no per-target subclass. The
 * class type accepts any caller that constructs via
 * `new StorageColumn(input)`; literal construction sites must pass
 * through the constructor or the family-base hydration walker.
 *
 * The column's `name` is not on the class — columns are keyed by name
 * in the parent `StorageTable.columns: Record<string, StorageColumn>`
 * map, so a `name` field would be redundant with the key.
 */
export class StorageColumn extends SqlNode {
  readonly nativeType: string;
  readonly codecId: string;
  readonly nullable: boolean;
  declare readonly many?: boolean;
  declare readonly elementNullable?: true;
  declare readonly typeParams?: Record<string, unknown>;
  declare readonly typeRef?: string;
  declare readonly default?: ColumnDefault;
  declare readonly control?: ControlPolicy;
  declare readonly valueSet?: ValueSetRef;
  /** Generated-check kinds the author declined for this column. Presence means opted out; never an empty array. */
  declare readonly noCheck?: readonly CheckKind[];

  constructor(input: StorageColumnInput) {
    super();
    if (
      input.elementNullable !== undefined &&
      (input.elementNullable !== true || input.many !== true)
    ) {
      throw contractError(
        'CONTRACT.ARGUMENT_INVALID',
        'StorageColumn elementNullable requires many:true.',
        { meta: { reason: 'elementNullable-without-many' } },
      );
    }
    this.nativeType = input.nativeType;
    this.codecId = input.codecId;
    this.nullable = input.nullable;
    if (input.many !== undefined) this.many = input.many;
    if (input.elementNullable !== undefined) this.elementNullable = input.elementNullable;
    if (input.noCheck !== undefined) this.noCheck = input.noCheck;
    if (input.typeParams !== undefined) this.typeParams = input.typeParams;
    if (input.typeRef !== undefined) this.typeRef = input.typeRef;
    if (input.default !== undefined) this.default = input.default;
    if (input.control !== undefined) this.control = input.control;
    if (input.valueSet !== undefined) this.valueSet = input.valueSet;
    freezeNode(this);
  }

  static from(value: StorageColumn | StorageColumnInput): StorageColumn {
    return value instanceof StorageColumn ? value : new StorageColumn(value);
  }
}
