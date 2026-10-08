import { freezeNode } from '@internal/framework-components/ir';
import { ForeignKeyReference, type ForeignKeyReferenceInput } from './foreign-key-reference';
import { SqlNode } from './sql-node';

export type ReferentialAction = 'noAction' | 'restrict' | 'cascade' | 'setNull' | 'setDefault';

/**
 * What serves a foreign key's lookups on its own table: an index, by its stored name, or the primary key or a unique constraint on exactly the foreign key's columns, by kind.
 */
export type ForeignKeyIndex =
  | { readonly name: string }
  | { readonly primaryKey: true }
  | { readonly unique: true };

export interface ForeignKeyInput {
  readonly source: ForeignKeyReference | ForeignKeyReferenceInput;
  readonly target: ForeignKeyReference | ForeignKeyReferenceInput;
  readonly name?: string;
  readonly onDelete?: ReferentialAction;
  readonly onUpdate?: ReferentialAction;
  readonly index?: ForeignKeyIndex;
}

/**
 * SQL Contract IR node for a table-level foreign-key declaration — the
 * referential constraint only (source, target, `onDelete`/`onUpdate`).
 *
 * A persisted `foreignKeys[]` entry always denotes a real constraint: whether
 * to emit the constraint at all, and whether to back it with an index, are
 * authoring-time decisions (PSL `@relation(index:)`, TS `fk({ constraint,
 * index })`) resolved once at `contract emit` — a `constraint: false` FK
 * simply has no entry here, and a backing index (if any) is its own discrete,
 * named entry in the table's `indexes[]`. `index` says what serves the
 * foreign key's lookups; it is absent when nothing backs the foreign key.
 *
 * Each FK carries explicit `source` and `target` {@link ForeignKeyReference}
 * coordinates (namespace, table, columns). For single-namespace contracts the
 * sentinel `UNBOUND_NAMESPACE_ID` appears on both sides.
 *
 * The nested references are normalised to {@link ForeignKeyReference}
 * instances inside the constructor so downstream walks see a uniform AST
 * regardless of whether the input was a JSON literal or an already-constructed
 * class instance.
 */
export class ForeignKey extends SqlNode {
  readonly source: ForeignKeyReference;
  readonly target: ForeignKeyReference;
  declare readonly name?: string;
  declare readonly onDelete?: ReferentialAction;
  declare readonly onUpdate?: ReferentialAction;
  declare readonly index?: ForeignKeyIndex;

  constructor(input: ForeignKeyInput) {
    super();
    this.source = ForeignKeyReference.from(input.source);
    this.target = ForeignKeyReference.from(input.target);
    if (input.name !== undefined) this.name = input.name;
    if (input.onDelete !== undefined) this.onDelete = input.onDelete;
    if (input.onUpdate !== undefined) this.onUpdate = input.onUpdate;
    if (input.index !== undefined) this.index = input.index;
    freezeNode(this);
  }

  static from(value: ForeignKey | ForeignKeyInput): ForeignKey {
    return value instanceof ForeignKey ? value : new ForeignKey(value);
  }
}
