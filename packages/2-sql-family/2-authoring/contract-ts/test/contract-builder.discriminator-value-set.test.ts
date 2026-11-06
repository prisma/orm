import { crossRef } from '@internal/contract/types';
import type { TargetPackRef } from '@internal/framework-components/components';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { testTypeLookups } from '../../../1-core/contract/test/test-type-lookups';
import { buildSqlContractFromDefinition } from '../src/contract-builder';
import type { ContractDefinition } from '../src/contract-definition';
import { enumType, member } from '../src/enum-type';

const postgresTargetPack: TargetPackRef<'sql', 'postgres'> = {
  kind: 'target',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  defaultNamespaceId: 'public',
};

const int4 = { codecId: 'pg/int4@1' } as const;
const text = { codecId: 'pg/text@1' } as const;

function definitionWith(
  overrides: Partial<Pick<ContractDefinition, 'enums'>> & {
    readonly typeEnum?: ReturnType<typeof enumType>;
    readonly variants?: Readonly<Record<string, string>>;
    readonly namespaceId?: string;
  } = {},
): ContractDefinition {
  const variants = overrides.variants ?? { bug: 'Bug', feature: 'Feature' };
  const namespaceId = overrides.namespaceId ?? 'public';
  const inNamespace = overrides.namespaceId !== undefined ? { namespaceId } : {};
  return {
    warnings: undefined,
    target: postgresTargetPack,
    createNamespace: createTestSqlNamespace,
    ...(overrides.enums !== undefined ? { enums: overrides.enums } : {}),
    models: [
      {
        modelName: 'Task',
        tableName: 'task',
        ...inNamespace,
        fields: [
          { fieldName: 'id', columnName: 'id', descriptor: int4, nullable: false },
          {
            fieldName: 'type',
            columnName: 'type',
            descriptor: text,
            nullable: false,
            ...(overrides.typeEnum !== undefined ? { enumTypeHandle: overrides.typeEnum } : {}),
          },
        ],
        id: { columns: ['id'] },
        discriminator: { field: 'type' },
        variants: Object.fromEntries(
          Object.entries(variants).map(([value, model]) => [value, crossRef(model, namespaceId)]),
        ),
      },
      ...Object.values(variants).map((model) => ({
        modelName: model,
        tableName: 'task',
        ...inNamespace,
        fields: [],
        sharesBaseTable: true,
        base: crossRef('Task', namespaceId),
      })),
    ],
  };
}

function build(definition: ContractDefinition) {
  return buildSqlContractFromDefinition(
    definition,
    testTypeLookups.codecLookup,
    testTypeLookups.dataTypeLookup,
  );
}

describe('the value set of a discriminator', () => {
  it('is written as <Base>.<field>, and the discriminator column refers to it', () => {
    const contract = build(definitionWith());
    const namespace = contract.storage.namespaces['public'];
    expect({
      valueSet: JSON.parse(JSON.stringify(namespace?.entries.valueSet?.['Task.type'])),
      column: namespace?.entries.table?.['task']?.columns['type']?.valueSet,
      task: {
        discriminator: contract.domain.namespaces['public']?.models['Task']?.discriminator,
        variants: contract.domain.namespaces['public']?.models['Task']?.variants,
      },
      bugBase: contract.domain.namespaces['public']?.models['Bug']?.base,
    }).toEqual({
      valueSet: { kind: 'valueSet', values: ['bug', 'feature'] },
      column: {
        plane: 'storage',
        entityKind: 'valueSet',
        namespaceId: 'public',
        entityName: 'Task.type',
      },
      task: {
        discriminator: { field: 'type' },
        variants: { bug: crossRef('Bug', 'public'), feature: crossRef('Feature', 'public') },
      },
      bugBase: crossRef('Task', 'public'),
    });
  });

  it('holds the values in sorted order, so the order the variants are declared in does not change the storage hash', () => {
    const declaredFeatureFirst = build(
      definitionWith({ variants: { feature: 'Feature', '10': 'Ten', bug: 'Bug', '2': 'Two' } }),
    );
    const declaredBugFirst = build(
      definitionWith({ variants: { bug: 'Bug', '2': 'Two', feature: 'Feature', '10': 'Ten' } }),
    );
    expect({
      values:
        declaredFeatureFirst.storage.namespaces['public']?.entries.valueSet?.['Task.type']?.values,
      sameHash: declaredFeatureFirst.storage.storageHash === declaredBugFirst.storage.storageHash,
    }).toEqual({ values: ['10', '2', 'bug', 'feature'], sameHash: true });
  });

  it('changes the storage hash when a variant is added', () => {
    expect(build(definitionWith({ variants: { bug: 'Bug' } })).storage.storageHash).not.toBe(
      build(definitionWith()).storage.storageHash,
    );
  });

  it('is not written when an enum types the discriminator field, which keeps the enum value set', () => {
    const Kind = enumType('Kind', text, member('Bug', 'bug'), member('Feature', 'feature'));
    const namespace = build(definitionWith({ enums: { Kind }, typeEnum: Kind })).storage.namespaces[
      'public'
    ];
    expect({
      valueSets: Object.keys(namespace?.entries.valueSet ?? {}),
      column: namespace?.entries.table?.['task']?.columns['type']?.valueSet?.entityName,
    }).toEqual({ valueSets: ['Kind'], column: 'Kind' });
  });

  it('refuses an enum whose name is the value set key of a discriminator, naming both', () => {
    const clash = enumType('Task.type', text, member('Bug', 'bug'));
    expect(() => build(definitionWith({ enums: { 'Task.type': clash } }))).toThrow(
      'enumType("Task.type"): has the name of the value set that the discriminator field "type" of model "Task" writes. Rename the enum.',
    );
  });

  it('is written beside an enum of the same name in another namespace, since the two value sets do not share an entry', () => {
    const sameName = enumType('Task.type', text, member('Bug', 'bug'));
    const contract = build(
      definitionWith({ enums: { 'Task.type': sameName }, namespaceId: 'other' }),
    );
    expect({
      public: contract.storage.namespaces['public']?.entries.valueSet?.['Task.type']?.values,
      other: contract.storage.namespaces['other']?.entries.valueSet?.['Task.type']?.values,
    }).toEqual({ public: ['bug'], other: ['bug', 'feature'] });
  });
});
