import type { ColumnDefault } from '@internal/contract/types';
import type { CodecRef, DataType, DataTypeParams } from '@internal/framework-components/codec';
import type { DiffableNode, MismatchExplanation } from '@internal/framework-components/control';
import { freezeNode } from '@internal/framework-components/ir';
import { canonicalizeJson } from '@internal/framework-components/utils';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { RelationalSchemaNodeKind } from './schema-node-kinds';
import { SqlColumnDefaultIR, type SqlExpressionLiteralFor } from './sql-column-default-ir';
import type { SqlDefaultValue } from './sql-default-value';
import { assertNode, defineNonEnumerable, SqlSchemaIRNode } from './sql-schema-ir-node';

/**
 * Namespaced annotations for extensibility. Each namespace
 * (e.g. `pg`, `pgvector`) owns its annotations subtree.
 */
export type SqlAnnotations = {
  readonly [namespace: string]: unknown;
};

/** What introspection hands over about the element type of one column. */
export interface ReportedSqlType {
  /** The element type's text as the database reports it: on Postgres its catalog text (`format_type`), on SQLite the declared type from `PRAGMA table_info`. */
  readonly text: string;
  /** The target's word for the type's kind, such as `enum`; undefined for a base type. */
  readonly kind: string | undefined;
  readonly schema: string | undefined;
  /** The type's name, unquoted. */
  readonly name: string | undefined;
}

export interface SqlColumnIRInput {
  readonly name: string;
  /**
   * The column's element type as text; nothing compares it. On the contract-derived side, the name a migration writes for the type the column is stored as, with an enum named as the contract names it. On the introspected side, the type as introspection reads it: on Postgres the `format_type` text, which keeps the schema of a type off the search path, except that an enum is named as a contract names it; on SQLite the declared type, lower-cased. Mismatch messages and the schema tree show it, and default parsing reads it: the target's `resolveDefault` hook on the contract side, and SQLite's default reader on the introspected side. Columns are compared by {@link storedType} and {@link storedTypeParams}.
   */
  readonly typeText: string;
  readonly nullable: boolean;
  /** Raw database default expression (e.g. `'hello'::text`, `nextval('seq')`). */
  readonly default?: string;
  readonly annotations?: SqlAnnotations;
  /** True when the column is a native array (e.g. `text[]`, `int4[]`). The `typeText` carries the element type only (e.g. `text`, `int4`). */
  readonly many?: boolean;
  /**
   * Structured default, comparable across the two diff sides: the
   * contract-derived side stamps the contract's `ColumnDefault`; the
   * introspected side stamps the target default-normalizer's parse of the
   * raw expression. Absent when the column declares no default, or when
   * the introspected raw default could not be parsed.
   */
  readonly resolvedDefault?: ColumnDefault;
  /**
   * The contract's default exactly as authored, before the target's `resolveDefault` hook. The
   * planner's DDL builders render this one, so the DDL carries the authored expression while
   * `resolvedDefault` is what the diff compares. Absent on the introspected side.
   */
  readonly authoredDefault?: ColumnDefault;
  /**
   * The column's resolved codec reference — the identity the migration
   * planner's op-builders resolve DDL type rendering against at plan time
   * (parameterized type expansion, e.g. `character` + `{ length: 36 }` →
   * `character(36)`), calling the same codec hooks the pre-`plan(start,
   * end)` op-path called. Carried the same way the query AST carries
   * `CodecRef` (TML-2456) and the migration DDL renderer (TML-2918).
   * Stamped on the EXPECTED (contract-derived) column at derivation,
   * from the column's own codec and params. Absent on
   * introspected/hand-built nodes — the actual side never renders DDL —
   * and never compared by `isEqualTo`.
   */
  readonly codecRef?: CodecRef;
  /**
   * The type the column is stored as, whose name DDL writes and the database reports (ADR 254): on the contract-derived side the type its codec's data type is stored as, on the introspected side the type that claims the reported type. Absent on an introspected column no data type claims.
   */
  readonly storedType?: DataType;
  /** The parameters of {@link storedType} in its normal form, for comparing; empty for a type without parameters. Present exactly when `storedType` is. DDL writes the parameters as written, from {@link codecRef}. */
  readonly storedTypeParams?: DataTypeParams;
  /**
   * A literal default as a value of the column's data type (ADR 254): on the contract-derived side read from the contract by the column's type, on the introspected side read from the database by the column's codec. The diff compares defaults by it. Absent when no type or codec read one.
   */
  readonly defaultValue?: SqlDefaultValue;
  /** Why the column's codec could not read the literal default the database reports. Introspected side only. */
  readonly defaultUnreadable?: string;
  /**
   * When the contract's default is an expression that writes a literal, such as `` sql`'hello'::bytea` ``, the value the column's codec reads from that literal. Introspection reads it, beside the reported default, because only introspection reads with a codec; the diff compares it with the reported default's value. Introspected side only.
   */
  readonly defaultExpressionValue?: SqlDefaultValue;
  /**
   * The `sql` literal that writes a SQL text, or `undefined` when no literal reads back as that
   * text. The SQL family supplies it, so a mismatch can show a default as the user would write it.
   * Stamped on the contract-derived column; absent on introspected nodes.
   */
  readonly sqlExpressionLiteralFor?: SqlExpressionLiteralFor;
  /** The element type as the database reports it. Set by introspection; absent on contract-derived nodes. */
  readonly reportedType?: ReportedSqlType;
  /**
   * The element type exactly as the database catalog prints it, on a contract-derived column whose data type's name is its catalog text (ADR 273). Such a column's type is compared by this text, not by {@link storedType}: see {@link sqlColumnTypesEqual}.
   */
  readonly catalogText?: string;
}

