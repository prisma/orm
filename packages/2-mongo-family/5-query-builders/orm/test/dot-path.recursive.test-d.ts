import { expectTypeOf, test } from 'vitest';
import type { Contract } from '../../../1-foundation/mongo-contract/test/fixtures/orm-contract';
import type { DotPath } from '../src/field-accessor';

type NodeRef = {
  readonly kind: 'valueObject';
  readonly plane: 'storage';
  readonly namespaceId: '__unbound__';
  readonly entityKind: 'valueObject';
  readonly entityName: 'Node';
};

type WithTree = Contract & {
  readonly storage: {
    readonly namespaces: {
      readonly __unbound__: {
        readonly entries: {
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
          readonly User: {
            readonly fields: {
              readonly tree: {
                readonly type: NodeRef;
                readonly nullable: false;
                readonly many: false;
              };
            };
          };
        };
      };
    };
  };
};

test('dot paths end at a value object already on the path', () => {
  type Paths = DotPath<WithTree, 'User'>;
  expectTypeOf<'tree.label'>().toExtend<Paths>();
  expectTypeOf<'tree.child.label'>().not.toExtend<Paths>();
  expectTypeOf<'homeAddress.city'>().toExtend<Paths>();
});
