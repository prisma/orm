import { describe, expect, it } from 'vitest';
import { blockAttribute } from '../src/attribute-spec/block-attribute';
import { bool } from '../src/attribute-spec/combinators/bool';
import { entityRef } from '../src/attribute-spec/combinators/entity-ref';
import { identifier } from '../src/attribute-spec/combinators/identifier';
import { jsonValue } from '../src/attribute-spec/combinators/json-value';
import { list } from '../src/attribute-spec/combinators/list';
import { oneOf } from '../src/attribute-spec/combinators/one-of';
import { str } from '../src/attribute-spec/combinators/str';
import { optional } from '../src/attribute-spec/optional';
import { entriesBlock, fixedBlock } from '../src/block-spec/binders';
import type { PslBlockSpecDescriptor } from '../src/block-spec/descriptor';
import { interpretExtensionBlock } from '../src/block-spec/interpret';
import type { BlockSpec, BlockSpecContext } from '../src/block-spec/types';
import { parse } from '../src/parse';
import type { BlockSymbol } from '../src/symbol-table';
import { buildSymbolTable } from '../src/symbol-table';
import { ownEntry, supportBinder } from './support';

function policySpec() {
  return fixedBlock({
    parameters: {
      target: { type: entityRef({ kind: 'model' }), documentation: 'The protected model.' },
      using: { type: str(), documentation: 'The row predicate.' },
      permissive: {
        type: optional(bool(), true),
        documentation: 'Whether the policy is permissive.',
      },
      check: { type: optional(str()), documentation: 'The write predicate.' },
      roles: {
        type: optional(list(oneOf(entityRef({ kind: 'block', keyword: 'role' }), identifier()))),
        documentation: 'Database roles, declared roles preferred over unchecked names.',
      },
    },
  });
}

const POLICY_DESCRIPTOR = {
  kind: 'pslBlock',
  keyword: 'policy_select',
  discriminator: 'fixture-policy',
  name: { required: true },
  spec: policySpec,
} satisfies PslBlockSpecDescriptor;

const NATIVE_ENUM_DESCRIPTOR = {
  kind: 'pslBlock',
  keyword: 'native_enum',
  discriminator: 'fixture-native-enum',
  name: { required: true },
  spec: () => entriesBlock({ value: { type: str(), documentation: 'The explicit member value.' } }),
} satisfies PslBlockSpecDescriptor;

const FAMILY_ENUM_DESCRIPTOR = {
  kind: 'pslBlock',
  keyword: 'enum',
  discriminator: 'fixture-enum',
  name: { required: true },
  spec: () =>
    entriesBlock({
      value: { type: jsonValue(), documentation: 'The explicit member value.' },
      allowBare: true,
    }),
} satisfies PslBlockSpecDescriptor;

function setup(source: string) {
  const { document, sources } = parse(source, 'test.psl');
  const { symbolTable, diagnostics } = buildSymbolTable({
    documents: [document],
    sources,
  });
  return { symbolTable, sources, diagnostics };
}

function blockNamed(
  setupResult: ReturnType<typeof setup>,
  name: string,
  namespace?: string,
): BlockSymbol {
  const scope =
    namespace === undefined
      ? setupResult.symbolTable.topLevel
      : setupResult.symbolTable.topLevel.namespaces[namespace];
  const block = scope?.blocks[name];
  if (block === undefined) throw new Error(`expected block "${name}" in the symbol table`);
  return block;
}

function interpret<S extends BlockSpec<unknown>>(
  setupResult: ReturnType<typeof setup>,
  block: BlockSymbol,
  descriptor: PslBlockSpecDescriptor,
  spec: S,
) {
  return interpretExtensionBlock({
    block,
    descriptor,
    spec,
    symbols: setupResult.symbolTable,
    sources: setupResult.sources,
    binder: supportBinder({
      sources: setupResult.sources,
      symbolTable: setupResult.symbolTable,
      pslBlockDescriptors: { [descriptor.keyword]: descriptor },
    }),
  });
}