/**
 * Schema IR node for a single column on a table, as observed by
 * introspection. Unlike the Contract IR `StorageColumn`, this carries
 * the column's `name` (Schema IR columns are returned as arrays from
 * introspection queries; the parent table re-keys them into a record
 * for downstream consumers).
 *
 * Implements `DiffableNode` so a column is directly a table's diff-tree
 * child: `id` is the column name (unique among a table's columns); `isEqualTo`
 * compares this column's own attributes only, never its default, which is a
 * child node: the type by {@link sqlColumnTypesEqual}, and nullability.
 */
export class SqlColumnIR extends SqlSchemaIRNode implements DiffableNode {
  override readonly nodeKind = RelationalSchemaNodeKind.column;

  readonly name: string;
  /** See {@link SqlColumnIRInput.typeText}. */
  readonly typeText: string;
  readonly nullable: boolean;
  declare readonly default?: string;
  declare readonly annotations?: SqlAnnotations;
  /** True when the column is a native array (e.g. `text[]`, `int4[]`). The `typeText` carries the element type only (e.g. `text`, `int4`). */
  declare readonly many?: boolean;
  declare readonly resolvedDefault?: ColumnDefault;
  /** See {@link SqlColumnIRInput.authoredDefault}. Non-enumerable so it stays out of JSON and structural equality. */
  declare readonly authoredDefault?: ColumnDefault;
  /** See {@link SqlColumnIRInput.codecRef}. Non-enumerable so it stays out of JSON and structural equality. */
  declare readonly codecRef?: CodecRef;
  /** See {@link SqlColumnIRInput.storedType}. Non-enumerable, same reason as {@link codecRef}. */
  declare readonly storedType?: DataType;
  /** See {@link SqlColumnIRInput.storedTypeParams}. Non-enumerable, same reason as {@link codecRef}. */
  declare readonly storedTypeParams?: DataTypeParams;
  /** See {@link SqlColumnIRInput.defaultValue}. Non-enumerable, same reason as {@link codecRef}. */
  declare readonly defaultValue?: SqlDefaultValue;
  /** See {@link SqlColumnIRInput.defaultUnreadable}. Non-enumerable, same reason as {@link codecRef}. */
  declare readonly defaultUnreadable?: string;
  /** See {@link SqlColumnIRInput.defaultExpressionValue}. Non-enumerable, same reason as {@link codecRef}. */
  declare readonly defaultExpressionValue?: SqlDefaultValue;
  /** See {@link SqlColumnIRInput.sqlExpressionLiteralFor}. Non-enumerable, same reason as {@link codecRef}. */
  declare readonly sqlExpressionLiteralFor?: SqlExpressionLiteralFor;
  /** See {@link SqlColumnIRInput.reportedType}. Non-enumerable, same reason as {@link codecRef}. */
  declare readonly reportedType?: ReportedSqlType;
  /** See {@link SqlColumnIRInput.catalogText}. Non-enumerable, same reason as {@link codecRef}. */
  declare readonly catalogText?: string;

