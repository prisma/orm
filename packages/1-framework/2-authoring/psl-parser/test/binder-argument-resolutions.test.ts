import { describe, expect, it } from 'vitest';
import { blockAttribute } from '../src/attribute-spec/block-attribute';
import { entityRef } from '../src/attribute-spec/combinators/entity-ref';
import { funcCall } from '../src/attribute-spec/combinators/func-call';
import { identifier } from '../src/attribute-spec/combinators/identifier';
import { oneOf } from '../src/attribute-spec/combinators/one-of';
import { str } from '../src/attribute-spec/combinators/str';
import { fieldAttribute } from '../src/attribute-spec/field-attribute';
import { createBinder } from '../src/binder';
import { mapBlock, structBlock } from '../src/block-spec/constructors';
import { parse } from '../src/parse';
import { buildSymbolTable } from '../src/symbol-table';
import { FunctionCallAst } from '../src/syntax/ast/expressions';
import { binderContext } from './support';

const scalarTypes = {
  Int: {
    kind: 'typeConstructor' as const,
    output: { codecId: 'fixture/int@1', nativeType: 'int' },
  },
  String: {
    kind: 'typeConstructor' as const,
    output: { codecId: 'fixture/string@1', nativeType: 'string' },
  },
};

function bind(source: string, context: ReturnType<typeof binderContext>) {
  const { document, sources } = parse(source, 'binder.psl');
  const { symbolTable } = buildSymbolTable({ documents: [document], sources });
  return { symbolTable, ...createBinder({ sources, symbolTable, context }) };
}

describe('createBinder — attribute-argument parameters', () => {
  it('resolves a named attribute-argument key to the owning attribute', () => {
    const referencesParam = { type: str(), documentation: 'Referenced fields.' };
    const relationSpec = fieldAttribute('relation', {
      documentation: 'Declares a relation.',
      named: { references: referencesParam },
    });
    const { symbolTable, binder, diagnostics } = bind(
      'model User {\n  id Int\n  author User @relation(references: "id")\n}',
      binderContext({
        contributedTypes: scalarTypes,
        attributeSpecs: { field: { relation: () => relationSpec }, model: {} },
      }),
    );
    expect(diagnostics).toEqual([]);
    const field = symbolTable.topLevel.models['User']!.fields['author']!;
    const attribute = [...field.node.attributes()][0]!;
    const keyNode = [...attribute.argList()!.args()][0]!.name()!.syntax;
    expect(binder.symbolForNode(keyNode)).toEqual({
      kind: 'parameter',
      symbol: {
        kind: 'parameter',
        name: 'references',
        param: referencesParam,
        owner: { kind: 'attribute', name: 'relation', level: 'field', spec: relationSpec },
      },
    });
  });
});

describe('createBinder — function calls', () => {
  it('resolves a function-call name and its named argument key', () => {
    const modeParam = { type: str(), documentation: 'The mode.' };
    const chooseFunc = funcCall('choose', {
      documentation: 'Chooses a mode.',
      named: { mode: modeParam },
    });
    const defaultSpec = fieldAttribute('default', {
      documentation: 'Sets a default.',
      positional: [{ key: 'value', type: chooseFunc, documentation: 'The default value.' }],
    });
    const { symbolTable, binder, diagnostics } = bind(
      'model User {\n  mode String @default(choose(mode: "x"))\n}',
      binderContext({
        contributedTypes: scalarTypes,
        attributeSpecs: { field: { default: () => defaultSpec }, model: {} },
      }),
    );
    expect(diagnostics).toEqual([]);
    const field = symbolTable.topLevel.models['User']!.fields['mode']!;
    const attribute = [...field.node.attributes()][0]!;
    const callArg = [...attribute.argList()!.args()][0]!;
    const call = FunctionCallAst.cast(callArg.value()!.syntax)!;
    const nameNode = call.name()!.syntax;
    const modeKeyNode = [...call.args()][0]!.name()!.syntax;
    const functionSymbol = { kind: 'function', name: 'choose', signature: chooseFunc.signature };
    expect(binder.symbolForNode(nameNode)).toEqual({ kind: 'function', symbol: functionSymbol });
    expect(binder.symbolForNode(modeKeyNode)).toEqual({
      kind: 'parameter',
      symbol: { kind: 'parameter', name: 'mode', param: modeParam, owner: functionSymbol },
    });
  });

  it('leaves no function or parameter record when a oneOf alternative matches the name but not the arguments', () => {
    const knownFunc = funcCall('known', {
      documentation: '',
      positional: [{ key: 'target', type: str(), documentation: '' }],
    });
    const rule = oneOf(knownFunc, identifier('Known', { documentation: '' }));
    const attributeSpec = fieldAttribute('attr', {
      documentation: '',
      named: { value: { type: rule, documentation: '' } },
    });
    const { symbolTable, binder, diagnostics } = bind(
      'model User {\n  id Int @attr(value: known(1, 2))\n}',
      binderContext({
        contributedTypes: scalarTypes,
        attributeSpecs: { field: { attr: () => attributeSpec }, model: {} },
      }),
    );
    expect(diagnostics).toEqual([]);
    const field = symbolTable.topLevel.models['User']!.fields['id']!;
    const attribute = [...field.node.attributes()][0]!;
    const callArg = [...attribute.argList()!.args()][0]!;
    const call = FunctionCallAst.cast(callArg.value()!.syntax)!;
    expect(binder.symbolForNode(call.name()!.syntax)).toBeUndefined();
  });
});