describe('interpretExtensionBlock — fixed blocks', () => {
  it('binds required, optional, and defaulted properties into a typed envelope', () => {
    const result = setup(
      [
        'model Post {',
        '  id Int',
        '}',
        'policy_select ReadPosts {',
        '  target = Post',
        '  using  = "user_id = current_user()"',
        '}',
      ].join('\n'),
    );
    const block = blockNamed(result, 'ReadPosts');

    const parsed = interpret(result, block, POLICY_DESCRIPTOR, policySpec());

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.kind).toBe('fixture-policy');
    expect(parsed.value.keyword).toBe('policy_select');
    expect(parsed.value.name).toBe('ReadPosts');
    expect(parsed.value.values.using).toBe('user_id = current_user()');
    expect(parsed.value.values.permissive).toBe(true);
    expect(parsed.value.values.check).toBeUndefined();
    expect(Object.hasOwn(parsed.value.values, 'check')).toBe(false);
    expect(parsed.value.values.target.declaration.name).toBe('Post');
    expect(parsed.value.span).toEqual(block.span);
  });

  it('resolves a forward reference: the policy is declared before its target model', () => {
    const result = setup(
      [
        'policy_select ReadPosts {',
        '  target = Post',
        '  using  = "true"',
        '}',
        'model Post {',
        '  id Int',
        '}',
      ].join('\n'),
    );

    const parsed = interpret(
      result,
      blockNamed(result, 'ReadPosts'),
      POLICY_DESCRIPTOR,
      policySpec(),
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.values.target.declaration).toBe(result.symbolTable.topLevel.models['Post']);
  });

  it('prefers the local namespace declaration over a same-named top-level model', () => {
    const result = setup(
      [
        'model Article {',
        '  id Int',
        '}',
        'namespace blog {',
        '  model Article {',
        '    id Int',
        '  }',
        '  policy_select ReadArticles {',
        '    target = Article',
        '    using  = "true"',
        '  }',
        '}',
      ].join('\n'),
    );

    const parsed = interpret(
      result,
      blockNamed(result, 'ReadArticles', 'blog'),
      POLICY_DESCRIPTOR,
      policySpec(),
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.values.target.declaration).toBe(
      result.symbolTable.topLevel.namespaces['blog']?.models['Article'],
    );
  });

  it('prefers a declared role reference and falls back to an unchecked identifier without leaking diagnostics', () => {
    const result = setup(
      [
        'model Post {',
        '  id Int',
        '}',
        'role reporting {',
        '}',
        'policy_select ReadPosts {',
        '  target = Post',
        '  using  = "true"',
        '  roles  = [reporting, external_role]',
        '}',
      ].join('\n'),
    );

    const parsed = interpret(
      result,
      blockNamed(result, 'ReadPosts'),
      POLICY_DESCRIPTOR,
      policySpec(),
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const roles = parsed.value.values.roles;
    expect(roles).toHaveLength(2);
    expect(roles?.[0]).toMatchObject({
      declaration: result.symbolTable.topLevel.blocks['reporting'],
    });
    expect(roles?.[1]).toBe('external_role');
  });

  it('rejects an unknown fixed key at the entry span', () => {
    const result = setup(
      [
        'model Post {',
        '  id Int',
        '}',
        'policy_select ReadPosts {',
        '  target  = Post',
        '  using   = "true"',
        '  sneaky  = "no"',
        '}',
      ].join('\n'),
    );

    const parsed = interpret(
      result,
      blockNamed(result, 'ReadPosts'),
      POLICY_DESCRIPTOR,
      policySpec(),
    );

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.failure).toEqual([
      expect.objectContaining({
        code: 'PSL_EXTENSION_UNKNOWN_PARAMETER',
        message:
          'Unknown parameter "sneaky" in "policy_select" block "ReadPosts". The block does not declare this parameter.',
        filename: 'test.psl',
        range: expect.objectContaining({ start: { line: 6, character: 2 } }),
      }),
    ]);
  });

  it('rejects a duplicate key at the later entry span, first occurrence wins', () => {
    const result = setup(
      [
        'model Post {',
        '  id Int',
        '}',
        'policy_select ReadPosts {',
        '  target = Post',
        '  using  = "first"',
        '  using  = "second"',
        '}',
      ].join('\n'),
    );

    const parsed = interpret(
      result,
      blockNamed(result, 'ReadPosts'),
      POLICY_DESCRIPTOR,
      policySpec(),
    );

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.failure).toEqual([
      expect.objectContaining({
        code: 'PSL_EXTENSION_DUPLICATE_PARAMETER',
        range: expect.objectContaining({ start: { line: 6, character: 2 } }),
      }),
    ]);
  });

  it('rejects a missing required key at the block span', () => {
    const result = setup(
      ['model Post {', '  id Int', '}', 'policy_select ReadPosts {', '  target = Post', '}'].join(
        '\n',
      ),
    );
    const block = blockNamed(result, 'ReadPosts');

    const parsed = interpret(result, block, POLICY_DESCRIPTOR, policySpec());

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.failure).toEqual([
      expect.objectContaining({
        code: 'PSL_EXTENSION_MISSING_REQUIRED_PARAMETER',
        message: 'Required parameter "using" is missing from "policy_select" block "ReadPosts".',
        range: expect.objectContaining({ start: { line: 3, character: 0 } }),
      }),
    ]);
  });

  it('rejects a bare occurrence of a declared fixed key', () => {
    const result = setup(
      [
        'model Post {',
        '  id Int',
        '}',
        'policy_select ReadPosts {',
        '  target = Post',
        '  using',
        '}',
      ].join('\n'),
    );

    const parsed = interpret(
      result,
      blockNamed(result, 'ReadPosts'),
      POLICY_DESCRIPTOR,
      policySpec(),
    );

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.failure).toEqual([
      expect.objectContaining({
        code: 'PSL_INVALID_EXTENSION_BLOCK_MEMBER',
        message:
          'Parameter "using" in "policy_select" block "ReadPosts" must be written as "using = <value>".',
      }),
    ]);
  });

  it('anchors an expression failure on the expression span', () => {
    const result = setup(
      [
        'model Post {',
        '  id Int',
        '}',
        'policy_select ReadPosts {',
        '  target = Post',
        '  using  = 42',
        '}',
      ].join('\n'),
    );

    const parsed = interpret(
      result,
      blockNamed(result, 'ReadPosts'),
      POLICY_DESCRIPTOR,
      policySpec(),
    );

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.failure).toEqual([
      expect.objectContaining({
        code: 'PSL_INVALID_ATTRIBUTE_SYNTAX',
        message: 'Expected a string literal',
        range: {
          start: { line: 5, character: 11 },
          end: { line: 5, character: 13 },
        },
      }),
    ]);
  });

  it('rejects a wrong-kind reference through the rule diagnostic', () => {
    const result = setup(
      [
        'role reporting {',
        '}',
        'policy_select ReadPosts {',
        '  target = reporting',
        '  using  = "true"',
        '}',
      ].join('\n'),
    );

    const parsed = interpret(
      result,
      blockNamed(result, 'ReadPosts'),
      POLICY_DESCRIPTOR,
      policySpec(),
    );

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.failure).toEqual([
      expect.objectContaining({
        message: 'Expected model reference "reporting", found role',
      }),
    ]);
  });

  it('records an entry span per bound key', () => {
    const result = setup(
      [
        'model Post {',
        '  id Int',
        '}',
        'policy_select ReadPosts {',
        '  target = Post',
        '  using  = "true"',
        '}',
      ].join('\n'),
    );

    const parsed = interpret(
      result,
      blockNamed(result, 'ReadPosts'),
      POLICY_DESCRIPTOR,
      policySpec(),
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(Object.keys(parsed.value.parameterSpans)).toEqual(['target', 'using']);
    expect(parsed.value.parameterSpans['target']?.start.line).toBe(5);
    expect(parsed.value.parameterSpans['using']?.start.line).toBe(6);
  });
});

