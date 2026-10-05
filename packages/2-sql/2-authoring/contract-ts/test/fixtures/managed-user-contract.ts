import type { FamilyPackRef } from '@internal/framework-components/components';
import { createTestSqlNamespace } from '../../../../1-core/contract/test/test-support';
import { defineContract } from '../../src/contract-builder';
import { enumType, member } from '../../src/enum-type';

const sqlFamilyPack = {
  kind: 'family',
  id: 'sql',
  familyId: 'sql',
  version: '0.0.1',
  authoring: {
    field: {
      text: {
        kind: 'fieldPreset',
        output: { codecId: 'pg/text@1', nativeType: 'text' },
      },
    },
  },
} as const satisfies FamilyPackRef<'sql'>;

export function renderCheckExpressions(input: {
  readonly tableName: string;
  readonly columnName: string;
  readonly many: boolean;
  readonly elementNullable: boolean;
  readonly memberValues: readonly string[] | undefined;
}): ReadonlyArray<{
  readonly kind: 'membership' | 'elementNotNull';
  readonly columnName: string;
  readonly expression: string;
}> {
  const candidates: Array<{
    kind: 'membership' | 'elementNotNull';
    columnName: string;
    expression: string;
  }> = [];
  const column = `"${input.columnName}"`;
  if (input.memberValues !== undefined) {
    const members = input.memberValues.map((v) => `'${v}'`).join(', ');
    candidates.push({
      kind: 'membership',
      columnName: input.columnName,
      expression: input.many
        ? `array_remove(${column}::text[], NULL) <@ ARRAY[${members}]::text[]`
        : `${column} IN (${members})`,
    });
  }
  if (input.many && !input.elementNullable) {
    candidates.push({
      kind: 'elementNotNull',
      columnName: input.columnName,
      expression: `array_position(${column}, NULL) IS NULL`,
    });
  }
  return candidates;
}

const postgresTargetPack = {
  kind: 'target',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  defaultNamespaceId: 'public',
  authoring: { field: {}, renderCheckExpressions },
} as const;

const pgText = { codecId: 'pg/text@1' as const, nativeType: 'text' } as const;
const Role = enumType('Role', pgText, member('User', 'user'), member('Admin', 'admin'));

export default defineContract(
  {
    family: sqlFamilyPack,
    target: postgresTargetPack,
    createNamespace: createTestSqlNamespace,
    enums: { Role },
  },
  ({ field: f, model: m }) =>
    ({
      models: {
        User: m('User', {
          fields: { id: f.text().id(), role: f.namedType(Role), tags: f.text().many() },
        }),
      },
    }) as const,
);
