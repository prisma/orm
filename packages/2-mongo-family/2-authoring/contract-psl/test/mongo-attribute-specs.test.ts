import type {
  ArgType,
  AttributeCtx,
  AttributeSpecContext,
  FieldAttributeSpecContext,
  FuncCallSig,
  ModelAttributeCtx,
  Param,
} from '@internal/psl-parser';
import { buildSymbolTable } from '@internal/psl-parser';
import { parse } from '@internal/psl-parser/syntax';
import { describe, expect, it } from 'vitest';
import { mongoAttributeSpecs } from '../src/mongo-attribute-specs';

interface ListMetadata<T, Ctx extends AttributeCtx> extends ArgType<readonly T[], Ctx> {
  readonly kind: 'list';
  readonly of: ArgType<T, Ctx>;
  readonly allowEmpty: boolean;
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

function contexts(): { model: AttributeSpecContext; field: FieldAttributeSpecContext } {
  const { document, sourceFile } = parse(`
    model Widget {
      id   ObjectId @id @map("_id")
      name String
    }
  `);
  const { table } = buildSymbolTable({ document, sourceFile, pslBlockDescriptors: {} });
  const model = table.topLevel.models['Widget'];
  const field = model?.fields['name'];
  if (!model || !field) throw new Error('fixture declares Widget.name');
  const modelContext: AttributeSpecContext = {
    symbols: table,
    model,
    controlMutationDefaults: {
      defaultFunctionRegistry: new Map(),
      defaultLiteralTagRegistry: new Map(),
    },
  };
  return { model: modelContext, field: { ...modelContext, field } };
}

describe('mongoAttributeSpecs', () => {
  it('registers every Mongo built-in at its level', () => {
    expect({
      model: Object.keys(mongoAttributeSpecs.model).sort(),
      field: Object.keys(mongoAttributeSpecs.field).sort(),
    }).toEqual({
      model: ['base', 'discriminator', 'index', 'map', 'textIndex', 'unique'],
      field: ['id', 'map', 'relation', 'unique'],
    });
  });

  it('yields a model-level spec named by its key from every model factory', () => {
    const { model } = contexts();
    const produced = Object.entries(mongoAttributeSpecs.model).map(([name, factory]) => {
      const spec = factory(model);
      return { key: name, name: spec.name, level: spec.level };
    });
    expect(produced).toEqual(
      Object.keys(mongoAttributeSpecs.model).map((name) => ({ key: name, name, level: 'model' })),
    );
  });

  it('yields a field-level spec named by its key from every field factory', () => {
    const { field } = contexts();
    const produced = Object.entries(mongoAttributeSpecs.field).map(([name, factory]) => {
      const spec = factory(field);
      return { key: name, name: spec.name, level: spec.level };
    });
    expect(produced).toEqual(
      Object.keys(mongoAttributeSpecs.field).map((name) => ({ key: name, name, level: 'field' })),
    );
  });

  it('returns the same static spec object on every call', () => {
    const { model, field } = contexts();
    expect(mongoAttributeSpecs.model.map(model)).toBe(mongoAttributeSpecs.model.map(model));
    expect(mongoAttributeSpecs.field.relation(field)).toBe(
      mongoAttributeSpecs.field.relation(field),
    );
  });

  it('documents wildcard fields only for non-unique indexes', () => {
    const { model } = contexts();
    expect({
      index: mongoAttributeSpecs.model.index(model).positional[0]?.documentation,
      unique: mongoAttributeSpecs.model.unique(model).positional[0]?.documentation,
    }).toEqual({
      index:
        'The nonempty list of indexed fields, optionally with sort directions or a wildcard scope.',
      unique:
        'The nonempty list of indexed fields, optionally with sort directions. Wildcard scopes are not supported.',
    });
  });

  it('exposes model-specific index field alternatives from the actual factory', () => {
    const { model } = contexts();
    const fields = listMetadata<string | unknown, ModelAttributeCtx>(
      positionalType(mongoAttributeSpecs.model.index(model)),
    );
    const element = oneOfMetadata(fields.of);

    expect(fields).toMatchObject({ kind: 'list', allowEmpty: false });
    expect(element.alternatives[0]).toMatchObject({ kind: 'fieldRef' });
    const wildcard = element.alternatives[1] as FuncCallMetadata<ModelAttributeCtx>;
    expect(wildcard).toMatchObject({ kind: 'funcCall', name: 'wildcard' });
    expect(wildcard.signature.positional?.[0]).toMatchObject({ key: 'scope' });
    expect(wildcard.signature.positional?.[0]?.type).toMatchObject({
      kind: 'entityRef',
      optional: true,
    });
    expect(
      element.alternatives.slice(2).map((alt) => (alt as FuncCallMetadata<ModelAttributeCtx>).name),
    ).toEqual(['id', 'name']);

    const nameField = element.alternatives[3] as FuncCallMetadata<ModelAttributeCtx>;
    const sort = nameField.signature.named?.['sort'];
    if (sort === undefined) throw new Error('field sort argument is present');
    expect(nameField.signature.documentation).toBe(
      'Selects an index field with an explicit sort direction.',
    );
    expect(sort.documentation).toBe('The index order for this field: `Asc` or `Desc`.');
    expect(oneOfMetadata(sort.type).alternatives).toEqual([
      expect.objectContaining({ kind: 'identifier', name: 'Asc' }),
      expect.objectContaining({ kind: 'identifier', name: 'Desc' }),
    ]);
  });

  it('exposes nested optional index and text-index metadata from actual factories', () => {
    const { model } = contexts();
    const type = oneOfMetadata(namedType(mongoAttributeSpecs.model.index(model), 'type'));
    expect(type).toMatchObject({ kind: 'oneOf', optional: true });
    expect(type.alternatives).toEqual([
      expect.objectContaining({ kind: 'num', value: 1 }),
      expect.objectContaining({ kind: 'num', value: -1 }),
      expect.objectContaining({ kind: 'str', value: 'text' }),
      expect.objectContaining({ kind: 'str', value: '2dsphere' }),
      expect.objectContaining({ kind: 'str', value: '2d' }),
      expect.objectContaining({ kind: 'str', value: 'hashed' }),
    ]);

    const include = listMetadata<string, ModelAttributeCtx>(
      namedType(mongoAttributeSpecs.model.index(model), 'include'),
    );
    expect(include).toMatchObject({ kind: 'list', optional: true });
    expect(include.of).toMatchObject({ kind: 'str', value: undefined });

    const weights = recordMetadata<number, ModelAttributeCtx>(
      namedType(mongoAttributeSpecs.model.textIndex(model), 'weights'),
    );
    expect(weights).toMatchObject({ kind: 'record', optional: true });
    expect(weights.of).toMatchObject({ kind: 'int', min: 1, max: 99_999 });
  });
});