describe('createBinder — constants', () => {
  it('resolves a fixed-identifier value to a constant', () => {
    const onDeleteSpec = fieldAttribute('relation', {
      documentation: '',
      named: {
        onDelete: {
          type: identifier('Cascade', { documentation: 'Cascading delete.' }),
          documentation: '',
        },
      },
    });
    const { symbolTable, binder, diagnostics } = bind(
      'model User {\n  author User @relation(onDelete: Cascade)\n}',
      binderContext({ attributeSpecs: { field: { relation: () => onDeleteSpec }, model: {} } }),
    );
    expect(diagnostics).toEqual([]);
    const field = symbolTable.topLevel.models['User']!.fields['author']!;
    const attribute = [...field.node.attributes()][0]!;
    const valueNode = [...attribute.argList()!.args()][0]!.value()!.syntax;
    expect(binder.symbolForNode(valueNode)).toEqual({
      kind: 'constant',
      symbol: { kind: 'constant', name: 'Cascade', documentation: 'Cascading delete.' },
    });
  });

  it('resolves a constant inside a oneOf once a preceding entity-reference alternative fails', () => {
    const onDeleteSpec = fieldAttribute('relation', {
      documentation: '',
      named: {
        onDelete: {
          type: oneOf(
            entityRef({ kind: 'model' }),
            identifier('Cascade', { documentation: 'Cascading delete.' }),
          ),
          documentation: '',
        },
      },
    });
    const { symbolTable, binder, diagnostics } = bind(
      'model User {\n  author User @relation(onDelete: Cascade)\n}',
      binderContext({ attributeSpecs: { field: { relation: () => onDeleteSpec }, model: {} } }),
    );
    expect(diagnostics).toEqual([]);
    const field = symbolTable.topLevel.models['User']!.fields['author']!;
    const attribute = [...field.node.attributes()][0]!;
    const valueNode = [...attribute.argList()!.args()][0]!.value()!.syntax;
    expect(binder.symbolForNode(valueNode)).toEqual({
      kind: 'constant',
      symbol: { kind: 'constant', name: 'Cascade', documentation: 'Cascading delete.' },
    });
  });

  it('keeps only the matching alternative of a oneOf of fixed identifiers', () => {
    const onDeleteSpec = fieldAttribute('relation', {
      documentation: '',
      named: {
        onDelete: {
          type: oneOf(
            identifier('Cascade', { documentation: 'Cascading delete.' }),
            identifier('Restrict', { documentation: 'Restrict delete.' }),
          ),
          documentation: '',
        },
      },
    });
    const { symbolTable, binder, diagnostics } = bind(
      'model User {\n  author User @relation(onDelete: Restrict)\n}',
      binderContext({ attributeSpecs: { field: { relation: () => onDeleteSpec }, model: {} } }),
    );
    expect(diagnostics).toEqual([]);
    const field = symbolTable.topLevel.models['User']!.fields['author']!;
    const attribute = [...field.node.attributes()][0]!;
    const valueNode = [...attribute.argList()!.args()][0]!.value()!.syntax;
    expect(binder.symbolForNode(valueNode)).toEqual({
      kind: 'constant',
      symbol: { kind: 'constant', name: 'Restrict', documentation: 'Restrict delete.' },
    });
  });

  it('finds the matching fixed identifier regardless of its position among several alternatives', () => {
    const onDeleteSpec = fieldAttribute('relation', {
      documentation: '',
      named: {
        onDelete: {
          type: oneOf(
            identifier('NoAction', { documentation: 'No action.' }),
            identifier('Restrict', { documentation: 'Restrict delete.' }),
            identifier('Cascade', { documentation: 'Cascading delete.' }),
            identifier('SetNull', { documentation: 'Set null.' }),
            identifier('SetDefault', { documentation: 'Set default.' }),
          ),
          documentation: '',
        },
      },
    });
    const { symbolTable, binder, diagnostics } = bind(
      'model User {\n  author User @relation(onDelete: Cascade)\n}',
      binderContext({ attributeSpecs: { field: { relation: () => onDeleteSpec }, model: {} } }),
    );
    expect(diagnostics).toEqual([]);
    const field = symbolTable.topLevel.models['User']!.fields['author']!;
    const attribute = [...field.node.attributes()][0]!;
    const valueNode = [...attribute.argList()!.args()][0]!.value()!.syntax;
    expect(binder.symbolForNode(valueNode)).toEqual({
      kind: 'constant',
      symbol: { kind: 'constant', name: 'Cascade', documentation: 'Cascading delete.' },
    });
  });
});

