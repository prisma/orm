import type {
  AuthoringFieldPresetDescriptor,
  AuthoringTypeConstructorDescriptor,
} from '@internal/framework-components/authoring';
import { describe, expect, it } from 'vitest';
import { EMPTY_DATA_TYPES } from '../src/attribute-spec/spec-context';
import {
  type BinderContext,
  contributedTypeOf,
  createBinder,
  typeReferenceNode,
} from '../src/binder';
import { parse } from '../src/parse';
import { PslSources } from '../src/source-file';
import { buildSymbolTable } from '../src/symbol-table';

const createdAt: AuthoringFieldPresetDescriptor = {
  kind: 'fieldPreset',
  output: { codecId: 'fixture/timestamp@1', nativeType: 'timestamp' },
};

const uuid: AuthoringFieldPresetDescriptor = {
  kind: 'fieldPreset',
  args: [{ kind: 'number', name: 'version' }],
  output: { codecId: 'fixture/uuid@1', nativeType: 'uuid', id: true },
};

const text: AuthoringTypeConstructorDescriptor = {
  kind: 'typeConstructor',
  output: { codecId: 'fixture/text@1', nativeType: 'text' },
};

const varchar: AuthoringTypeConstructorDescriptor = {
  kind: 'typeConstructor',
  args: [{ kind: 'number', name: 'length' }],
  output: { codecId: 'fixture/varchar@1', nativeType: 'varchar' },
};

function context(): BinderContext {
  return {
    authoringContributions: {
      type: { String: text, db: { VarChar: varchar } },
      field: { temporal: { createdAt }, db: { uuid } },
      entityTypes: {},
      attributeSpecs: { model: {}, field: {} },
      modelAttributes: {},
      pslBlockDescriptors: {},
      dataTypes: {},
    },
    controlMutationDefaults: { defaultFunctionRegistry: new Map() },
    dataTypes: EMPTY_DATA_TYPES,
  };
}

function bindProject(text: string) {
  const { document, sources } = parse(text, 'schema.prisma');
  const pslSources = new PslSources([[document.syntax, sources.sourceFileFor(document.syntax)]]);
  const { symbolTable } = buildSymbolTable({ documents: [document], sources: pslSources });
  const { binder, diagnostics } = createBinder({
    symbolTable,
    sources: pslSources,
    context: context(),
  });
  const resolve = (fieldName: string) => {
    const field = symbolTable.topLevel.models['Post']?.fields[fieldName];
    const node = field === undefined ? undefined : typeReferenceNode(field);
    return node === undefined ? undefined : binder.symbolForNode(node);
  };
  return { resolve, diagnostics, binder };
}

describe('createBinder — contributed types', () => {
  it('binds a field-preset name to the preset descriptor', () => {
    const { resolve, diagnostics } = bindProject(
      'model Post {\n  created temporal.createdAt()\n  bare temporal.createdAt\n}',
    );

    expect(diagnostics).toEqual([]);
    for (const field of ['created', 'bare']) {
      expect(resolve(field)).toEqual({
        kind: 'contributedType',
        symbol: {
          kind: 'contributedType',
          name: 'createdAt',
          path: ['temporal', 'createdAt'],
          descriptor: createdAt,
        },
      });
    }
  });

  it('binds a type-constructor name to the type-constructor descriptor', () => {
    const { resolve } = bindProject('model Post {\n  title String\n  slug db.VarChar(10)\n}');

    expect(resolve('title')).toEqual({
      kind: 'contributedType',
      symbol: { kind: 'contributedType', name: 'String', path: ['String'], descriptor: text },
    });
    expect(resolve('slug')).toEqual({
      kind: 'contributedType',
      symbol: {
        kind: 'contributedType',
        name: 'VarChar',
        path: ['db', 'VarChar'],
        descriptor: varchar,
      },
    });
  });

  it('binds presets and type constructors that share a namespace', () => {
    const { resolve, diagnostics } = bindProject(
      'model Post {\n  id db.uuid(7)\n  slug db.VarChar(10)\n}',
    );

    expect(diagnostics).toEqual([]);
    expect(resolve('id')).toEqual({
      kind: 'contributedType',
      symbol: { kind: 'contributedType', name: 'uuid', path: ['db', 'uuid'], descriptor: uuid },
    });
    expect(resolve('slug')).toMatchObject({
      kind: 'contributedType',
      symbol: { path: ['db', 'VarChar'], descriptor: varchar },
    });
  });

  describe('contributedTypeOf', () => {
    it('returns the contributed type a field resolves to', () => {
      const { resolve, binder } = bindProject('model Post {\n  title String\n}');

      expect(contributedTypeOf(resolve('title'), binder)).toEqual({
        kind: 'contributedType',
        name: 'String',
        path: ['String'],
        descriptor: text,
      });
    });

    it('follows a named type to the contributed type of its base', () => {
      const { resolve, binder } = bindProject(
        'types {\n  Slug = db.VarChar(10)\n}\nmodel Post {\n  slug Slug\n}',
      );

      expect(resolve('slug')?.kind).toBe('namedType');
      expect(contributedTypeOf(resolve('slug'), binder)).toEqual({
        kind: 'contributedType',
        name: 'VarChar',
        path: ['db', 'VarChar'],
        descriptor: varchar,
      });
    });

    it('returns undefined for a resolution that is not a contributed type', () => {
      const { resolve, binder } = bindProject(
        'model Author {\n  id String\n}\nmodel Post {\n  author Author\n  missing Nope\n}',
      );

      expect(contributedTypeOf(resolve('author'), binder)).toBeUndefined();
      expect(contributedTypeOf(resolve('missing'), binder)).toBeUndefined();
      expect(contributedTypeOf(undefined, binder)).toBeUndefined();
    });
  });
});
