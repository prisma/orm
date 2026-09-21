import type {
  ArgType,
  AttributeCtx,
  FieldAttributeCtx,
  FieldAttributeSpecFactory,
  FieldSymbol,
  FuncCallSig,
  ModelAttributeCtx,
  ModelAttributeSpecFactory,
  ModelSymbol,
  Param,
} from '@internal/psl-parser';
import { createPslDiagnosticCollector } from '@internal/psl-parser';
import { describe, expect, it } from 'vitest';
import {
  fieldSpecContext,
  findFieldAttributeNode,
  interpretFieldAttribute,
  modelSpecContext,
  sqlAttributeSpecs,
} from '../src/sql-attribute-specs';
import { buildSymbolTableInput, createBuiltinLikeControlMutationDefaults } from './fixtures';

const controlMutationDefaults = createBuiltinLikeControlMutationDefaults();

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

interface ListMetadata<T, Ctx extends AttributeCtx> extends ArgType<readonly T[], Ctx> {
  readonly kind: 'list';
  readonly of: ArgType<T, Ctx>;
  readonly allowEmpty: boolean;
  readonly unique: boolean;
}

interface RecordMetadata<T, Ctx extends AttributeCtx> extends ArgType<Record<string, T>, Ctx> {
  readonly kind: 'record';
  readonly of: ArgType<T, Ctx>;
}

interface OneOfMetadata<Ctx extends AttributeCtx> extends ArgType<unknown, Ctx> {
  readonly kind: 'oneOf';
  readonly alternatives: readonly ArgType<unknown, Ctx>[];
}

interface FuncCallMetadata<Ctx extends AttributeCtx> extends ArgType<unknown, Ctx> {
  readonly kind: 'funcCall';
  readonly name: string;
  readonly signature: FuncCallSig;
}

function positionalType<Ctx extends AttributeCtx>(spec: {
  readonly positional: readonly { readonly type: ArgType<unknown, Ctx> }[];
}): ArgType<unknown, Ctx> {
  const positional = spec.positional[0];
  if (positional === undefined) throw new Error('spec declares a positional argument');
  return positional.type;
}

function namedType<Ctx extends AttributeCtx>(
  spec: { readonly named: Readonly<Record<string, Param<unknown, Ctx>>> },
  key: string,
): ArgType<unknown, Ctx> {
  const type = spec.named[key];
  if (type === undefined) throw new Error(`spec declares named argument ${key}`);
  return type.type;
}

function listMetadata<T, Ctx extends AttributeCtx>(
  type: ArgType<unknown, Ctx>,
): ListMetadata<T, Ctx> {
  if (type.kind !== 'list') throw new Error('argument is a list');
  return type as unknown as ListMetadata<T, Ctx>;
}

function recordMetadata<T, Ctx extends AttributeCtx>(
  type: ArgType<unknown, Ctx>,
): RecordMetadata<T, Ctx> {
  if (type.kind !== 'record') throw new Error('argument is a record');
  return type as unknown as RecordMetadata<T, Ctx>;
}

function oneOfMetadata<Ctx extends AttributeCtx>(type: ArgType<unknown, Ctx>): OneOfMetadata<Ctx> {
  if (type.kind !== 'oneOf') throw new Error('argument is oneOf');
  return type as unknown as OneOfMetadata<Ctx>;
}

function interpretDefault(schema: string, fieldName: string) {
  const { symbolTable, sources, model } = project(schema, 'Post');
  const target = field(model, fieldName);
  const node = findFieldAttributeNode(target, 'default');
  if (node === undefined) throw new Error('no @default on field');
  const diagnostics = createPslDiagnosticCollector(sources);
  const value = interpretFieldAttribute({
    node,
    spec: sqlAttributeSpecs.field.default(
      fieldSpecContext({ symbols: symbolTable, model, field: target, controlMutationDefaults }),
    ),
    model,
    field: target,
    sources,
    diagnostics,
  });
  return { value, diagnostics: diagnostics.toExternal() };
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

  it('exposes SQL relation field-reference metadata from the actual factory', () => {
    const spec = sqlAttributeSpecs.field.relation();
    const fields = listMetadata<string, FieldAttributeCtx>(namedType(spec, 'fields'));
    const references = listMetadata<string, FieldAttributeCtx>(namedType(spec, 'references'));

    expect(fields).toMatchObject({ kind: 'list', optional: true });
    expect(fields.of).toMatchObject({ kind: 'fieldRef' });
    expect(fields.allowEmpty).toBe(false);
    expect(fields.unique).toBe(true);

    expect(references).toMatchObject({ kind: 'list', optional: true });
    expect(references.of).toMatchObject({ kind: 'referencedFieldRef' });
    expect(references.allowEmpty).toBe(false);
    expect(references.unique).toBe(true);
  });

  it('exposes SQL model container metadata from actual factories', () => {
    const idFields = listMetadata<string, ModelAttributeCtx>(
      positionalType(sqlAttributeSpecs.model.id()),
    );
    expect(idFields).toMatchObject({ kind: 'list', allowEmpty: false, unique: true });
    expect(idFields.of).toMatchObject({ kind: 'fieldRef' });

    const options = recordMetadata<string, ModelAttributeCtx>(
      namedType(sqlAttributeSpecs.model.index(), 'options'),
    );
    expect(options).toMatchObject({ kind: 'record', optional: true });
    expect(options.of).toMatchObject({ kind: 'str', value: undefined });
  });
});

