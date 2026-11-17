import { expectTypeOf, test } from 'vitest';
import type { ContractValueObject } from '../src/domain-types';

const role = { namespaceId: 'public', entityName: 'Role' } as const;
const storageValueSet = { plane: 'storage', entityKind: 'valueSet', ...role } as const;
const domainEnum = { plane: 'domain', entityKind: 'enum', ...role } as const;
const text = { kind: 'scalar', codecId: 'pg/text@1' } as const;

test('a value object member refers to a storage value set, never a domain enum', () => {
  const storageMember: ContractValueObject = {
    fields: { role: { nullable: false, type: text, valueSet: storageValueSet } },
  };
  const domainMember: ContractValueObject = {
    fields: {
      role: {
        nullable: false,
        type: text,
        // @ts-expect-error a storage entity's field may not refer to the domain plane
        valueSet: domainEnum,
      },
    },
  };
  expectTypeOf(storageMember).toEqualTypeOf(domainMember);
});
