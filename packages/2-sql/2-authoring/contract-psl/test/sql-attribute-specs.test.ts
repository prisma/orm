import type { ContractSourceDiagnostic } from '@internal/config/config-types';
import type {
  FieldAttributeSpecFactory,
  FieldSymbol,
  ModelAttributeSpecFactory,
  ModelSymbol,
} from '@internal/psl-parser';
import { describe, expect, it } from 'vitest';
import {
  fieldSpecContext,
  findFieldAttributeNode,
  interpretFieldAttribute,
  modelSpecContext,
  sqlAttributeSpecs,
} from '../src/sql-attribute-specs';
import { buildSymbolTableInput, createBuiltinLikeControlMutationDefaults } from './fixtures';

const controlMutationDefaults = createBuiltinLikeControlMutationDefaults().defaultFunctionRegistry;

function project(schema: string, modelName: string) {
  const input = buildSymbolTableInput(schema);
  const model = input.symbolTable.topLevel.models[modelName];
  if (model === undefined) throw new Error(`model ${modelName} missing`);
  return { ...input, model };
}

function field(model: ModelSymbol, name: string): FieldSymbol {
  const found = model.fields[name];
  if (found === undefined) throw new Error(`field ${name} missing`);
  return found;
}

function interpretDefault(schema: string, fieldName: string) {
  const { symbolTable, sourceFile, sourceId, model } = project(schema, 'Post');
  const target = field(model, fieldName);
  const node = findFieldAttributeNode(target, 'default');
  if (node === undefined) throw new Error('no @default on field');
  const diagnostics: ContractSourceDiagnostic[] = [];
  const value = interpretFieldAttribute({
    node,
    spec: sqlAttributeSpecs.field.default(
      fieldSpecContext({ symbols: symbolTable, model, field: target, controlMutationDefaults }),
    ),
    model,
    field: target,
    sourceFile,
    sourceId,
    diagnostics,
  });
  return { value, diagnostics };
}

describe('sqlAttributeSpecs', () => {
  const { symbolTable, model } = project(
    'model Post {\n  id Int @id\n  tags String[]\n}\n',
    'Post',
  );
  const modelCtx = modelSpecContext({ symbols: symbolTable, model, controlMutationDefaults });
  const fieldCtx = fieldSpecContext({
    symbols: symbolTable,
    model,
    field: field(model, 'id'),
    controlMutationDefaults,
  });

  it('registers every model factory under its own attribute name at model level', () => {
    const factories: Record<string, ModelAttributeSpecFactory> = sqlAttributeSpecs.model;
    const observed = Object.entries(factories).map(([name, factory]) => {
      const spec = factory(modelCtx);
      return { name, specName: spec.name, level: spec.level };
    });
    expect(observed).toEqual(
      Object.keys(sqlAttributeSpecs.model).map((name) => ({
        name,
        specName: name,
        level: 'model',
      })),
    );
  });

  it('registers every field factory under its own attribute name at field level', () => {
    const factories: Record<string, FieldAttributeSpecFactory> = sqlAttributeSpecs.field;
    const observed = Object.entries(factories).map(([name, factory]) => {
      const spec = factory(fieldCtx);
      return { name, specName: spec.name, level: spec.level };
    });
    expect(observed).toEqual(
      Object.keys(sqlAttributeSpecs.field).map((name) => ({
        name,
        specName: name,
        level: 'field',
      })),
    );
  });

  it('covers the SQL built-in surface', () => {
    expect(Object.keys(sqlAttributeSpecs.model).sort()).toEqual([
      'base',
      'check',
      'control',
      'discriminator',
      'id',
      'index',
      'map',
      'unique',
    ]);
    expect(Object.keys(sqlAttributeSpecs.field).sort()).toEqual([
      'default',
      'id',
      'map',
      'noCheck',
      'relation',
      'unique',
    ]);
  });

  it('exposes the @relation named arguments through the spec', () => {
    expect(Object.keys(sqlAttributeSpecs.field.relation().named).sort()).toEqual([
      'fields',
      'index',
      'map',
      'name',
      'onDelete',
      'onUpdate',
      'references',
    ]);
  });
});

describe('sqlAttributeSpecs.field.default', () => {
  it('accepts a member of a top-level enum and rejects a non-member', () => {
    const schema = (member: string) => `
enum Priority {
  Low  = "low"
  High = "high"
}
model Post {
  id Int @id
  priority Priority @default(${member})
}
`;
    expect(interpretDefault(schema('Low'), 'priority')).toEqual({
      value: { value: 'Low' },
      diagnostics: [],
    });
    const rejected = interpretDefault(schema('Urgent'), 'priority');
    expect(rejected.value).toBeUndefined();
    expect(rejected.diagnostics).toEqual([
      expect.objectContaining({ code: 'PSL_INVALID_ATTRIBUTE_SYNTAX' }),
    ]);
  });

  it('resolves a namespaced enum through the namespace scope', () => {
    const schema = `
namespace ns {
  enum Role {
    Admin
    Member
  }
}
model Post {
  id Int @id
  role ns.Role @default(Member)
}
`;
    expect(interpretDefault(schema, 'role')).toEqual({
      value: { value: 'Member' },
      diagnostics: [],
    });
  });

  it('rejects every member of an enum that declares none', () => {
    const schema = `
enum Empty {
}
model Post {
  id Int @id
  kind Empty @default(Anything)
}
`;
    const result = interpretDefault(schema, 'kind');
    expect(result.value).toBeUndefined();
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'PSL_INVALID_ATTRIBUTE_SYNTAX',
        message: 'Expected one of: enum member',
      }),
    ]);
  });

  it('accepts scalar literals on a scalar field', () => {
    const schema = 'model Post {\n  id Int @id\n  views Int @default(3)\n}\n';
    expect(interpretDefault(schema, 'views')).toEqual({ value: { value: 3 }, diagnostics: [] });
  });

  it('accepts a list literal on a list field and rejects a list on a scalar field', () => {
    expect(
      interpretDefault('model Post {\n  id Int @id\n  tags String[] @default(["a"])\n}\n', 'tags'),
    ).toEqual({ value: { value: ['a'] }, diagnostics: [] });
    const rejected = interpretDefault(
      'model Post {\n  id Int @id\n  tag String @default(["a"])\n}\n',
      'tag',
    );
    expect(rejected.value).toBeUndefined();
    expect(rejected.diagnostics).toHaveLength(1);
  });

  it('accepts a registered default function and rejects an unregistered one', () => {
    expect(
      interpretDefault('model Post {\n  id Int @id @default(autoincrement())\n}\n', 'id').value,
    ).toEqual({ value: expect.objectContaining({ fn: 'autoincrement' }) });
    const rejected = interpretDefault('model Post {\n  id Int @id @default(nope())\n}\n', 'id');
    expect(rejected.value).toBeUndefined();
    expect(rejected.diagnostics).toHaveLength(1);
  });
});