describe('interpretExtensionBlock — arbitrary-key entries blocks', () => {
  it('applies the shared value rule to every key', () => {
    const result = setup(
      ['native_enum Level {', '  Low  = "low"', '  High = "high"', '}'].join('\n'),
    );
    const block = blockNamed(result, 'Level');

    const parsed = interpret(
      result,
      block,
      NATIVE_ENUM_DESCRIPTOR,
      entriesBlock({ value: { type: str(), documentation: 'The explicit member value.' } }),
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.values).toEqual({ Low: 'low', High: 'high' });
    expect(Object.keys(parsed.value.parameterSpans)).toEqual(['Low', 'High']);
  });

  it('rejects a bare member when the spec does not allow bare entries', () => {
    const result = setup(['native_enum Level {', '  Low', '}'].join('\n'));

    const parsed = interpret(
      result,
      blockNamed(result, 'Level'),
      NATIVE_ENUM_DESCRIPTOR,
      entriesBlock({ value: { type: str(), documentation: 'The explicit member value.' } }),
    );

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.failure).toEqual([
      expect.objectContaining({
        code: 'PSL_INVALID_EXTENSION_BLOCK_MEMBER',
        message:
          'Parameter "Low" in "native_enum" block "Level" must be written as "Low = <value>".',
      }),
    ]);
  });

  it('keeps a bare member as a present key with an undefined value, distinct from explicit null', () => {
    const result = setup(['enum Mood {', '  Happy', '  Empty = null', '}'].join('\n'));

    const parsed = interpret(
      result,
      blockNamed(result, 'Mood'),
      FAMILY_ENUM_DESCRIPTOR,
      entriesBlock({
        value: { type: jsonValue(), documentation: 'The explicit member value.' },
        allowBare: true,
      }),
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(Object.hasOwn(parsed.value.values, 'Happy')).toBe(true);
    expect(parsed.value.values['Happy']).toBeUndefined();
    expect(parsed.value.values['Empty']).toBeNull();
    expect(parsed.value.parameterSpans['Happy']?.start.line).toBe(2);
  });

  it('rejects duplicate arbitrary keys, first occurrence wins', () => {
    const result = setup(['enum Mood {', '  Happy', '  Happy = "again"', '}'].join('\n'));

    const parsed = interpret(
      result,
      blockNamed(result, 'Mood'),
      FAMILY_ENUM_DESCRIPTOR,
      entriesBlock({
        value: { type: jsonValue(), documentation: 'The explicit member value.' },
        allowBare: true,
      }),
    );

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.failure).toEqual([
      expect.objectContaining({ code: 'PSL_EXTENSION_DUPLICATE_PARAMETER' }),
    ]);
  });
});