  constructor(input: SqlColumnIRInput) {
    super();
    this.name = input.name;
    this.typeText = input.typeText;
    this.nullable = input.nullable;
    if (input.default !== undefined) this.default = input.default;
    if (input.annotations !== undefined) this.annotations = input.annotations;
    if (input.many !== undefined) this.many = input.many;
    if (input.resolvedDefault !== undefined) this.resolvedDefault = input.resolvedDefault;
    defineNonEnumerable(this, 'authoredDefault', input.authoredDefault);
    defineNonEnumerable(this, 'codecRef', input.codecRef);
    defineNonEnumerable(this, 'storedType', input.storedType);
    defineNonEnumerable(this, 'storedTypeParams', input.storedTypeParams);
    defineNonEnumerable(this, 'defaultValue', input.defaultValue);
    defineNonEnumerable(this, 'defaultUnreadable', input.defaultUnreadable);
    defineNonEnumerable(this, 'defaultExpressionValue', input.defaultExpressionValue);
    defineNonEnumerable(this, 'sqlExpressionLiteralFor', input.sqlExpressionLiteralFor);
    defineNonEnumerable(this, 'reportedType', input.reportedType);
    defineNonEnumerable(this, 'catalogText', input.catalogText);
    freezeNode(this);
  }

  get id(): string {
    return `column:${this.name}`;
  }

  /**
   * The column's default, when declared/present, is the column's one child
   * node — it has an extra/missing/drift lifecycle of its own, so the differ
   * recurses to it rather than `isEqualTo` comparing it. Built transiently
   * from this column's own fields.
   */
  children(): readonly DiffableNode[] {
    if (this.resolvedDefault === undefined && this.default === undefined) {
      return [];
    }
    return [
      new SqlColumnDefaultIR({
        ...ifDefined('resolved', this.resolvedDefault),
        ...ifDefined('raw', this.default),
        ...ifDefined('authored', this.authoredDefault),
        ...ifDefined('value', this.defaultValue),
        ...ifDefined('unreadable', this.defaultUnreadable),
        ...ifDefined('expressionValue', this.defaultExpressionValue),
        // Contract-derived and introspected columns both set `this.many`
        // directly (with `typeText` as the bare element type; array-ness
        // never rides on a `[]` suffix). `codecRef.many` is a fallback for
        // hand-built nodes that carry a codec ref without the column-level
        // flag. Either source works for the default node's array-literal
        // rendering.
        ...ifDefined('many', this.many ?? this.codecRef?.many),
        ...ifDefined('codecRef', this.codecRef),
        ...ifDefined('sqlExpressionLiteralFor', this.sqlExpressionLiteralFor),
      }),
    ];
  }

  /** This column under another name, with every other field as it is. */
  withName(name: string): SqlColumnIR {
    const fields = Object.fromEntries(
      Object.getOwnPropertyNames(this).map((key) => [key, Reflect.get(this, key)]),
    );
    return new SqlColumnIR({
      ...blindCast<
        SqlColumnIRInput,
        'every field of the input is an own property of the column under the same name'
      >(fields),
      name,
    });
  }

  static is(node: SqlSchemaIRNode): node is SqlColumnIR {
    return node.nodeKind === RelationalSchemaNodeKind.column;
  }

  /**
   * Compares the column's own attributes only — the default lives on the child node: the type, by {@link sqlColumnTypesEqual}, and nullability.
   */
  isEqualTo(other: DiffableNode): boolean {
    const node = blindCast<
      SqlSchemaIRNode,
      'every diff-tree node the differ pairs is a SqlSchemaIRNode'
    >(other);
    assertNode(node, 'SqlColumnIR', SqlColumnIR.is);
    return sqlColumnTypesEqual(this, node) && this.nullable === node.nullable;
  }

