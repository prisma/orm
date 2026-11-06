import { freezeNode } from '@internal/framework-components/ir';
import type { MongoSchemaCollection } from './schema-collection';
import { MongoSchemaIRNode } from './schema-node';
import type { MongoSchemaVisitor } from './visitor';

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
    const sorted = [...collections].sort((a, b) => a.name.localeCompare(b.name));
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