describe('interpretExtensionBlock — prototype-named keys stay own entries', () => {
  const PROTO_FIXED_DESCRIPTOR = {
    kind: 'pslBlock',
    keyword: 'guard',
    discriminator: 'fixture-guard',
    name: { required: true },
    spec: protoFixedSpec,
  } satisfies PslBlockSpecDescriptor;

  function protoFixedSpec() {
    return fixedBlock({
      parameters: {
        ['__proto__']: { type: str(), documentation: 'A hostile key name.' },
        constructor: { type: str(), documentation: 'Another hostile key name.' },
        toString: { type: str(), documentation: 'A shadowing key name.' },
      },
    });
  }

  it('binds fixed __proto__/constructor/toString keys as own values with spans', () => {
    const result = setup(
      [
        'guard Hostile {',
        '  __proto__   = "evil"',
        '  constructor = "c"',
        '  toString    = "t"',
        '}',
      ].join('\n'),
    );

    const parsed = interpret(
      result,
      blockNamed(result, 'Hostile'),
      PROTO_FIXED_DESCRIPTOR,
      protoFixedSpec(),
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const values: Record<string, unknown> = parsed.value.values;
    expect(Object.getPrototypeOf(values)).toBeNull();
    expect(Object.hasOwn(values, '__proto__')).toBe(true);
    expect(ownEntry(values, '__proto__')).toBe('evil');
    expect(values['constructor']).toBe('c');
    expect(values['toString']).toBe('t');
    expect(Object.keys(values).sort()).toEqual(['__proto__', 'constructor', 'toString']);
    expect(Object.getPrototypeOf(parsed.value.parameterSpans)).toBeNull();
    expect(Object.hasOwn(parsed.value.parameterSpans, '__proto__')).toBe(true);
    expect(ownEntry(parsed.value.parameterSpans, '__proto__')).toMatchObject({
      start: { line: 2 },
    });
    expect(parsed.value.parameterSpans['toString']?.start.line).toBe(4);
  });

  it('binds explicit and bare prototype-named entries in an entries block', () => {
    const result = setup(
      ['enum Mood {', '  __proto__ = "evil"', '  constructor = "c"', '  toString', '}'].join('\n'),
    );

    const parsed = interpret(
      result,
      blockNamed(result, 'Mood'),
      FAMILY_ENUM_DESCRIPTOR,
      entriesBlock({
        value: { type: jsonValue(), documentation: 'The explicit member value.' },
        allowBare: true,
      }),
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const values: Record<string, unknown> = parsed.value.values;
    expect(Object.getPrototypeOf(values)).toBeNull();
    expect(Object.hasOwn(values, '__proto__')).toBe(true);
    expect(ownEntry(values, '__proto__')).toBe('evil');
    expect(values['constructor']).toBe('c');
    expect(Object.hasOwn(values, 'toString')).toBe(true);
    expect(values['toString']).toBeUndefined();
    expect(Object.keys(values)).toEqual(['__proto__', 'constructor', 'toString']);
  });

  it('keeps a bare __proto__ member as the bare sentinel', () => {
    const result = setup(['enum Mood {', '  __proto__', '}'].join('\n'));

    const parsed = interpret(
      result,
      blockNamed(result, 'Mood'),
      FAMILY_ENUM_DESCRIPTOR,
      entriesBlock({
        value: { type: jsonValue(), documentation: 'The explicit member value.' },
        allowBare: true,
      }),
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(Object.hasOwn(parsed.value.values, '__proto__')).toBe(true);
    expect(ownEntry(parsed.value.values, '__proto__')).toBeUndefined();
    expect(Object.hasOwn(parsed.value.parameterSpans, '__proto__')).toBe(true);
  });
});

describe('interpretExtensionBlock — block attributes', () => {
  const mapAttribute = blockAttribute('map', {
    documentation: 'Maps the block to its storage name.',
    positional: [{ key: 'name', type: str(), documentation: 'The storage name.' }],
  });

  it('interprets declared attributes into the envelope with the block factory context', () => {
    const seenContexts: BlockSpecContext[] = [];
    const descriptor = {
      ...NATIVE_ENUM_DESCRIPTOR,
      attributes: {
        map: (ctx: BlockSpecContext) => {
          seenContexts.push(ctx);
          return mapAttribute;
        },
      },
    } satisfies PslBlockSpecDescriptor;
    const result = setup(
      ['native_enum Level {', '  Low = "low"', '  @@map("levels")', '}'].join('\n'),
    );
    const block = blockNamed(result, 'Level');

    const parsed = interpret(
      result,
      block,
      descriptor,
      entriesBlock({ value: { type: str(), documentation: 'The explicit member value.' } }),
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.attributes['map']).toMatchObject({ args: { name: 'levels' } });
    expect(seenContexts.at(-1)?.block).toBe(block);
    expect(seenContexts.at(-1)?.symbols).toBe(result.symbolTable);
  });

  it('fails the block for an attribute the descriptor does not declare', () => {
    const result = setup(
      ['native_enum Level {', '  Low = "low"', '  @@schema("x")', '}'].join('\n'),
    );

    const parsed = interpret(
      result,
      blockNamed(result, 'Level'),
      NATIVE_ENUM_DESCRIPTOR,
      entriesBlock({ value: { type: str(), documentation: 'The explicit member value.' } }),
    );

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.failure).toEqual([
      expect.objectContaining({
        code: 'PSL_EXTENSION_UNKNOWN_BLOCK_ATTRIBUTE',
        message: 'Unknown attribute "@@schema" in "native_enum" block "Level"',
      }),
    ]);
  });
});
