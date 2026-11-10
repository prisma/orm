import { expectTypeOf } from 'vitest';
import type { ModelNestedShape, ValidPaths } from '../src/resolve-path';
import type { TestContract } from './fixtures/test-contract';

type NodeRef = {
  readonly kind: 'valueObject';
  readonly plane: 'storage';
  readonly namespaceId: '__unbound__';
  readonly entityKind: 'valueObject';
  readonly entityName: 'Node';
};

type RecursiveContract = Omit<TestContract, 'domain' | 'storage'> & {
  readonly storage: {
    readonly storageHash: TestContract['storage']['storageHash'];
    readonly namespaces: {
      readonly __unbound__: {
        readonly id: '__unbound__';
        readonly kind: 'mongo-namespace';
        readonly entries: {
          readonly collection: { readonly trees: { readonly kind: 'mongo-collection' } };
          readonly valueObject: {
            readonly Node: {
              readonly fields: {
                readonly label: {
                  readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/string@1' };
                  readonly nullable: false;
                  readonly many: false;
                };
                readonly child: {
                  readonly type: NodeRef;
                  readonly nullable: true;
                  readonly many: false;
                };
              };
            };
          };
        };
      };
    };
  };
  readonly domain: {
    readonly namespaces: {
      readonly __unbound__: {
        readonly models: {
          readonly Tree: {
            readonly fields: {
              readonly _id: {
                readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/objectId@1' };
                readonly nullable: false;
                readonly many: false;
              };
              readonly tree: {
                readonly type: NodeRef;
                readonly nullable: false;
                readonly many: false;
              };
            };
            readonly relations: Record<string, never>;
            readonly storage: {
              readonly collection: 'trees';
              readonly fields: {
                readonly _id: { readonly field: '_id' };
                readonly tree: { readonly field: 'tree' };
              };
            };
          };
        };
      };
    };
  };
};

describe('a value object that contains itself', () => {
  it('ends dot paths at the value object already on the path', () => {
    expectTypeOf<ValidPaths<ModelNestedShape<RecursiveContract, 'Tree'>>>().toEqualTypeOf<
      '_id' | 'tree' | 'tree.label' | 'tree.child'
    >();
  });
});
