import type {
  ArgType,
  AttributeCtx,
  FieldAttributeSpecFactory,
  FieldSymbol,
  ModelAttributeSpecFactory,
  ModelSymbol,
  Param,
} from '@internal/psl-parser';
import { createBinder, createPslDiagnosticCollector, EMPTY_DATA_TYPES } from '@internal/psl-parser';
import { describe, expect, it } from 'vitest';
import { getAttribute } from '../src/psl-attribute-parsing';
import {
  fieldSpecContext,
  interpretFieldAttribute,
  interpretModelAttribute,
  modelSpecContext,
  sqlAttributeSpecs,
} from '../src/sql-attribute-specs';
import { fixtureDataTypeSupport } from './fixture-data-types';
import {
  buildSymbolTableInput,
  createBuiltinLikeControlMutationDefaults,
  createPostgresTestContext,
} from './fixtures';

const { defaultFunctionRegistry } = createBuiltinLikeControlMutationDefaults();

function project(schema: string, modelName: string, namespaceName?: string) {
  const input = buildSymbolTableInput(schema);
  const scope =
    namespaceName === undefined
      ? input.symbolTable.topLevel
      : input.symbolTable.topLevel.namespaces[namespaceName];
  const model = scope?.models[modelName];
  if (model === undefined) throw new Error(`model ${modelName} missing`);
  const { binder } = createBinder({
    symbolTable: input.symbolTable,
    sources: input.sources,
    context: createPostgresTestContext(),
  });
  return { ...input, model, binder };
}

