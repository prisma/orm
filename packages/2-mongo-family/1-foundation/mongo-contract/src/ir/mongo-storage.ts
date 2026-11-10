import type { StorageHashBase } from '@internal/contract/types';
import {
  freezeNode,
  IRNodeBase,
  type Namespace,
  type Storage,
} from '@internal/framework-components/ir';
import type { MongoCollection, MongoCollectionInput } from './mongo-collection';
import type { MongoValueObject, MongoValueObjectInput } from './mongo-value-object';
import type { MongoValueSet, MongoValueSetInput } from './mongo-value-set';

export type MongoNamespaceEntries = Readonly<Record<string, Readonly<Record<string, unknown>>>> & {
  readonly collection?: Readonly<Record<string, MongoCollection>>;
  readonly valueSet?: Readonly<Record<string, MongoValueSet>>;
  readonly valueObject?: Readonly<Record<string, MongoValueObject>>;
};

export interface MongoNamespaceCollectionsInput {
  readonly id: string;
  readonly entries: Readonly<Record<string, Readonly<Record<string, unknown>>>> & {
    readonly collection?: Readonly<Record<string, MongoCollectionInput>>;
    readonly valueSet?: Readonly<Record<string, MongoValueSetInput>>;
    readonly valueObject?: Readonly<Record<string, MongoValueObjectInput>>;
  };
}

export type MongoNamespace = Namespace & {
  readonly entries: MongoNamespaceEntries;
};

export interface MongoStorageInput<THash extends string = string> {
  readonly storageHash: StorageHashBase<THash>;
  readonly namespaces: Readonly<Record<string, MongoNamespace>>;
}

export class MongoStorage<THash extends string = string> extends IRNodeBase implements Storage {
  declare readonly kind: 'mongo-storage';
  readonly storageHash: StorageHashBase<THash>;
  readonly namespaces: Readonly<Record<string, MongoNamespace>>;

  constructor(input: MongoStorageInput<THash>) {
    super();
    Object.defineProperty(this, 'kind', {
      value: 'mongo-storage',
      writable: false,
      enumerable: false,
      configurable: true,
    });
    this.storageHash = input.storageHash;
    this.namespaces = Object.freeze(input.namespaces);
    freezeNode(this);
  }
}
