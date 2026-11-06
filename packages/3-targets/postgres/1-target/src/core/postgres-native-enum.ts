import type { ControlPolicy } from '@internal/contract/types';
import { freezeNode } from '@internal/framework-components/ir';
import { SqlNode } from '@internal/sql-contract/types';
import { blindCast } from '@internal/utils/casts';

export interface PostgresNativeEnumInput<Members extends readonly string[] = readonly string[]> {
  /** The Postgres type name (`CREATE TYPE <typeName> AS ENUM (…)`). */
  readonly typeName: string;
  /** Member values in declaration order — this is the Postgres enum sort order. */
  readonly members: Members;
  readonly control?: ControlPolicy;
}

function freezeMembers<Members extends readonly string[]>(members: Members): Members {
  return blindCast<
    Members,
    'Object.freeze clones+freezes the tuple for immutability; the clone widens to readonly string[], but it holds exactly the values of members (already typed Members)'
  >(Object.freeze([...members]));
}

/**
 * Postgres contract-IR class for a native enum type (`CREATE TYPE … AS ENUM (…)`).
 *
 * This is an authored, serialized Contract-IR entity — it is registered as an entity
 * kind, extends `SqlNode`, and is stored in `contract.json`. It is NOT a DiffableNode;
 * the schema-diff tree will use `PostgresNativeEnumSchemaNode` when the managed phase
 * builds it.
 *
 * A member is a value, not a name→value pair — matching `CREATE TYPE … AS ENUM
 * ('a', 'b')`, which has no separate member name.
 *
 * Target-only concept — no SQL-family abstract. Extends `SqlNode` directly,
 * frozen at construction via `freezeNode(this)`. The `kind: 'postgres-enum'`
 * discriminant is enumerable so it survives JSON. Lives at
 * `storage.namespaces[ns].entries.native_enum[HandleName]`; the entries key
 * (`native_enum`) is the entity-kind descriptor's `kind`, decoupled from this
 * node's own `kind` literal — the same shape as `table`/`StorageTable` and
 * `valueSet`/`StorageValueSet`.
 */
export class PostgresNativeEnum<
  Members extends readonly string[] = readonly string[],
> extends SqlNode {
  static is(node: unknown): node is PostgresNativeEnum {
    return (
      typeof node === 'object' && node !== null && 'kind' in node && node.kind === 'postgres-enum'
    );
  }

  override readonly kind = 'postgres-enum' as const;
  readonly typeName: string;
  readonly members: Members;
  declare readonly control?: ControlPolicy;

  constructor(input: PostgresNativeEnumInput<Members>) {
    super();
    this.typeName = input.typeName;
    this.members = freezeMembers(input.members);
    if (input.control !== undefined) this.control = input.control;
    freezeNode(this);
  }
}
