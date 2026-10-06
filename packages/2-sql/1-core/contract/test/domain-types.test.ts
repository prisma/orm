import type { Contract, ContractModel } from '@internal/contract/types';
import { asNamespaceId } from '@internal/contract/types';
import { describe, expect, it } from 'vitest';

function crossRef(model: string, namespace = 'default') {
  return { namespace: asNamespaceId(namespace), model };
}

import type { SqlStorage } from '../src/types';

type AssertExtends<T, U> = T extends U ? true : never;

describe('domain type compatibility', () => {
  describe('Contract<SqlStorage> extends Contract', () => {
    it('type-level assertion', () => {
      const _proof: AssertExtends<Contract<SqlStorage>, Contract> = true;
      expect(_proof).toBe(true);
    });
  });

  describe('domain fields accessible on ContractModel', () => {
    it('ContractModel fields are accessible via index signature', () => {
      type FieldsFromModel = ContractModel['fields'];

      const fields: FieldsFromModel = {
        id: { nullable: false, type: { kind: 'scalar', codecId: 'pg/int4@1' }, many: false },
      };
      const idField = fields['id']!;
      expect(idField.nullable).toBe(false);
      expect(idField.type.kind).toBe('scalar');
      if (idField.type.kind === 'scalar') {
        expect(idField.type.codecId).toBe('pg/int4@1');
      }
    });
  });

  describe('roots accessible on Contract<SqlStorage>', () => {
    it('roots field exists on Contract<SqlStorage>', () => {
      type Roots = Contract<SqlStorage>['roots'];
      const roots: Roots = { users: crossRef('User') };
      expect(roots['users']!.model).toBe('User');
    });
  });

  describe('concrete typed contract preserves literal types', () => {
    it('literal types flow through the intersection', () => {
      type ExampleModels = {
        readonly User: {
          readonly fields: {
            readonly name: {
              readonly nullable: true;
              readonly type: { readonly kind: 'scalar'; readonly codecId: 'pg/text@1' };
            };
          };
          readonly relations: Record<string, never>;
          readonly storage: {
            readonly table: 'user';
            readonly fields: { readonly name: { readonly column: 'display_name' } };
          };
        };
      };

      type ExampleContract = Omit<Contract<SqlStorage>, 'domain'> & {
        readonly domain: {
          readonly namespaces: {
            readonly public: { readonly models: ExampleModels };
          };
        };
      };

      type NameField =
        ExampleContract['domain']['namespaces']['public']['models']['User']['fields']['name'];

      const _nullable: NameField['nullable'] = true;
      const _codecId: NameField['type']['codecId'] = 'pg/text@1';

      expect(_nullable).toBe(true);
      expect(_codecId).toBe('pg/text@1');
    });
  });
});