describe('sqlAttributeSpecs.field.default', () => {
  const { symbolTable, model } = project(
    'model Post {\n  id Int @id\n  tags String[]\n}\n',
    'Post',
  );
  const fieldCtx = fieldSpecContext({
    symbols: symbolTable,
    model,
    field: field(model, 'id'),
    controlMutationDefaults,
  });

  it('exposes scalar default alternatives from the actual registry-backed factory', () => {
    const spec = sqlAttributeSpecs.field.default(fieldCtx);
    const value = oneOfMetadata(positionalType(spec));

    expect(value.kind).toBe('oneOf');
    expect(value.alternatives.map((alt) => alt.kind)).toEqual([
      'str',
      'num',
      'bool',
      'funcCall',
      'funcCall',
      'funcCall',
      'funcCall',
      'funcCall',
      'funcCall',
      'funcCall',
      'taggedLiteral',
    ]);
    const uuid = value.alternatives.find(
      (alt): alt is FuncCallMetadata<FieldAttributeCtx> =>
        alt.kind === 'funcCall' && 'name' in alt && alt.name === 'uuid',
    );
    if (uuid === undefined) throw new Error('uuid default function arm is present');
    const versionType = uuid.signature.positional?.[0]?.type;
    if (versionType === undefined) throw new Error('uuid version argument is present');
    const version = oneOfMetadata(versionType);
    expect(version).toMatchObject({ kind: 'oneOf', optional: true });
    expect(version.alternatives).toEqual([
      expect.objectContaining({ kind: 'num', value: 4 }),
      expect.objectContaining({ kind: 'num', value: 7 }),
    ]);
  });

  it('omits the tagged-literal arm when no tag is registered', () => {
    const noTags = fieldSpecContext({
      symbols: symbolTable,
      model,
      field: field(model, 'id'),
      controlMutationDefaults: {
        defaultFunctionRegistry: controlMutationDefaults.defaultFunctionRegistry,
        defaultLiteralTagRegistry: new Map(),
      },
    });
    const value = oneOfMetadata(positionalType(sqlAttributeSpecs.field.default(noTags)));
    expect(value.alternatives.map((alt) => alt.kind)).not.toContain('taggedLiteral');
    expect(value.label).not.toContain('`...`');
  });

  it('exposes list default alternatives without hiding registry function calls', () => {
    const listCtx = fieldSpecContext({
      symbols: symbolTable,
      model,
      field: field(model, 'tags'),
      controlMutationDefaults,
    });
    const value = oneOfMetadata(positionalType(sqlAttributeSpecs.field.default(listCtx)));

    const listDefault = listMetadata<unknown, FieldAttributeCtx>(value.alternatives[0] ?? value);
    expect(listDefault).toMatchObject({ kind: 'list' });
    expect(listDefault.of).toMatchObject({ kind: 'oneOf' });
    expect(
      value.alternatives
        .filter((alt) => alt.kind === 'funcCall')
        .map((alt) => (alt as FuncCallMetadata<FieldAttributeCtx>).name),
    ).toEqual(['autoincrement', 'now', 'uuid', 'cuid', 'ulid', 'nanoid', 'dbgenerated']);
    expect(value.alternatives.at(-1)).toMatchObject({
      kind: 'taggedLiteral',
      label: 'sql`...`',
      tags: ['sql', 'pg.sql'],
      documentation: "Uses the SQL in the string, verbatim, as the column's default expression.",
    });
  });

  it('exposes enum default alternatives and empty-enum rejection metadata', () => {
    const enumProject = project(
      'enum Priority {\n  Low\n  High\n}\nmodel Post {\n  id Int @id\n  priority Priority\n}\n',
      'Post',
    );
    const priority = field(enumProject.model, 'priority');
    const enumCtx = fieldSpecContext({
      symbols: enumProject.symbolTable,
      model: enumProject.model,
      field: priority,
      controlMutationDefaults,
    });
    const enumDefault = oneOfMetadata(positionalType(sqlAttributeSpecs.field.default(enumCtx)));
    expect(enumDefault.alternatives).toEqual([
      expect.objectContaining({ kind: 'identifier', name: 'Low' }),
      expect.objectContaining({ kind: 'identifier', name: 'High' }),
    ]);

    const emptyProject = project(
      'enum Empty {\n}\nmodel Post {\n  id Int @id\n  kind Empty\n}\n',
      'Post',
    );
    const kind = field(emptyProject.model, 'kind');
    const emptyCtx = fieldSpecContext({
      symbols: emptyProject.symbolTable,
      model: emptyProject.model,
      field: kind,
      controlMutationDefaults,
    });
    const emptyDefault = oneOfMetadata(positionalType(sqlAttributeSpecs.field.default(emptyCtx)));
    expect(emptyDefault.alternatives).toEqual([
      expect.objectContaining({
        kind: 'rejecting',
        label: 'enum member',
        message: 'Enum declares no members',
      }),
    ]);
  });

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

  it('accepts scalar literals on a scalar field, keeping a number as written', () => {
    const schema = 'model Post {\n  id Int @id\n  price Decimal @default(1.50)\n}\n';
    expect(interpretDefault(schema, 'price')).toEqual({
      value: { value: { text: '1.50' } },
      diagnostics: [],
    });
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
