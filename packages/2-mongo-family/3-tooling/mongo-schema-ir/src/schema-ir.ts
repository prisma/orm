import { freezeNode } from '@internal/framework-components/ir';
import type { MongoSchemaCollection } from './schema-collection';
import { MongoSchemaIRNode } from './schema-node';
import type { MongoSchemaVisitor } from './visitor';

/** Orders by UTF-16 code unit, so the order does not depend on the machine's locale. */
function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export class MongoSchemaIR extends MongoSchemaIRNode {
  readonly nodeKind = 'schema' as const;
  /** Fixed sentinel: the schema is always the diff tree's single root. */
  readonly id = 'schema';
  readonly collections: ReadonlyArray<MongoSchemaCollection>;
  readonly collectionNames: ReadonlyArray<string>;
  /** Whether the schema was read from a database, which reports some index options with server defaults filled in. */
  readonly fromDatabase: boolean;

  private readonly _byName: Map<string, MongoSchemaCollection>;

  constructor(
    collections: ReadonlyArray<MongoSchemaCollection>,
    options: { readonly fromDatabase: boolean },
  ) {
    super();
    this.fromDatabase = options.fromDatabase;
    const sorted = [...collections].sort((a, b) => compareCodeUnits(a.name, b.name));
    this.collections = sorted;
    this._byName = new Map(sorted.map((c) => [c.name, c]));
    this.collectionNames = sorted.map((c) => c.name);
    freezeNode(this);
  }

  accept<R>(visitor: MongoSchemaVisitor<R>): R {
    return visitor.schema(this);
  }

  collection(name: string): MongoSchemaCollection | undefined {
    return this._byName.get(name);
  }
}
