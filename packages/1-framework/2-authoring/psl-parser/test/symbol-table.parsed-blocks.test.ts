import type { AuthoringPslBlockDescriptorNamespace } from '@internal/framework-components/authoring';
import { describe, expect, it } from 'vitest';
import { blockAttribute } from '../src/attribute-spec/block-attribute';
import { entityRef } from '../src/attribute-spec/combinators/entity-ref';
import { identifier } from '../src/attribute-spec/combinators/identifier';
import { jsonValue } from '../src/attribute-spec/combinators/json-value';
import { list } from '../src/attribute-spec/combinators/list';
import { oneOf } from '../src/attribute-spec/combinators/one-of';
import { str } from '../src/attribute-spec/combinators/str';
import { optional } from '../src/attribute-spec/optional';
import { entriesBlock, fixedBlock } from '../src/block-spec/binders';
import type { PslBlockSpecDescriptor } from '../src/block-spec/descriptor';
import { parse } from '../src/parse';
import type { BlockSymbol, ModelSymbol } from '../src/symbol-table';
import { buildSymbolTable } from '../src/symbol-table';
import { ownEntry } from './support';

const POLICY_DESCRIPTOR = {
  kind: 'pslBlock',
  keyword: 'policy_select',
  discriminator: 'fixture-policy',
  name: { required: true },
  spec: () =>
    fixedBlock({
      parameters: {
        target: { type: entityRef({ kind: 'model' }), documentation: 'The protected model.' },
        using: { type: str(), documentation: 'The row predicate.' },
        roles: {
          type: optional(list(oneOf(entityRef({ kind: 'block', keyword: 'role' }), identifier()))),
          documentation: 'Database roles.',
        },
      },
    }),
} satisfies PslBlockSpecDescriptor;

const ROLE_DESCRIPTOR = {
  kind: 'pslBlock',
  keyword: 'role',
  discriminator: 'fixture-role',
  name: { required: true },
  spec: () => fixedBlock({ parameters: {} }),
} satisfies PslBlockSpecDescriptor;

const ENUM_DESCRIPTOR = {
  kind: 'pslBlock',
  keyword: 'enum',
  discriminator: 'fixture-enum',
  name: { required: true },
  spec: () =>
    entriesBlock({
      value: { type: jsonValue(), documentation: 'The explicit member value.' },
      allowBare: true,
    }),
  attributes: {
    map: () =>
      blockAttribute('map', {
        documentation: 'Maps the enum to its storage name.',
        positional: [{ key: 'name', type: str(), documentation: 'The storage name.' }],
      }),
    describes: () =>
      blockAttribute('describes', {
        documentation: 'Names the model this enum documents.',
        positional: [
          { key: 'model', type: entityRef({ kind: 'model' }), documentation: 'The model.' },
        ],
      }),
  },
} satisfies PslBlockSpecDescriptor;

const DESCRIPTORS: AuthoringPslBlockDescriptorNamespace = {
  policy_select: POLICY_DESCRIPTOR,
  role: ROLE_DESCRIPTOR,
  enum: ENUM_DESCRIPTOR,
};

function build(source: string) {
  const { document, sources } = parse(source, 'test.psl');
  return buildSymbolTable({ documents: [document], sources, pslBlockDescriptors: DESCRIPTORS });
}

function blockNamed(
  result: ReturnType<typeof build>,
  name: string,
  namespace?: string,
): BlockSymbol {
  const scope =
    namespace === undefined
      ? result.symbolTable.topLevel
      : result.symbolTable.topLevel.namespaces[namespace];
  const block = scope?.blocks[name];
  if (block === undefined) throw new Error(`expected block "${name}" in the symbol table`);
  return block;
}

function modelNamed(
  result: ReturnType<typeof build>,
  name: string,
  namespace?: string,
): ModelSymbol {
  const scope =
    namespace === undefined
      ? result.symbolTable.topLevel
      : result.symbolTable.topLevel.namespaces[namespace];
  const model = scope?.models[name];
  if (model === undefined) throw new Error(`expected model "${name}" in the symbol table`);
  return model;
}