describe('createBinder — block parameters and attributes', () => {
  it('resolves a struct-block entry key to the owning block', () => {
    const usingParam = { type: str(), documentation: 'The policy filter.' };
    const { symbolTable, binder, diagnostics } = bind(
      'policy ReadOwn {\n  using = "x"\n}',
      binderContext({
        pslBlockDescriptors: {
          policy: {
            kind: 'pslBlock',
            keyword: 'policy',
            discriminator: 'policy',
            name: { required: true },
            spec: () => structBlock({ parameters: { using: usingParam } }),
          },
        },
      }),
    );
    expect(diagnostics).toEqual([]);
    const block = symbolTable.topLevel.blocks['ReadOwn']!;
    const entry = [...block.node.entries()][0]!;
    expect(binder.symbolForNode(entry.key()!.syntax)).toEqual({
      kind: 'parameter',
      symbol: { kind: 'parameter', name: 'using', param: usingParam, owner: block },
    });
  });

  it('does not resolve a map-block entry key', () => {
    const { symbolTable, binder, diagnostics } = bind(
      'view Summary {\n  total = "x"\n}',
      binderContext({
        pslBlockDescriptors: {
          view: {
            kind: 'pslBlock',
            keyword: 'view',
            discriminator: 'view',
            name: { required: true },
            spec: () => mapBlock({ value: { type: str(), documentation: 'doc' } }),
          },
        },
      }),
    );
    expect(diagnostics).toEqual([]);
    const block = symbolTable.topLevel.blocks['Summary']!;
    const entry = [...block.node.entries()][0]!;
    expect(binder.symbolForNode(entry.key()!.syntax)).toBeUndefined();
  });

  it('resolves a block attribute name and its named-argument key', () => {
    const labelParam = { type: str(), documentation: 'The label.' };
    const someBlockAttribute = blockAttribute('someBlockAttribute', {
      documentation: 'Does something.',
      named: { label: labelParam },
    });
    const { symbolTable, binder, diagnostics } = bind(
      'policy ReadOwn {\n  @@someBlockAttribute(label: "x")\n}',
      binderContext({
        pslBlockDescriptors: {
          policy: {
            kind: 'pslBlock',
            keyword: 'policy',
            discriminator: 'policy',
            name: { required: true },
            spec: () => structBlock({ parameters: {} }),
            attributes: { someBlockAttribute: () => someBlockAttribute },
          },
        },
      }),
    );
    expect(diagnostics).toEqual([]);
    const block = symbolTable.topLevel.blocks['ReadOwn']!;
    const attribute = [...block.node.attributes()][0]!;
    const nameNode = attribute.name()!.syntax;
    const attributeSymbol = {
      kind: 'attribute',
      name: 'someBlockAttribute',
      level: 'block',
      spec: someBlockAttribute,
    };
    expect(binder.symbolForNode(nameNode)).toEqual({ kind: 'attribute', symbol: attributeSymbol });
    const labelKeyNode = [...attribute.argList()!.args()][0]!.name()!.syntax;
    expect(binder.symbolForNode(labelKeyNode)).toEqual({
      kind: 'parameter',
      symbol: { kind: 'parameter', name: 'label', param: labelParam, owner: attributeSymbol },
    });
  });
});
