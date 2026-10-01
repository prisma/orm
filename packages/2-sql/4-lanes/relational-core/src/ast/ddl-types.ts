import type { ColumnDefaultLiteralInputValue } from '@internal/contract/types';
import { isColumnDefaultLiteralInputValue } from '@internal/contract/types';
import type { ReferentialAction } from '@internal/sql-contract/types';
import { structuredError } from '@internal/utils/structured-error';
import type { CodecRef } from './codec-types';
import type { AnyParamRef } from './types';

/**
 * Render-time context the column-default visitor needs to make dialect
 * decisions that depend on the parent column. Today only the parent
 * column's native type (`"jsonb"`, `"text"`, …) — the Postgres renderer
 * uses it to decide whether to emit a `::jsonb` / `::json` cast on JSON
 * literal defaults so the emitted DDL matches the column type without
 * relying on Postgres's implicit text → jsonb cast at default-evaluation
 * time. Additional fields can join without re-shaping the interface.
 */
export interface DdlColumnRenderContext {
  readonly nativeType: string;
}

export interface DdlColumnDefaultVisitor<R> {
  literal(node: LiteralColumnDefault, ctx: DdlColumnRenderContext): R;
  function(node: FunctionColumnDefault, ctx: DdlColumnRenderContext): R;
}

export abstract class DdlColumnDefault {
  abstract readonly kind: string;
  abstract accept<R>(visitor: DdlColumnDefaultVisitor<R>, ctx: DdlColumnRenderContext): R;

  protected freeze(): void {
    Object.freeze(this);
  }
}

export class LiteralColumnDefault extends DdlColumnDefault {
  readonly kind = 'literal' as const;
  readonly value: ColumnDefaultLiteralInputValue;

  constructor(value: ColumnDefaultLiteralInputValue) {
    super();
    if (!isColumnDefaultLiteralInputValue(value)) {
      throw structuredError('CONTRACT.DEFAULT_INVALID', 'Invalid column default literal value');
    }
    this.value = value;
    this.freeze();
  }

  override accept<R>(visitor: DdlColumnDefaultVisitor<R>, ctx: DdlColumnRenderContext): R {
    return visitor.literal(this, ctx);
  }
}

export class FunctionColumnDefault extends DdlColumnDefault {
  readonly kind = 'function' as const;
  readonly expression: string;

  constructor(expression: string) {
    super();
    this.expression = expression;
    this.freeze();
  }

  override accept<R>(visitor: DdlColumnDefaultVisitor<R>, ctx: DdlColumnRenderContext): R {
    return visitor.function(this, ctx);
  }
}

export type AnyDdlColumnDefault = LiteralColumnDefault | FunctionColumnDefault;

export class DdlColumn {
  readonly name: string;
  readonly type: string;
  readonly notNull?: boolean | undefined;
  readonly primaryKey?: boolean | undefined;
  readonly default?: AnyDdlColumnDefault | undefined;
  /** Codec identity for this column. When present, the DDL walker builds the codec with the column's type parameters and runs the literal default through both declared conversions in order — `codec.encode(codec.decodeJson(default.value), {})` — to obtain the wire value it inlines into the DDL string (`encodeLiteralDefault`), and reads each element of a list default the same way (`encodeListLiteralDefault`). A target may write a default of one of its date or time types as that type's text instead, once the codec has read it. The read-back is what makes the pair sound: a contract stores a literal default in the codec's canonical JSON, which is not always the application value `encode` takes (`pg/int8@1` stores decimal text for a `bigint`). A `Date` is the one authored value JSON has no notation for, so it arrives as itself and skips `decodeJson`. A `null` default the codec refuses is SQL NULL, `DEFAULT NULL`; a JSON codec reads it as the JSON value null. When absent, literal defaults follow RawSqlLiteral wire-scalar semantics (string / number / boolean / bigint / null / Uint8Array / Date inlined directly). */
  readonly codecRef?: CodecRef | undefined;

  constructor(options: {
    readonly name: string;
    readonly type: string;
    readonly notNull?: boolean;
    readonly primaryKey?: boolean;
    readonly default?: AnyDdlColumnDefault;
    readonly codecRef?: CodecRef;
  }) {
    this.name = options.name;
    this.type = options.type;
    this.notNull = options.notNull;
    this.primaryKey = options.primaryKey;
    this.default = options.default;
    this.codecRef = options.codecRef;
    Object.freeze(this);
  }
}

