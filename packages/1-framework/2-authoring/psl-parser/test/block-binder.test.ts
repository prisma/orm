import { expect, it } from 'vitest';
import { blockAttribute } from '../src/attribute-spec/block-attribute';
import { entityRef } from '../src/attribute-spec/combinators/entity-ref';
import { identifier } from '../src/attribute-spec/combinators/identifier';
import { jsonValue } from '../src/attribute-spec/combinators/json-value';
import { list } from '../src/attribute-spec/combinators/list';
import { oneOf } from '../src/attribute-spec/combinators/one-of';
import { modelAttribute } from '../src/attribute-spec/model-attribute';
import type { ArgType, AttributeCtx } from '../src/attribute-spec/types';
import { createBinder } from '../src/binder';
import { mapBlock } from '../src/block-spec/binders';
import { parse } from '../src/parse';
import { buildSymbolTable } from '../src/symbol-table';
import { ArrayLiteralAst } from '../src/syntax/ast/expressions';

const reference = entityRef({ kind: 'model' });

function bind(
  source: string,
  rule: ArgType<unknown, AttributeCtx> = oneOf(reference, identifier()),
) {
  const { document, sources } = parse(source, 'binder.psl');
  const { symbolTable } = buildSymbolTable({ documents: [document], sources });
  const parameters = {
    positional: [{ key: 'target', type: rule, documentation: 'target' }],
    named: { targets: { type: list(rule), documentation: 'targets' } },
    documentation: 'references',
  };
  return {
    symbolTable,
    ...createBinder({
      sources,
      symbolTable,
      typeConstructors: {},
      controlMutationDefaults: { defaultFunctionRegistry: new Map(), dataTypeEntries: {} },
      attributeSpecs: { model: { refs: () => modelAttribute('refs', parameters) }, field: {} },
      pslBlockDescriptors: {
        policy: {
          kind: 'pslBlock',
          keyword: 'policy',
          discriminator: 'policy',
          name: { required: true },
          spec: () => mapBlock({ value: { type: rule, documentation: 'target' } }),
          attributes: { refs: () => blockAttribute('refs', parameters) },
        },
      },
    }),
  };
}

it('shares forward entity binding and silent identifier fallback across entries and attributes', () => {
  const { binder, diagnostics, symbolTable } = bind(
    [
      'policy Root {',
      ' target = Later',
      ' @@refs(Later, targets: [External])',
      '}',
      'model Later {',
      ' @@refs(External, targets: [Later])',
      '}',
      'namespace app {',
      ' policy Local {',
      '  target = Later',
      '  fallback = Global',
      '  @@refs(Later, targets: [Global, External])',
      ' }',
      ' model Later {}',
      '}',
      'model Global {}',
    ].join('\n'),
  );
  expect(diagnostics).toEqual([]);
  const root = symbolTable.topLevel.blocks['Root']!;
  const local = symbolTable.topLevel.namespaces['app']!;
  const resolutions = [...local.blocks['Local']!.node.entries()].map((entry) =>
    binder.symbolForNode(entry.value()!.syntax),
  );
  expect(resolutions).toEqual([
    { kind: 'model', symbol: local.models['Later'], namespace: local },
    { kind: 'model', symbol: symbolTable.topLevel.models['Global'] },
  ]);
  expect(binder.symbolForNode([...root.node.entries()][0]!.value()!.syntax)).toEqual({
    kind: 'model',
    symbol: symbolTable.topLevel.models['Later'],
  });
  const attributeResolutions = [
    root,
    local.blocks['Local']!,
    symbolTable.topLevel.models['Later']!,
  ].map((holder) => {
    const args = [...[...holder.node.attributes()][0]!.argList()!.args()];
    const targets = ArrayLiteralAst.cast(args[1]!.value()!.syntax)!;
    return [
      binder.symbolForNode(args[0]!.value()!.syntax),
      ...[...targets.elements()].map((target) => binder.symbolForNode(target.syntax)),
    ];
  });
  const external = { kind: 'unresolved', name: 'External' };
  const later = { kind: 'model', symbol: symbolTable.topLevel.models['Later'] };
  expect(attributeResolutions).toEqual([
    [later, external],
    [
      { kind: 'model', symbol: local.models['Later'], namespace: local },
      { kind: 'model', symbol: symbolTable.topLevel.models['Global'] },
      external,
    ],
    [external, later],
  ]);
});

it('terminates recursive inspectable graphs and still finds references after cycles', () => {
  const recursive = { ...oneOf(reference, identifier()), alternatives: [] as unknown[] };
  recursive.alternatives.push({ of: recursive }, reference, identifier());
  const { diagnostics } = bind(
    'policy P {\n target = Missing\n @@refs(Missing)\n}\nmodel M {\n @@refs(Missing)\n}',
    recursive,
  );
  expect(diagnostics).toEqual([]);
});

it('reports strict references once per entry or argument even through a recursive graph', () => {
  const recursive = { ...oneOf(reference, identifier()), alternatives: [] as unknown[] };
  recursive.alternatives.push({ of: recursive }, reference);
  const { diagnostics, binder, symbolTable } = bind(
    [
      'policy P {',
      ' target = Missing',
      ' valid = Later',
      ' @@refs(Missing, targets: [Missing])',
      '}',
      'model Later {',
      ' @@refs(Missing, targets: [Missing])',
      '}',
    ].join('\n'),
    recursive,
  );
  expect(diagnostics.map(({ code, message, data }) => ({ code, message, data }))).toEqual(
    Array.from({ length: 5 }, () => ({
      code: 'PSL_UNRESOLVED_REFERENCE',
      message: 'Cannot find entity "Missing"',
      data: { reference: 'entity' },
    })),
  );
  const entries = [...symbolTable.topLevel.blocks['P']!.node.entries()];
  expect(binder.symbolForNode(entries[0]!.value()!.syntax)).toEqual({
    kind: 'unresolved',
    name: 'Missing',
  });
  expect(binder.symbolForNode(entries[1]!.value()!.syntax)).toEqual({
    kind: 'model',
    symbol: symbolTable.topLevel.models['Later'],
  });
});

it('does not treat recursive JSON metadata as references', () => {
  expect(
    bind('policy P {\n target = [null, { value: true }]\n @@refs(null)\n}', jsonValue())
      .diagnostics,
  ).toEqual([]);
});