  /** Why `actual` is not this column: the two types as written and reported, or the nullability of each. The two sides always hold different values. */
  explainMismatch(actual: DiffableNode | undefined): MismatchExplanation | undefined {
    if (actual === undefined) return undefined;
    const node = blindCast<
      SqlSchemaIRNode,
      'every diff-tree node the differ pairs is a SqlSchemaIRNode'
    >(actual);
    assertNode(node, 'SqlColumnIR', SqlColumnIR.is);
    const texts = catalogTexts(this, node);
    if (texts !== undefined && texts.expected !== texts.actual) {
      return differs(
        `The column type is "${texts.expected}", but the database reports "${texts.actual}". A type named by its catalog text is compared with the text the database reports, exactly.`,
      );
    }
    if (node.storedType === undefined && node.reportedType !== undefined) {
      return differs(
        node.typeText === ''
          ? 'The database column has no declared type.'
          : `The database column is ${shownTypeOf(node)}, which no data type in the configured stack declares.`,
      );
    }
    if (!sqlColumnTypesEqual(this, node)) {
      return differs(
        `The contract column is ${shownTypeOf(this)} and the database column is ${shownTypeOf(node)}.`,
      );
    }
    if (this.nullable !== node.nullable) {
      return differs(
        `The contract column is ${nullability(this)} and the database column is ${nullability(node)}.`,
      );
    }
    return undefined;
  }
}

/** The parts of a column that make its type. */
export type SqlColumnType = Pick<
  SqlColumnIR,
  'storedType' | 'storedTypeParams' | 'many' | 'catalogText' | 'reportedType'
>;

/**
 * Whether two columns have the same type: both have a stored type, the two are one data type, their parameters are equal as canonical JSON, and both or neither are lists. A column no data type claims has no stored type and never has the same type as another. ADR 254.
 *
 * When either column carries a {@link SqlColumnIR.catalogText}, the two compare by text instead, exactly, with `[]` for a list: that text against the other column's catalog text or reported text. ADR 273.
 */
export function sqlColumnTypesEqual(a: SqlColumnType, b: SqlColumnType): boolean {
  const texts = catalogTexts(a, b);
  if (texts !== undefined) return texts.expected === texts.actual;
  return (
    a.storedType !== undefined &&
    b.storedType !== undefined &&
    a.storedType.id === b.storedType.id &&
    canonicalizeJson(a.storedTypeParams ?? {}) === canonicalizeJson(b.storedTypeParams ?? {}) &&
    Boolean(a.many) === Boolean(b.many)
  );
}

/** The text a column's type compares by, with `[]` for a list, when it has one: its catalog text, or the text the database reports. */
function comparedText(column: SqlColumnType): string | undefined {
  const text = column.catalogText ?? column.reportedType?.text;
  return text === undefined ? undefined : `${text}${column.many === true ? '[]' : ''}`;
}

/** The two texts a pair of columns compares by, when either carries a catalog text. A side with no text to compare gives the empty text, which no catalog text equals. */
function catalogTexts(
  expected: SqlColumnType,
  actual: SqlColumnType,
): { readonly expected: string; readonly actual: string } | undefined {
  if (expected.catalogText === undefined && actual.catalogText === undefined) return undefined;
  return { expected: comparedText(expected) ?? '', actual: comparedText(actual) ?? '' };
}

/** The column's type as the contract writes it, or as introspection gives it, with `[]` for a list, in double quotes unless the text has double quotes of its own, as `"char"` does. */
function shownTypeOf(column: SqlColumnIR): string {
  const text = `${column.typeText}${column.many === true ? '[]' : ''}`;
  return text.includes('"') ? text : `"${text}"`;
}

function differs(text: string): MismatchExplanation {
  return { text, cause: 'differs' };
}

function nullability(column: SqlColumnIR): string {
  return column.nullable ? 'nullable' : 'not nullable';
}