export abstract class DdlNode {
  abstract readonly kind: string;

  /**
   * Structural brand: every DDL node answers `true`. Lets {@link isDdlNode}
   * recognise any `DdlNode` subclass — including target-contributed kinds —
   * without a central kind registry that subclasses would have to register
   * into.
   */
  isDdlNode(): true {
    return true;
  }

  protected freeze(): void {
    Object.freeze(this);
  }

  collectParamRefs(): AnyParamRef[] {
    return [];
  }
}

export function isDdlNode(value: unknown): value is DdlNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    'isDdlNode' in value &&
    typeof value.isDdlNode === 'function'
  );
}

// ---------------------------------------------------------------------------
// Table-level constraint nodes
// ---------------------------------------------------------------------------

/**
 * A composite (or single-column) PRIMARY KEY constraint on a `CreateTable`
 * node. When `name` is set, the adapter renders `CONSTRAINT <name> PRIMARY KEY
 * (…)`; otherwise it renders an anonymous `PRIMARY KEY (…)`.
 *
 * Frozen on construction — immutable after creation.
 */
export class PrimaryKeyConstraint {
  readonly kind = 'primary-key' as const;
  readonly columns: ReadonlyArray<string>;
  readonly name: string | undefined;

  constructor(options: { readonly columns: readonly string[]; readonly name?: string }) {
    this.columns = Object.freeze([...options.columns]);
    this.name = options.name;
    Object.freeze(this);
  }
}

/**
 * A FOREIGN KEY constraint on a `CreateTable` node. `onDelete` and `onUpdate`
 * use the same `ReferentialAction` vocabulary already used by the migration
 * planner and the contract IR — no parallel string enum.
 *
 * Frozen on construction — immutable after creation.
 */
export class ForeignKeyConstraint {
  readonly kind = 'foreign-key' as const;
  readonly columns: ReadonlyArray<string>;
  readonly refTable: string;
  readonly refColumns: ReadonlyArray<string>;
  readonly onDelete: ReferentialAction | undefined;
  readonly onUpdate: ReferentialAction | undefined;
  readonly name: string | undefined;

  constructor(options: {
    readonly columns: readonly string[];
    readonly refTable: string;
    readonly refColumns: readonly string[];
    readonly onDelete?: ReferentialAction;
    readonly onUpdate?: ReferentialAction;
    readonly name?: string;
  }) {
    this.columns = Object.freeze([...options.columns]);
    this.refTable = options.refTable;
    this.refColumns = Object.freeze([...options.refColumns]);
    this.onDelete = options.onDelete;
    this.onUpdate = options.onUpdate;
    this.name = options.name;
    Object.freeze(this);
  }
}

/**
 * A table-level UNIQUE constraint on a `CreateTable` node. When `name` is
 * set, the adapter renders `CONSTRAINT <name> UNIQUE (…)`; otherwise it
 * renders an anonymous `UNIQUE (…)`.
 *
 * Frozen on construction — immutable after creation.
 */
export class UniqueConstraint {
  readonly kind = 'unique' as const;
  readonly columns: ReadonlyArray<string>;
  readonly name: string | undefined;

  constructor(options: { readonly columns: readonly string[]; readonly name?: string }) {
    this.columns = Object.freeze([...options.columns]);
    this.name = options.name;
    Object.freeze(this);
  }
}

/**
 * A table-level CHECK constraint carrying a raw SQL predicate expression. Used
 * for checks that are not enum value-set restrictions — e.g. the element-non-null
 * constraint on a scalar-array column (`array_position(col, NULL) IS NULL`).
 * The `expression` is emitted verbatim, so callers must supply safe,
 * pre-validated SQL.
 *
 * Frozen on construction — immutable after creation.
 */
export class CheckExpressionConstraint {
  readonly kind = 'check-expression' as const;
  readonly name: string;
  readonly expression: string;

  constructor(options: { readonly name: string; readonly expression: string }) {
    this.name = options.name;
    this.expression = options.expression;
    Object.freeze(this);
  }
}

export type DdlTableConstraint =
  | PrimaryKeyConstraint
  | ForeignKeyConstraint
  | UniqueConstraint
  | CheckExpressionConstraint;
