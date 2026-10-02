/**
 * Every PSL place that takes raw SQL receives the data type `sql/expression`, and every other
 * argument that takes a plain string is listed as not SQL. A new string argument fails the second
 * test until it is added to one list or the other.
 */

import type { AuthoringPslBlockDescriptor } from '@internal/framework-components/authoring';
import {
  type AttributeSpec,
  type BlockAttributeSpecFactory,
  blockSpecFactoryOf,
  buildSymbolTable,
  type InspectableArgType,
} from '@internal/psl-parser';
import { parse } from '@internal/psl-parser/syntax';
import { sqlAttributeSpecs } from '@internal/sql-contract-psl/attribute-specs';
import { describe, expect, it } from 'vitest';
import {
  policyBothPredicatesSpec,
  policyUsingOnlySpec,
  policyWithCheckOnlySpec,
  postgresAuthoringModelAttributes,
  postgresAuthoringPslBlockDescriptors,
} from '../src/core/authoring';
import { postgresDataTypeSupport } from './fixtures/postgres-data-type-support';

const { document, sources } = parse(
  'model Post {\n  id Int @id\n}\npolicy_all p {\n}\n',
  'sql-expression-places.test.psl',
);
const { symbolTable } = buildSymbolTable({ documents: [document], sources });
const model = symbolTable.topLevel.models['Post'];
const field = model?.fields['id'];
const block = symbolTable.topLevel.blocks['p'];
if (model === undefined || field === undefined || block === undefined) {
  throw new Error('expected the probe declarations');
}

const modelContext = {
  symbols: symbolTable,
  model,
  defaultFunctionRegistry: new Map(),
  dataTypes: postgresDataTypeSupport,
};
const fieldContext = { ...modelContext, field, typeResolution: undefined };
const blockContext = { symbols: symbolTable, block, dataTypes: postgresDataTypeSupport };

type Parameters = Readonly<Record<string, { readonly type: InspectableArgType<never> }>>;

function stringArguments(place: string, type: InspectableArgType<never>): readonly string[] {
  switch (type.kind) {
    case 'str':
      return Reflect.get(type, 'value') === undefined ? [place] : [];
    case 'oneOf':
      return type.alternatives.flatMap((alternative) => stringArguments(place, alternative));
    case 'list':
    case 'record':
      return stringArguments(place, type.of);
    case 'funcCall':
      return parametersOf(`${place}.${type.name}()`, type.signature);
    default:
      return [];
  }
}

function parametersOf(
  place: string,
  spec: {
    readonly positional?: readonly {
      readonly key: string;
      readonly type: InspectableArgType<never>;
    }[];
    readonly named?: Parameters;
  },
): readonly string[] {
  return [
    ...(spec.positional ?? []).map(({ key, type }) => [`${place}.${key}`, type] as const),
    ...Object.entries(spec.named ?? {}).map(
      ([key, { type }]) => [`${place}.${key}`, type] as const,
    ),
  ].flatMap(([at, type]) => stringArguments(at, type));
}

function attributeStringArguments(
  prefix: string,
  spec: AttributeSpec<never, never>,
): readonly string[] {
  return parametersOf(`${prefix}${spec.name}`, spec);
}

function everyStringArgument(): readonly string[] {
  const sqlModel = Object.values(sqlAttributeSpecs.model).map((factory) => factory(modelContext));
  const sqlField = Object.values(sqlAttributeSpecs.field).map((factory) => factory(fieldContext));
  const postgresModel = Object.values(postgresAuthoringModelAttributes).map(({ spec }) =>
    spec(modelContext),
  );
  const descriptors: readonly AuthoringPslBlockDescriptor[] = Object.values(
    postgresAuthoringPslBlockDescriptors,
  );
  const blocks = descriptors.flatMap((descriptor) => {
    const spec = blockSpecFactoryOf(descriptor)(blockContext);
    const parameters: Parameters = spec.mode === 'struct' ? spec.parameters : { value: spec.value };
    const attributes = Object.values(descriptor.attributes ?? {}).map((factory) =>
      (factory as BlockAttributeSpecFactory)(blockContext),
    );
    return [
      ...parametersOf(descriptor.keyword, { named: parameters }),
      ...attributes.flatMap((attribute) =>
        attributeStringArguments(`${descriptor.keyword} @@`, attribute),
      ),
    ];
  });
  return [
    ...sqlModel.flatMap((spec) => attributeStringArguments('@@', spec)),
    ...sqlField.flatMap((spec) => attributeStringArguments('@', spec)),
    ...postgresModel.flatMap((spec) => attributeStringArguments('@@', spec)),
    ...blocks,
  ].sort();
}

const NOT_SQL = [
  '@@base.value',
  '@@check.map',
  '@@check.name',
  '@@fullTextIndex.map',
  '@@fullTextIndex.name',
  '@@id.map',
  '@@index.map',
  '@@index.name',
  '@@index.options',
  '@@index.type',
  '@@map.name',
  '@@unique.map',
  '@default.value',
  '@id.map',
  '@map.name',
  '@relation.map',
  '@relation.name',
  '@unique.map',
  'native_enum @@map.name',
  'native_enum.value',
  'policy_all @@map.name',
  'policy_delete @@map.name',
  'policy_insert @@map.name',
  'policy_select @@map.name',
  'policy_update @@map.name',
];

function received(type: InspectableArgType<never> | undefined) {
  return type === undefined
    ? undefined
    : { kind: type.kind, dataType: Reflect.get(type, 'dataType') };
}

const SQL_EXPRESSION = { kind: 'dataTypeValue', dataType: 'sql/expression' };

describe('the places that take raw SQL', () => {
  it('receive sql/expression', () => {
    const index = sqlAttributeSpecs.model.index(modelContext);
    const check = sqlAttributeSpecs.model.check(modelContext);
    const fullTextIndex = postgresAuthoringModelAttributes.fullTextIndex.spec(modelContext);

    expect({
      indexWhere: received(index.named['where']?.type),
      indexExpression: received(index.named['expression']?.type),
      fullTextIndexWhere: received(fullTextIndex.named['where']?.type),
      checkExpression: received(check.named['expression']?.type),
      usingOnlyUsing: received(policyUsingOnlySpec(blockContext).parameters['using']?.type),
      withCheckOnlyWithCheck: received(
        policyWithCheckOnlySpec(blockContext).parameters['withCheck']?.type,
      ),
      bothUsing: received(policyBothPredicatesSpec(blockContext).parameters['using']?.type),
      bothWithCheck: received(policyBothPredicatesSpec(blockContext).parameters['withCheck']?.type),
    }).toEqual({
      indexWhere: SQL_EXPRESSION,
      indexExpression: SQL_EXPRESSION,
      fullTextIndexWhere: SQL_EXPRESSION,
      checkExpression: SQL_EXPRESSION,
      usingOnlyUsing: SQL_EXPRESSION,
      withCheckOnlyWithCheck: SQL_EXPRESSION,
      bothUsing: SQL_EXPRESSION,
      bothWithCheck: SQL_EXPRESSION,
    });
  });

  it('are the only arguments besides these, which take a plain string that is not SQL', () => {
    expect([...new Set(everyStringArgument())].sort()).toEqual([...NOT_SQL].sort());
  });
});
