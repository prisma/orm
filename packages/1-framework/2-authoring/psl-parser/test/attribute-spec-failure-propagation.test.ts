import { notOk, ok, type Result } from '@internal/utils/result';
import { describe, expect, it } from 'vitest';
import { list } from '../src/attribute-spec/combinators/list';
import { oneOf } from '../src/attribute-spec/combinators/one-of';
import { record } from '../src/attribute-spec/combinators/record';
import { interpretAttribute } from '../src/attribute-spec/interpret';
import { modelAttribute } from '../src/attribute-spec/model-attribute';
import type { ArgType, ModelAttributeCtx } from '../src/attribute-spec/types';
import { createBinder } from '../src/binder';
import type { PslDiagnostic } from '../src/diagnostic';
import { parse } from '../src/parse';
import { PslSources } from '../src/source-file';
import { buildSymbolTable, type ModelSymbol } from '../src/symbol-table';

const silent: ArgType<string, ModelAttributeCtx> = {
  kind: 'fieldRef',
  label: 'field name',
  parse: (arg): Result<string, readonly PslDiagnostic[]> =>
    arg.syntax.green.textLength === 4 ? notOk([]) : ok('kept'),
};

function build(text: string) {
  const { document, sources: parsed } = parse(text, 'schema.psl');
  const sources = new PslSources([[document.syntax, parsed.sourceFileFor(document.syntax)]]);
  const { symbolTable } = buildSymbolTable({
    documents: [document],
    sources,
    pslBlockDescriptors: {},
  });
  const model = symbolTable.topLevel.models['User']!;
  const { binder } = createBinder({
    sources,
    symbolTable,
    typeConstructors: {},
    attributeSpecs: { model: {}, field: {} },
    controlMutationDefaults: {
      defaultFunctionRegistry: new Map(),
      dataTypeEntries: {},
    },
  });
  return { sources, model, binder, symbolTable };
}

function interpretFirst<Out>(
  text: string,
  spec: Parameters<typeof interpretAttribute<Out, ModelAttributeCtx>>[1],
) {
  const { sources, model, binder, symbolTable } = build(text);
  const node = Array.from(model.node.attributes())[0];
  if (node === undefined) throw new Error('no attribute');
  return interpretAttribute(node, spec, {
    sources,
    symbols: symbolTable,
    selfModel: model,
    binder,
  });
}

const listSpec = modelAttribute('index', {
  documentation: 'fixture',
  positional: [{ key: 'fields', type: list(silent), documentation: 'fixture' }],
});

const recordSpec = modelAttribute('index', {
  documentation: 'fixture',
  positional: [{ key: 'fields', type: record(silent), documentation: 'fixture' }],
});

const scalarSpec = modelAttribute('index', {
  documentation: 'fixture',
  positional: [{ key: 'field', type: silent, documentation: 'fixture' }],
});

describe('a failure carrying no diagnostics', () => {
  it('fails the list instead of dropping the element', () => {
    const result = interpretFirst('model User {\n  id Int\n  @@index([id, fail])\n}', listSpec);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure).toEqual([]);
  });

  it('fails the record instead of dropping the entry', () => {
    const result = interpretFirst(
      'model User {\n  id Int\n  @@index({ a: id, b: fail })\n}',
      recordSpec,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure).toEqual([]);
  });

  it('fails the attribute instead of returning it without the argument', () => {
    const result = interpretFirst('model User {\n  id Int\n  @@index(fail)\n}', scalarSpec);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure).toEqual([]);
  });

  it('leaves a wholly successful parse untouched', () => {
    const result = interpretFirst('model User {\n  id Int\n  @@index([id])\n}', listSpec);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ fields: ['kept'] });
  });

  it('still reports the diagnostics a failing sibling argument carries', () => {
    const loud: ArgType<string, ModelAttributeCtx> = {
      kind: 'fieldRef',
      label: 'field name',
      parse: (arg): Result<string, readonly PslDiagnostic[]> =>
        arg.syntax.green.textLength === 4
          ? notOk([
              {
                code: 'PSL_INVALID_ATTRIBUTE_SYNTAX',
                message: 'loud failure',
                filename: 'schema.psl',
                ...{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } } },
              },
            ])
          : ok('kept'),
    };
    const loudSpec = modelAttribute('index', {
      documentation: 'fixture',
      positional: [{ key: 'fields', type: list(loud), documentation: 'fixture' }],
    });
    const result = interpretFirst('model User {\n  id Int\n  @@index([id, fail])\n}', loudSpec);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.map(({ message }) => message)).toEqual(['loud failure']);
  });
});

describe('ModelSymbol fixture sanity', () => {
  it('builds the model the failure tests lean on', () => {
    const { model }: { model: ModelSymbol } = build('model User {\n  id Int\n}');
    expect(model.name).toBe('User');
  });
});

describe('oneOf and a silently failing alternative', () => {
  const silentAlt: ArgType<string, ModelAttributeCtx> = {
    kind: 'fieldRef',
    label: 'field name',
    parse: (): Result<string, readonly PslDiagnostic[]> => notOk([]),
  };

  const loudAlt: ArgType<string, ModelAttributeCtx> = {
    kind: 'identifier',
    label: 'a four-character name',
    parse: (arg): Result<string, readonly PslDiagnostic[]> =>
      arg.syntax.green.textLength === 4
        ? ok('matched')
        : notOk([
            {
              code: 'PSL_INVALID_ATTRIBUTE_SYNTAX',
              message: 'not four characters',
              filename: 'schema.psl',
              range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
            },
          ]),
  };

  const specOf = (type: ArgType<string, ModelAttributeCtx>) =>
    modelAttribute('index', {
      documentation: 'fixture',
      positional: [{ key: 'fields', type, documentation: 'fixture' }],
    });

  it('adds no diagnostic of its own when an alternative failed silently', () => {
    const result = interpretFirst(
      'model User {\n  id Int\n  @@index(sevench)\n}',
      specOf(oneOf(silentAlt, loudAlt)),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure).toEqual([]);
  });

  it('still lets a later alternative match what an earlier one refused silently', () => {
    const result = interpretFirst(
      'model User {\n  id Int\n  @@index(Keep)\n}',
      specOf(oneOf(silentAlt, loudAlt)),
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ fields: 'matched' });
  });

  it('keeps its own diagnostic when every alternative failed loudly', () => {
    const result = interpretFirst(
      'model User {\n  id Int\n  @@index(sevench)\n}',
      specOf(oneOf(loudAlt, loudAlt)),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.map(({ message }) => message)).toEqual([
        'Expected one of: a four-character name | a four-character name',
      ]);
    }
  });
});