function field(model: ModelSymbol, name: string): FieldSymbol {
  const found = model.fields[name];
  if (found === undefined) throw new Error(`field ${name} missing`);
  return found;
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

function listMetadata<Ctx extends AttributeCtx>(type: ArgType<unknown, Ctx>) {
  if (type.kind !== 'list') throw new Error('argument is a list');
  return type;
}

function recordMetadata<Ctx extends AttributeCtx>(type: ArgType<unknown, Ctx>) {
  if (type.kind !== 'record') throw new Error('argument is a record');
  return type;
}

function oneOfMetadata<Ctx extends AttributeCtx>(type: ArgType<unknown, Ctx>) {
  if (type.kind !== 'oneOf') throw new Error('argument is oneOf');
  return type;
}

function interpretDefault(schema: string, fieldName: string, namespaceName?: string) {
  const { symbolTable, sources, model, binder } = project(schema, 'Post', namespaceName);
  const target = field(model, fieldName);
  const node = getAttribute(target.attributes, 'default')?.node;
  if (node === undefined) throw new Error('no @default on field');
  const diagnostics = createPslDiagnosticCollector(sources);
  const value = interpretFieldAttribute({
    symbols: symbolTable,
    node,
    spec: sqlAttributeSpecs.field.default(
      fieldSpecContext({
        symbols: symbolTable,
        model,
        field: target,
        binder,
        defaultFunctionRegistry,
        dataTypes: fixtureDataTypeSupport,
      }),
    ),
    model,
    field: target,
    sources,
    binder,
    diagnostics,
  });
  return { value, diagnostics: diagnostics.toExternal() };
}

describe('checked base factory', () => {
  it('returns the forward-declared local base identity', () => {
    const input = buildSymbolTableInput(`model Base { id Int @id }
namespace scoped {
  model Variant { @@base(Base, "variant") }
  model Base { id String @id }
}`);
    const namespace = input.symbolTable.topLevel.namespaces['scoped'];
    const model = namespace?.models['Variant'];
    if (!namespace || !model) throw new Error('missing variant');
    const node = getAttribute(model.attributes, 'base')?.node;
    if (!node) throw new Error('missing base attribute');
    const diagnostics = createPslDiagnosticCollector(input.sources);
    const value = interpretModelAttribute({
      node,
      symbols: input.symbolTable,
      spec: sqlAttributeSpecs.model.base(
        modelSpecContext({
          symbols: input.symbolTable,
          model,
          defaultFunctionRegistry,
          dataTypes: fixtureDataTypeSupport,
        }),
      ),
      model,
      sources: input.sources,
      binder: createBinder({
        symbolTable: input.symbolTable,
        sources: input.sources,
        context: createPostgresTestContext(),
      }).binder,
      diagnostics,
    });
    expect(diagnostics.toExternal()).toEqual([]);
    expect(value?.base.declaration).toBe(namespace.models['Base']);
    expect(value?.base.namespace).toBe(namespace);
    expect(value?.value).toBe('variant');
  });
});

describe('sqlAttributeSpecs', () => {
  const { symbolTable, model, binder } = project(
    'model Post {\n  id Int @id\n  tags String[]\n}\n',
    'Post',
  );
  const modelCtx = modelSpecContext({
    symbols: symbolTable,
    model,
    defaultFunctionRegistry,
    dataTypes: fixtureDataTypeSupport,
  });
  const fieldCtx = fieldSpecContext({
    symbols: symbolTable,
    model,
    field: field(model, 'id'),
    binder,
    defaultFunctionRegistry,
    dataTypes: fixtureDataTypeSupport,
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
    expect(Object.keys(sqlAttributeSpecs.field.relation(fieldCtx).named).sort()).toEqual([
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
    const spec = sqlAttributeSpecs.field.relation(fieldCtx);
    const fields = listMetadata(namedType(spec, 'fields'));
    const references = listMetadata(namedType(spec, 'references'));

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
    const idFields = listMetadata(positionalType(sqlAttributeSpecs.model.id(modelCtx)));
    expect(idFields).toMatchObject({ kind: 'list', allowEmpty: false, unique: true });
    expect(idFields.of).toMatchObject({ kind: 'fieldRef' });

    const options = recordMetadata(namedType(sqlAttributeSpecs.model.index(modelCtx), 'options'));
    expect(options).toMatchObject({ kind: 'record', optional: true });
    expect(options.of).toMatchObject({ kind: 'str', value: undefined });
  });
});

describe('sqlAttributeSpecs.field.default', () => {
  const { symbolTable, model, binder } = project(
    'model Post {\n  id Int @id\n  tags String[]\n}\n',
    'Post',
  );
  const fieldCtx = fieldSpecContext({
    symbols: symbolTable,
    model,
    field: field(model, 'id'),
    binder,
    defaultFunctionRegistry,
    dataTypes: fixtureDataTypeSupport,
  });

  it('exposes scalar default alternatives from the actual registry-backed factory', () => {
    const spec = sqlAttributeSpecs.field.default(fieldCtx);
    const value = oneOfMetadata(positionalType(spec));

    expect(value.kind).toBe('oneOf');
    expect(value.alternatives.map((alt) => alt.kind)).toEqual([
      'str',
      'num',
      'bool',
      'null',
      'funcCall',
      'funcCall',
      'funcCall',
      'funcCall',
      'funcCall',
      'funcCall',
      // One tagged-literal arm per distinct tag documentation: the sql tags, then json.
      'taggedLiteral',
      'taggedLiteral',
      // A codec such as `pg/vector@1` declares a list of element types, so a scalar column takes a
      // list literal too; the codec's declaration decides whether one is accepted.
      'list',
    ]);
    const uuid = value.alternatives
      .filter((alt) => alt.kind === 'funcCall')
      .find((alt) => alt.name === 'uuid');
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
      binder,
      defaultFunctionRegistry,
      dataTypes: EMPTY_DATA_TYPES,
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
      binder,
      defaultFunctionRegistry,
      dataTypes: fixtureDataTypeSupport,
    });
    const value = oneOfMetadata(positionalType(sqlAttributeSpecs.field.default(listCtx)));

    const listDefault = listMetadata(value.alternatives[0]);
    expect(listDefault).toMatchObject({ kind: 'list' });
    expect(listDefault.of).toMatchObject({ kind: 'oneOf' });
    expect(
      value.alternatives.filter((alt) => alt.kind === 'funcCall').map((alt) => alt.name),
    ).toEqual(['autoincrement', 'now', 'uuid', 'cuid', 'ulid', 'nanoid']);
    expect(value.alternatives.filter((alt) => alt.kind === 'taggedLiteral')).toMatchObject([
      {
        label: 'sql`...`',
        tags: ['sql'],
        documentation:
          "A SQL expression in the target database's language. Prisma passes it to the database unchanged.",
      },
      {
        label: 'json`...`',
        tags: ['json'],
        documentation: 'Reads the text as a JSON document and stores it as the default value.',
      },
    ]);
  });

  it('offers every tag but sql as a list element', () => {
    const listCtx = fieldSpecContext({
      symbols: symbolTable,
      model,
      field: field(model, 'tags'),
      binder,
      defaultFunctionRegistry,
      dataTypes: fixtureDataTypeSupport,
    });
    const value = oneOfMetadata(positionalType(sqlAttributeSpecs.field.default(listCtx)));
    const element = oneOfMetadata(listMetadata(value.alternatives[0]).of);
    expect(
      element.alternatives.filter((alt) => alt.kind === 'taggedLiteral').map((alt) => alt.tags),
    ).toEqual([['json']]);
    expect(element.label).toBe('string | number | boolean | null | json`...`');
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
      binder: enumProject.binder,
      defaultFunctionRegistry,
      dataTypes: fixtureDataTypeSupport,
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
      binder: emptyProject.binder,
      defaultFunctionRegistry,
      dataTypes: fixtureDataTypeSupport,
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
      value: { value: { kind: 'member', name: 'Low' } },
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
      value: { value: { kind: 'member', name: 'Member' } },
      diagnostics: [],
    });
  });

  it('takes the enum the field type resolves to in its scope, not a same-named top-level enum', () => {
    const schema = `
enum Role {
  Guest
}
namespace ns {
  enum Role {
    Admin
    Member
  }
  model Post {
    id Int @id
    role Role @default(Member)
  }
}
`;
    expect(interpretDefault(schema, 'role', 'ns')).toEqual({
      value: { value: { kind: 'member', name: 'Member' } },
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

  it('accepts scalar literals on a scalar field as written scalars with their spans', () => {
    const schema = 'model Post {\n  id Int @id\n  price Decimal @default(1.50)\n}\n';
    expect(interpretDefault(schema, 'price')).toEqual({
      value: {
        value: {
          kind: 'scalar',
          written: { kind: 'number', text: '1.50' },
          span: spanOf(schema, '1.50'),
        },
      },
      diagnostics: [],
    });
  });

  it('accepts a list literal on a list field and on a scalar field, where the codec decides', () => {
    const element = (schema: string) => ({
      kind: 'scalar',
      written: { kind: 'string', text: 'a' },
      span: spanOf(schema, '"a"'),
    });
    const listSchema = 'model Post {\n  id Int @id\n  tags String[] @default(["a"])\n}\n';
    const scalarSchema = 'model Post {\n  id Int @id\n  tag String @default(["a"])\n}\n';
    expect(interpretDefault(listSchema, 'tags')).toEqual({
      value: {
        value: { kind: 'list', elements: [element(listSchema)], span: spanOf(listSchema, '["a"]') },
      },
      diagnostics: [],
    });
    expect(interpretDefault(scalarSchema, 'tag')).toEqual({
      value: {
        value: {
          kind: 'list',
          elements: [element(scalarSchema)],
          span: spanOf(scalarSchema, '["a"]'),
        },
      },
      diagnostics: [],
    });
  });

  it('accepts a registered default function and rejects an unregistered one', () => {
    expect(
      interpretDefault('model Post {\n  id Int @id @default(autoincrement())\n}\n', 'id').value,
    ).toEqual({
      value: { kind: 'default-function', call: expect.objectContaining({ fn: 'autoincrement' }) },
    });
    const rejected = interpretDefault('model Post {\n  id Int @id @default(nope())\n}\n', 'id');
    expect(rejected.value).toBeUndefined();
    expect(rejected.diagnostics).toHaveLength(1);
  });
});

function spanOf(text: string, needle: string) {
  const position = (offset: number) => {
    const before = text.slice(0, offset);
    return { offset, line: before.split('\n').length, column: offset - before.lastIndexOf('\n') };
  };
  const start = text.indexOf(needle);
  return { start: position(start), end: position(start + needle.length) };
}