describe('buildSymbolTable() — parsedBlocks lifecycle', () => {
  it('publishes typed envelopes for registered valid blocks, keyed by symbol identity', () => {
    const result = build(
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
    const block = blockNamed(result, 'ReadPosts');

    expect(result.diagnostics).toEqual([]);
    const envelope = result.parsedBlocks.get(block);
    expect(envelope).toBeDefined();
    if (envelope === undefined) return;
    expect(envelope.kind).toBe('fixture-policy');
    expect(envelope.keyword).toBe('policy_select');
    expect(envelope.name).toBe('ReadPosts');
    expect(envelope.values['using']).toBe('true');
    expect(envelope.values['target']).toMatchObject({
      declaration: modelNamed(result, 'Post'),
    });
    expect(envelope.parameterSpans['using']?.start.line).toBe(6);
    expect(envelope.span).toEqual(block.span);
  });

  it('interprets declared block attributes with the complete table', () => {
    const result = build(
      [
        'enum Level {',
        '  Low = 1',
        '  @@map("levels")',
        '  @@describes(Report)',
        '}',
        'model Report {',
        '  id Int',
        '}',
      ].join('\n'),
    );

    expect(result.diagnostics).toEqual([]);
    const envelope = result.parsedBlocks.get(blockNamed(result, 'Level'));
    expect(envelope?.attributes['map']).toMatchObject({ args: { name: 'levels' } });
    expect(envelope?.attributes['describes']?.args).toMatchObject({
      model: { declaration: modelNamed(result, 'Report') },
    });
  });

  it('publishes no envelope for a block whose value interpretation fails', () => {
    const result = build(
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
    const block = blockNamed(result, 'ReadPosts');

    expect(result.parsedBlocks.has(block)).toBe(false);
    expect(block.block.parameters['using']?.expression).toBe('42');
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'PSL_INVALID_ATTRIBUTE_SYNTAX',
        message: 'Expected a string literal',
      }),
    ]);
  });

  it('publishes no envelope for a block whose attribute interpretation fails', () => {
    const result = build(['enum Level {', '  Low = 1', '  @@bogus("x")', '}'].join('\n'));
    const block = blockNamed(result, 'Level');

    expect(result.parsedBlocks.has(block)).toBe(false);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: 'PSL_EXTENSION_UNKNOWN_BLOCK_ATTRIBUTE' }),
    ]);
  });

  it('publishes nothing for unregistered blocks and adds no diagnostics for them', () => {
    const result = build(['mystery Thing {', '  on = read', '  on = write', '}'].join('\n'));
    const block = blockNamed(result, 'Thing');

    expect(result.parsedBlocks.size).toBe(0);
    expect(result.diagnostics).toEqual([]);
    expect(block.block.parameters['on']?.expression).toBe('read');
  });

  it('resolves a forward reference: the policy is declared before its target model', () => {
    const result = build(
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

    expect(result.diagnostics).toEqual([]);
    const envelope = result.parsedBlocks.get(blockNamed(result, 'ReadPosts'));
    expect(envelope?.values['target']).toMatchObject({
      declaration: modelNamed(result, 'Post'),
    });
  });

  it('prefers the local namespace declaration over a same-named top-level model, in reversed order', () => {
    const result = build(
      [
        'namespace blog {',
        '  policy_select ReadArticles {',
        '    target = Article',
        '    using  = "true"',
        '  }',
        '  model Article {',
        '    id Int',
        '  }',
        '}',
        'model Article {',
        '  id Int',
        '}',
      ].join('\n'),
    );

    expect(result.diagnostics).toEqual([]);
    const envelope = result.parsedBlocks.get(blockNamed(result, 'ReadArticles', 'blog'));
    expect(envelope?.values['target']).toMatchObject({
      declaration: modelNamed(result, 'Article', 'blog'),
    });
  });

  it('falls back to a top-level declaration when the local namespace lacks the name', () => {
    const result = build(
      [
        'namespace blog {',
        '  policy_select ReadPosts {',
        '    target = Post',
        '    using  = "true"',
        '  }',
        '}',
        'model Post {',
        '  id Int',
        '}',
      ].join('\n'),
    );

    expect(result.diagnostics).toEqual([]);
    const envelope = result.parsedBlocks.get(blockNamed(result, 'ReadPosts', 'blog'));
    expect(envelope?.values['target']).toMatchObject({
      declaration: modelNamed(result, 'Post'),
    });
  });

  it('rejects a declaration visible only in a sibling namespace', () => {
    const result = build(
      [
        'namespace blog {',
        '  policy_select ReadPosts {',
        '    target = Hidden',
        '    using  = "true"',
        '  }',
        '}',
        'namespace other {',
        '  model Hidden {',
        '    id Int',
        '  }',
        '}',
      ].join('\n'),
    );

    expect(result.parsedBlocks.size).toBe(0);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ message: 'Unknown model reference "Hidden"' }),
    ]);
  });

  it('never falls back past a local wrong-kind shadow of a top-level model', () => {
    const result = build(
      [
        'namespace blog {',
        '  role Post {',
        '  }',
        '  policy_select ReadPosts {',
        '    target = Post',
        '    using  = "true"',
        '  }',
        '}',
        'model Post {',
        '  id Int',
        '}',
      ].join('\n'),
    );
    const block = blockNamed(result, 'ReadPosts', 'blog');

    expect(result.parsedBlocks.has(block)).toBe(false);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ message: 'Expected model reference "Post", found role' }),
    ]);
  });

  it('falls back from a declared-role reference to an unchecked identifier without diagnostics', () => {
    const result = build(
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

    expect(result.diagnostics).toEqual([]);
    const envelope = result.parsedBlocks.get(blockNamed(result, 'ReadPosts'));
    expect(envelope?.values['roles']).toEqual([
      expect.objectContaining({ declaration: blockNamed(result, 'reporting') }),
      'external_role',
    ]);
  });

  it('reports each failure exactly once with its original span', () => {
    const result = build(
      [
        'model Post {',
        '  id Int',
        '}',
        'policy_select ReadPosts {',
        '  target = Post',
        '  using  = 42',
        '  using  = "again"',
        '  bogus  = "x"',
        '  @@nope("y")',
        '}',
      ].join('\n'),
    );

    const codes = result.diagnostics.map((diagnostic) => diagnostic.code);
    const count = (code: string) => codes.filter((candidate) => candidate === code).length;
    expect(count('PSL_INVALID_ATTRIBUTE_SYNTAX')).toBe(1);
    expect(count('PSL_EXTENSION_DUPLICATE_PARAMETER')).toBe(1);
    expect(count('PSL_EXTENSION_UNKNOWN_PARAMETER')).toBe(1);
    expect(count('PSL_EXTENSION_UNKNOWN_BLOCK_ATTRIBUTE')).toBe(1);
    expect(codes).toHaveLength(4);
    const valueFailure = result.diagnostics.find(
      (diagnostic) => diagnostic.code === 'PSL_INVALID_ATTRIBUTE_SYNTAX',
    );
    expect(valueFailure?.range).toEqual({
      start: { line: 5, character: 11 },
      end: { line: 5, character: 13 },
    });
  });

  it('publishes envelopes for prototype-named blocks and members through the map', () => {
    const result = build(['enum __proto__ {', '  __proto__ = "evil"', '}'].join('\n'));
    const block = blockNamed(result, '__proto__');

    expect(result.diagnostics).toEqual([]);
    const envelope = result.parsedBlocks.get(block);
    expect(envelope).toBeDefined();
    if (envelope === undefined) return;
    expect(envelope.name).toBe('__proto__');
    expect(Object.hasOwn(envelope.values, '__proto__')).toBe(true);
    expect(ownEntry(envelope.values, '__proto__')).toBe('evil');
  });
});
