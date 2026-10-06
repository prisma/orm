import { expect, it } from 'vitest';
import { blockAttribute } from '../src/attribute-spec/block-attribute';
import { bool } from '../src/attribute-spec/combinators/bool';
import { entityRef } from '../src/attribute-spec/combinators/entity-ref';
import { fieldRef } from '../src/attribute-spec/combinators/field-ref';
import { funcCall } from '../src/attribute-spec/combinators/func-call';
import { identifier } from '../src/attribute-spec/combinators/identifier';
import { int } from '../src/attribute-spec/combinators/int';
import { jsonValue } from '../src/attribute-spec/combinators/json-value';
import { list } from '../src/attribute-spec/combinators/list';
import { num } from '../src/attribute-spec/combinators/num';
import { oneOf } from '../src/attribute-spec/combinators/one-of';
import { record } from '../src/attribute-spec/combinators/record';
import { str } from '../src/attribute-spec/combinators/str';
import { fieldAttribute } from '../src/attribute-spec/field-attribute';
import { modelAttribute } from '../src/attribute-spec/model-attribute';
import { optional } from '../src/attribute-spec/optional';
import type { ArgType, AttributeCtx } from '../src/attribute-spec/types';
import { createBinder } from '../src/binder';
import { mapBlock } from '../src/block-spec/constructors';
import { parse } from '../src/parse';
import { buildSymbolTable } from '../src/symbol-table';
import { ArrayLiteralAst, FunctionCallAst } from '../src/syntax/ast/expressions';
import { binderContext } from './support';

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
    sources,
    ...createBinder({
      sources,
      symbolTable,
      context: binderContext({
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
      'namespace app {}',
      'namespace app {',
      ' policy Local {',
      '  target = Later',
      '  fallback = Global',
      '  @@refs(Later, targets: [Global, External])',
      ' }',
      '}',
      'namespace app {',
      ' model Later {}',
      '}',
      'model Global {}',
    ].join('\n'),
  );
  expect(diagnostics).toEqual([]);
  const root = symbolTable.topLevel.blocks['Root']!;
  const local = symbolTable.topLevel.namespaces['app']!;
  const scope = binder.scopeAt(local.models['Later']!.node.syntax);
  expect(binder.scopeAt(local.blocks['Local']!.node.syntax)).toBe(scope);
  for (const declaration of local.declarations) {
    expect(binder.scopeAt(declaration.node.syntax)).toBe(scope);
  }
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
  const external = undefined;
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

it('matches recursive JSON through actual child expressions', () => {
  const recursive = oneOf(reference, jsonValue());
  const { diagnostics } = bind(
    'policy P {\n target = [null, { nested: [true, 12] }]\n @@refs(null)\n}\nmodel M {\n @@refs(null)\n}',
    recursive,
  );
  expect(diagnostics).toEqual([]);
});

it('reports strict references once per entry or argument after all alternatives fail', () => {
  const recursive = oneOf(reference, entityRef({ kind: 'block', keyword: 'role' }));
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

it.each([
  oneOf(reference, bool()),
  oneOf(reference, num()),
  oneOf(reference, str()),
  oneOf(reference, identifier('Other', { documentation: 'other' })),
])('treats non-reference leaf alternatives as successful binding no-ops for $label', (rule) => {
  const { diagnostics } = bind(
    'policy P {\n target = Missing\n @@refs(Missing, targets: [Missing])\n}\nmodel M {\n @@refs(Missing, targets: [Missing])\n}',
    rule,
  );
  expect(diagnostics).toEqual([]);
});

it.each([identifier(), identifier('Missing', { documentation: 'missing' })])(
  'allows unresolved $label identifiers alongside entity references',
  (alternative) => {
    expect(
      bind(
        'policy P {\n target = Missing\n @@refs(Missing, targets: [Missing])\n}\nmodel M {\n @@refs(Missing, targets: [Missing])\n}',
        oneOf(reference, alternative),
      ).diagnostics,
    ).toEqual([]);
  },
);

it.each([
  { rule: optional(list(oneOf(reference, identifier()))), count: 0 },
  { rule: optional(list(oneOf(reference, bool()))), count: 0 },
])('matches alternatives through optional lists ($count diagnostics)', ({ rule, count }) => {
  const { diagnostics } = bind(
    'policy P {\n target = [Missing]\n @@refs([Missing])\n}\nmodel M {\n @@refs([Missing])\n}',
    rule,
  );
  expect(diagnostics.map(({ code, message }) => ({ code, message }))).toEqual(
    Array.from({ length: count }, () => ({
      code: 'PSL_UNRESOLVED_REFERENCE',
      message: 'Cannot find entity "Missing"',
    })),
  );
});

it('accepts JSON null after a failed reference alternative', () => {
  const { diagnostics } = bind(
    'policy P {\n target = null\n @@refs(null, targets: [null])\n}\nmodel M {\n @@refs(null, targets: [null])\n}',
    oneOf(reference, jsonValue()),
  );
  expect(diagnostics).toEqual([]);
});

it('interprets raw-name fallback without a committed entity reference', () => {
  const rule = oneOf(entityRef({ kind: 'block', keyword: 'role' }), identifier());
  const result = bind('policy P {\n target = External\n}', rule);
  const expression = [...result.symbolTable.topLevel.blocks['P']!.node.entries()][0]!.value()!;
  expect(result.diagnostics).toEqual([]);
  expect(result.binder.symbolForNode(expression.syntax)).toBeUndefined();
  const parsed = rule.parse(expression, {
    sources: result.sources,
    symbols: result.symbolTable,
    binder: result.binder,
  });
  expect(parsed.ok).toBe(true);
  if (parsed.ok) expect(parsed.value).toEqual('External');
});

it('discards failed container bindings before selecting a raw-name list', () => {
  const rule = oneOf(list(reference), list(identifier()));
  const result = bind('policy P {\n target = [Known, Missing]\n}\nmodel Known {}', rule);
  const expression = [...result.symbolTable.topLevel.blocks['P']!.node.entries()][0]!.value()!;
  expect(result.diagnostics).toEqual([]);
  expect(
    [...ArrayLiteralAst.cast(expression.syntax)!.elements()].map((element) =>
      result.binder.symbolForNode(element.syntax),
    ),
  ).toEqual([undefined, undefined]);
  const parsed = rule.parse(expression, {
    sources: result.sources,
    symbols: result.symbolTable,
    binder: result.binder,
  });
  expect(parsed.ok).toBe(true);
  if (parsed.ok) expect(parsed.value).toEqual(['Known', 'Missing']);
});

it('binds nested records and lists independently for each element', () => {
  const rule = record(list(oneOf(reference, identifier())));
  const result = bind(
    'policy P {\n target = { values: [Known, External] }\n}\nmodel Known {}',
    rule,
  );
  const expression = [...result.symbolTable.topLevel.blocks['P']!.node.entries()][0]!.value()!;
  expect(result.diagnostics).toEqual([]);
  const parsed = rule.parse(expression, {
    sources: result.sources,
    symbols: result.symbolTable,
    binder: result.binder,
  });
  expect(parsed.ok).toBe(true);
  if (parsed.ok)
    expect(parsed.value).toEqual({
      values: [
        { declaration: result.symbolTable.topLevel.models['Known'], namespace: undefined },
        'External',
      ],
    });
});

it('selects a matching block keyword after a mismatched entity selector', () => {
  const rule = oneOf(reference, entityRef({ kind: 'block', keyword: 'policy' }));
  const result = bind('policy P {\n target = P\n}', rule);
  const expression = [...result.symbolTable.topLevel.blocks['P']!.node.entries()][0]!.value()!;
  expect(result.binder.symbolForNode(expression.syntax)).toEqual({
    kind: 'block',
    symbol: result.symbolTable.topLevel.blocks['P'],
  });
  expect(
    rule.parse(expression, {
      sources: result.sources,
      symbols: result.symbolTable,
      binder: result.binder,
    }).ok,
  ).toBe(true);
});

it.each([
  { rule: oneOf(list(reference), list(num(2))), value: '[Missing]' },
  { rule: oneOf(list(reference), list(int({ min: 1 }))), value: '[Missing]' },
  {
    rule: oneOf(record(reference), record(identifier('Other', { documentation: 'other' }))),
    value: '{ nested: Missing }',
  },
])('ignores scalar constraints in container alternatives for $value', ({ rule, value }) => {
  const result = bind(
    `policy P {\n target = ${value}\n @@refs(${value})\n}\nmodel M {\n @@refs(${value})\n}`,
    rule,
  );
  expect(result.diagnostics).toEqual([]);
});

it('binds symbols without checking entity selectors', () => {
  const rule = oneOf(reference, entityRef({ kind: 'block', keyword: 'role' }));
  const result = bind('policy P {\n target = P\n}', rule);
  const expression = [...result.symbolTable.topLevel.blocks['P']!.node.entries()][0]!.value()!;
  expect(result.diagnostics).toEqual([]);
  expect(result.binder.symbolForNode(expression.syntax)).toEqual({
    kind: 'block',
    symbol: result.symbolTable.topLevel.blocks['P'],
  });
  const parsed = rule.parse(expression, {
    sources: result.sources,
    symbols: result.symbolTable,
    binder: result.binder,
  });
  expect(parsed.ok).toBe(false);
  if (!parsed.ok)
    expect(parsed.failure.map(({ message }) => message)).toEqual([
      'Expected one of: model reference | role reference',
    ]);
});

it('leaves list constraints to interpretation', () => {
  const rule = oneOf(list(reference, { unique: true }), list(identifier()));
  const result = bind('policy P {\n target = [Known, Known]\n}\nmodel Known {}', rule);
  const expression = [...result.symbolTable.topLevel.blocks['P']!.node.entries()][0]!.value()!;
  expect(result.diagnostics).toEqual([]);
  expect(
    [...ArrayLiteralAst.cast(expression.syntax)!.elements()].map((element) =>
      result.binder.symbolForNode(element.syntax),
    ),
  ).toEqual(
    Array.from({ length: 2 }, () => ({
      kind: 'model',
      symbol: result.symbolTable.topLevel.models['Known'],
    })),
  );
  const parsed = rule.parse(expression, {
    sources: result.sources,
    symbols: result.symbolTable,
    binder: result.binder,
  });
  expect(parsed.ok).toBe(true);
  if (parsed.ok) expect(parsed.value).toEqual(['Known', 'Known']);
});

it('resolves a field after an entity lookup fails', () => {
  const { document, sources } = parse('model M {\n value M @pick(value)\n}', 'binder.psl');
  const { symbolTable } = buildSymbolTable({ documents: [document], sources });
  const rule = oneOf(entityRef({ kind: 'block', keyword: 'role' }), fieldRef());
  const result = createBinder({
    sources,
    symbolTable,
    context: binderContext({
      attributeSpecs: {
        model: {},
        field: {
          pick: () =>
            fieldAttribute('pick', {
              documentation: 'pick',
              positional: [{ key: 'value', type: rule, documentation: 'value' }],
            }),
        },
      },
    }),
  });
  const selfModel = symbolTable.topLevel.models['M']!;
  const field = selfModel.fields['value']!;
  const expression = [...[...field.node.attributes()][0]!.argList()!.args()][0]!.value()!;
  expect(result.diagnostics).toEqual([]);
  expect(result.binder.symbolForNode(expression.syntax)).toEqual({ kind: 'field', symbol: field });
  const parsed = rule.parse(expression, {
    sources,
    symbols: symbolTable,
    binder: result.binder,
    selfModel,
  });
  expect(parsed.ok).toBe(true);
  if (parsed.ok) expect(parsed.value).toEqual('value');
});

it.each(['Known', 'External'])('binds positional and named function arguments for %s', (name) => {
  const target = oneOf(reference, identifier());
  const rule = funcCall('choose', {
    documentation: '',
    positional: [{ key: 'target', type: target, documentation: '' }],
    named: { other: { type: target, documentation: '' } },
  });
  const result = bind(
    `policy P {\n target = choose(${name}, other: ${name})\n @@refs(choose(${name}, other: ${name}))\n}\nmodel Known {\n @@refs(choose(${name}, other: ${name}))\n}`,
    rule,
  );
  const expression = [...result.symbolTable.topLevel.blocks['P']!.node.entries()][0]!.value()!;
  const value =
    name === 'Known'
      ? { declaration: result.symbolTable.topLevel.models['Known'], namespace: undefined }
      : name;
  expect(result.diagnostics).toEqual([]);
  expect(
    [...FunctionCallAst.cast(expression.syntax)!.args()].map((arg) =>
      result.binder.symbolForNode(arg.value()!.syntax),
    ),
  ).toEqual(
    name === 'Known'
      ? Array.from({ length: 2 }, () => ({
          kind: 'model',
          symbol: result.symbolTable.topLevel.models['Known'],
        }))
      : [undefined, undefined],
  );
  const parsed = rule.parse(expression, {
    sources: result.sources,
    symbols: result.symbolTable,
    binder: result.binder,
  });
  expect(parsed.ok).toBe(true);
  if (parsed.ok) expect(parsed.value.args).toEqual({ target: value, other: value });
});

it('reports strict unresolved positional and named function arguments', () => {
  const rule = funcCall('choose', {
    documentation: '',
    positional: [{ key: 'target', type: reference, documentation: '' }],
    named: { other: { type: reference, documentation: '' } },
  });
  const result = bind('policy P {\n target = choose(Missing, other: Missing)\n}', rule);
  expect(result.diagnostics.map(({ message }) => message)).toEqual([
    'Cannot find entity "Missing"',
    'Cannot find entity "Missing"',
  ]);
  const expression = [...result.symbolTable.topLevel.blocks['P']!.node.entries()][0]!.value()!;
  const parsed = rule.parse(expression, {
    sources: result.sources,
    symbols: result.symbolTable,
    binder: result.binder,
  });
  expect(parsed.ok).toBe(false);
});

it('discards diagnostics and references from a failed function alternative', () => {
  const rule = oneOf(
    funcCall('choose', {
      documentation: '',
      positional: [{ key: 'target', type: reference, documentation: '' }],
      named: { other: { type: reference, documentation: '' } },
    }),
    funcCall('choose', {
      documentation: '',
      positional: [{ key: 'target', type: identifier(), documentation: '' }],
      named: { other: { type: identifier(), documentation: '' } },
    }),
  );
  const result = bind(
    'policy P {\n target = choose(Known, other: Missing)\n}\nmodel Known {}',
    rule,
  );
  const expression = [...result.symbolTable.topLevel.blocks['P']!.node.entries()][0]!.value()!;
  expect(result.diagnostics).toEqual([]);
  expect(
    [...FunctionCallAst.cast(expression.syntax)!.args()].map((arg) =>
      result.binder.symbolForNode(arg.value()!.syntax),
    ),
  ).toEqual([undefined, undefined]);
  const parsed = rule.parse(expression, {
    sources: result.sources,
    symbols: result.symbolTable,
    binder: result.binder,
  });
  expect(parsed.ok).toBe(true);
  if (parsed.ok) expect(parsed.value.args).toEqual({ target: 'Known', other: 'Missing' });
});

it.each(['other', 'ns.choose'])(
  'does not bind arguments for a mismatched function name %s',
  (name) => {
    const rule = funcCall('choose', {
      documentation: '',
      positional: [{ key: 'target', type: reference, documentation: '' }],
    });
    const result = bind(`policy P {\n target = ${name}(Missing)\n}`, rule);
    const expression = [...result.symbolTable.topLevel.blocks['P']!.node.entries()][0]!.value()!;
    expect(result.diagnostics).toEqual([]);
    expect(
      [...FunctionCallAst.cast(expression.syntax)!.args()].map((arg) =>
        result.binder.symbolForNode(arg.value()!.syntax),
      ),
    ).toEqual([undefined]);
  },
);

it.each([list(reference), record(reference), funcCall('choose', { documentation: '' })])(
  'tries scalar reference binding after an untraversable $kind',
  (container) => {
    const rule = oneOf(container, reference);
    const result = bind('policy P {\n target = Known\n}\nmodel Known {}', rule);
    const expression = [...result.symbolTable.topLevel.blocks['P']!.node.entries()][0]!.value()!;
    expect(result.diagnostics).toEqual([]);
    expect(result.binder.symbolForNode(expression.syntax)).toEqual({
      kind: 'model',
      symbol: result.symbolTable.topLevel.models['Known'],
    });
    expect(
      rule.parse(expression, {
        sources: result.sources,
        symbols: result.symbolTable,
        binder: result.binder,
      }).ok,
    ).toBe(true);
  },
);

it.each(['other', 'choose'])(
  'tries the next function signature after an untraversable %s signature',
  (name) => {
    const rule = oneOf(
      funcCall(name, { documentation: '' }),
      funcCall('choose', {
        documentation: '',
        positional: [{ key: 'target', type: reference, documentation: '' }],
      }),
    );
    const result = bind('policy P {\n target = choose(Known)\n}\nmodel Known {}', rule);
    const expression = [...result.symbolTable.topLevel.blocks['P']!.node.entries()][0]!.value()!;
    const argument = [...FunctionCallAst.cast(expression.syntax)!.args()][0]!.value()!;
    expect(result.diagnostics).toEqual([]);
    expect(result.binder.symbolForNode(argument.syntax)).toEqual({
      kind: 'model',
      symbol: result.symbolTable.topLevel.models['Known'],
    });
  },
);

it('never invokes spec parsers during binding', () => {
  const rule = {
    ...identifier(),
    parse: () => {
      throw new Error('binding invoked interpretation');
    },
  };
  const result = bind('policy P {\n target = Missing\n}', oneOf(reference, rule));
  const expression = [...result.symbolTable.topLevel.blocks['P']!.node.entries()][0]!.value()!;
  expect(result.diagnostics).toEqual([]);
  expect(result.binder.symbolForNode(expression.syntax)).toBeUndefined();
});

it('does not treat recursive JSON metadata as references', () => {
  expect(
    bind('policy P {\n target = [null, { value: true }]\n @@refs(null)\n}', jsonValue())
      .diagnostics,
  ).toEqual([]);
});
