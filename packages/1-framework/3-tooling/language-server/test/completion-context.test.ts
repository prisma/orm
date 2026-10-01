import {
  FieldDeclarationAst,
  GenericBlockDeclarationAst,
  ModelDeclarationAst,
  parse,
} from '@internal/psl-parser/syntax';
import { describe, expect, it } from 'vitest';
import { classifyPslCompletionContext } from '../src/completion-context';

function classify(markedSource: string): ReturnType<typeof classifyPslCompletionContext> {
  const cursorOffset = markedSource.indexOf('|');
  expect(cursorOffset).toBeGreaterThanOrEqual(0);
  const source = `${markedSource.slice(0, cursorOffset)}${markedSource.slice(cursorOffset + 1)}`;
  const { document, sources } = parse(source, 'language-server-test.psl');
  const sourceFile = sources.sourceFileFor(document.syntax);

  return classifyPslCompletionContext({
    document,
    sourceFile,
    position: sourceFile.positionAt(cursorOffset),
  });
}

function expectUnsupported(markedSource: string): void {
  expect(classify(markedSource)).toMatchObject({ kind: 'unsupported' });
}

describe('classifyPslCompletionContext', () => {
  it.each([
    {
      args: 'flag: true,| collection: []',
      path: [],
      positionalIndex: 0,
      keys: ['flag', 'collection'],
    },
    {
      args: 'call: nested("a",| flag: true)',
      path: [
        { kind: 'namedArgument', name: 'call' },
        { kind: 'functionCall', name: 'nested' },
      ],
      positionalIndex: 1,
      keys: ['flag'],
    },
  ])(
    'preserves completion slots before existing named arguments: $args',
    ({ args, path, positionalIndex, keys }) => {
      expect(classify(`model Example { value String @probe(${args}) }`)).toMatchObject({
        kind: 'fieldAttributeArgumentSlot',
        attributeName: 'probe',
        path,
        positionalIndex,
        existingNamedKeys: keys,
        hasColon: false,
      });
    },
  );

  it('classifies blank document-level declaration keyword positions', () => {
    const context = classify('|');

    expect(context).toMatchObject({
      kind: 'declarationKeyword',
      scope: 'document',
      replacementStartOffset: 0,
      offset: 0,
    });
  });

  it('classifies partial document-level declaration keyword prefixes', () => {
    const context = classify('mo|');

    expect(context).toMatchObject({
      kind: 'declarationKeyword',
      scope: 'document',
      replacementStartOffset: 0,
      offset: 2,
    });
  });

  it('offers a declaration keyword after a closing brace on the same line', () => {
    expect(classify('model User {} mo|')).toMatchObject({
      kind: 'declarationKeyword',
      scope: 'document',
    });
  });

  it('offers a declaration keyword immediately after a complete declaration', () => {
    expect(classify('model A {}|')).toMatchObject({
      kind: 'declarationKeyword',
      scope: 'document',
    });
  });

  it('returns unsupported mid-header of an incomplete declaration', () => {
    expectUnsupported('model A|');
  });

  it('offers a document-level declaration keyword on a fresh line after a closed namespace', () => {
    expect(classify(['namespace auth {', '  model A {}', '}', '|'].join('\n'))).toMatchObject({
      kind: 'declarationKeyword',
      scope: 'document',
    });
  });

  it('classifies blank namespace-body declaration keyword positions', () => {
    const context = classify(['namespace auth {', '  |', '}'].join('\n'));

    expect(context).toMatchObject({
      kind: 'declarationKeyword',
      scope: 'namespace',
    });
  });

  it('classifies partial namespace-body declaration keyword prefixes', () => {
    const context = classify(['namespace auth {', '  ty|', '}'].join('\n'));

    expect(context).toMatchObject({
      kind: 'declarationKeyword',
      scope: 'namespace',
    });
  });

  it('classifies a blank model field type position', () => {
    const context = classify(['model Post {', '  author |', '}'].join('\n'));

    expect(context).toMatchObject({
      kind: 'modelType',
      fieldName: 'author',
    });
  });

  it('treats the next indented line as a blank model field type position', () => {
    expect(classify(['model Post {', '  author', '  |', '}'].join('\n'))).toMatchObject({
      kind: 'modelType',
      fieldName: 'author',
    });
  });

  it('does not treat a comment after the field name as a blank model field type position', () => {
    expectUnsupported(['model Post {', '  author // |', '}'].join('\n'));
  });

  it('offers a model field type before a trailing comment', () => {
    expect(classify(['model Post {', '  author |// note', '}'].join('\n'))).toMatchObject({
      kind: 'modelType',
      fieldName: 'author',
    });
  });

  it('bounds the empty type slot at a field attribute', () => {
    expect(classify(['model Post {', '  author |@id', '}'].join('\n'))).toMatchObject({
      kind: 'modelType',
      fieldName: 'author',
    });
  });

  it('classifies a field attribute on a typeless field', () => {
    expect(classify(['model Post {', '  author @id|', '}'].join('\n'))).toMatchObject({
      kind: 'fieldAttributeName',
    });
    expect(classify(['model Post {', '  author @i|d', '}'].join('\n'))).toMatchObject({
      kind: 'fieldAttributeName',
    });
  });

  it('does not treat the cursor glued to the field name as a type slot', () => {
    expectUnsupported(['model Post {', '  author|', '}'].join('\n'));
  });

  it('classifies a partial bare model field type prefix', () => {
    const context = classify(['model Post {', '  reviewer U|', '}'].join('\n'));

    expect(context).toMatchObject({
      kind: 'modelType',
      fieldName: 'reviewer',
    });
  });

  it('classifies the type position when the cursor sits inside a present field type', () => {
    expect(classify(['model Post {', '  author In|t', '}'].join('\n'))).toMatchObject({
      kind: 'modelType',
      fieldName: 'author',
    });
  });

  it('classifies namespace-qualified model field type prefixes', () => {
    expect(classify(['model Post {', '  owner auth.|', '}'].join('\n'))).toMatchObject({
      kind: 'namespaceMember',
      fieldName: 'owner',
      namespace: 'auth',
    });

    expect(classify(['model Post {', '  editor auth.U|', '}'].join('\n'))).toMatchObject({
      kind: 'namespaceMember',
      fieldName: 'editor',
      namespace: 'auth',
    });
  });

  it('classifies contract-space-qualified model field type prefixes', () => {
    expect(classify(['model Post {', '  external supabase:|', '}'].join('\n'))).toMatchObject({
      kind: 'spaceMember',
      fieldName: 'external',
      space: 'supabase',
    });

    expect(
      classify(['model Post {', '  externalUser supabase:auth.|', '}'].join('\n')),
    ).toMatchObject({
      kind: 'namespaceMember',
      fieldName: 'externalUser',
      namespace: 'auth',
      space: 'supabase',
    });

    expect(classify(['model Post {', '  owner supabase:auth.U|', '}'].join('\n'))).toMatchObject({
      kind: 'namespaceMember',
      fieldName: 'owner',
      namespace: 'auth',
      space: 'supabase',
    });
  });

  it('carries no space for a locally namespace-qualified prefix', () => {
    const context = classify(['model Post {', '  owner auth.|', '}'].join('\n'));

    expect(context).toMatchObject({
      kind: 'namespaceMember',
      fieldName: 'owner',
      namespace: 'auth',
    });
    expect(context).not.toHaveProperty('space');
  });

  it('classifies a contract-space-qualified prefix without a namespace segment as a space member', () => {
    expect(classify(['model Post {', '  external supabase:U|', '}'].join('\n'))).toMatchObject({
      kind: 'spaceMember',
      fieldName: 'external',
      space: 'supabase',
    });
  });

  it('resolves the namespace when the cursor sits mid-name', () => {
    expect(classify(['model Post {', '  owner auth.Use|r', '}'].join('\n'))).toMatchObject({
      kind: 'namespaceMember',
      fieldName: 'owner',
      namespace: 'auth',
    });
  });

  it('returns unsupported in comments and trivia outside type positions', () => {
    expectUnsupported(['model Post {', '  // U|', '  id Int', '}'].join('\n'));
    expectUnsupported(['model Post {', '  |', '  id Int', '}'].join('\n'));
  });

  it('classifies field, model, and block attribute names as distinct concrete kinds with concrete owners', () => {
    const fieldContext = classify(['model Post {', '  id Int @|', '}'].join('\n'));
    expect(fieldContext).toMatchObject({
      kind: 'fieldAttributeName',
      ownerKind: 'field',
    });
    if (fieldContext.kind !== 'fieldAttributeName') {
      throw new Error('expected fieldAttributeName');
    }
    expect(fieldContext.model.name()?.name()).toBe('Post');
    expect(fieldContext.field.name()?.name()).toBe('id');
    expect(fieldContext).not.toHaveProperty('block');
    expect(fieldContext).not.toHaveProperty('blockKeyword');

    const modelContext = classify(['model Post {', '  id Int', '  @@|', '}'].join('\n'));
    expect(modelContext).toMatchObject({
      kind: 'modelAttributeName',
      ownerKind: 'model',
    });
    if (modelContext.kind !== 'modelAttributeName') {
      throw new Error('expected modelAttributeName');
    }
    expect(modelContext.model.name()?.name()).toBe('Post');
    expect(modelContext).not.toHaveProperty('field');
    expect(modelContext).not.toHaveProperty('block');
    expect(modelContext).not.toHaveProperty('blockKeyword');

    const blockContext = classify(['policy Foo {', '  @@|', '}'].join('\n'));
    expect(blockContext).toMatchObject({
      kind: 'blockAttributeName',
      ownerKind: 'block',
      blockKeyword: 'policy',
    });
    if (blockContext.kind !== 'blockAttributeName') {
      throw new Error('expected blockAttributeName');
    }
    expect(blockContext.block.keyword()?.text).toBe('policy');
    expect(blockContext).not.toHaveProperty('model');
    expect(blockContext).not.toHaveProperty('field');
  });

  it('classifies partial attribute names with a replace range over the typed segment', () => {
    const context = classify(['model Post {', '  id Int @uni|', '}'].join('\n'));

    expect(context).toMatchObject({
      kind: 'fieldAttributeName',
      replacementStartOffset: 23,
      offset: 26,
    });
  });

  it('classifies top-level attribute named keys as distinct concrete kinds with concrete owners', () => {
    const fieldContext = classify(['model M {', '  id Int @map(na|me: "")', '}'].join('\n'));
    expect(fieldContext).toMatchObject({
      kind: 'fieldAttributeNamedKey',
      attributeName: 'map',
    });
    if (fieldContext.kind !== 'fieldAttributeNamedKey') {
      throw new Error('expected fieldAttributeNamedKey');
    }
    expect(fieldContext.model.name()?.name()).toBe('M');
    expect(fieldContext.field.name()?.name()).toBe('id');
    expect(fieldContext).not.toHaveProperty('block');
    expect(fieldContext).not.toHaveProperty('blockKeyword');

    const modelContext = classify(
      ['model M {', '  @@index(fields: [id], na|me: "")', '}'].join('\n'),
    );
    expect(modelContext).toMatchObject({
      kind: 'modelAttributeNamedKey',
      attributeName: 'index',
    });
    if (modelContext.kind !== 'modelAttributeNamedKey') {
      throw new Error('expected modelAttributeNamedKey');
    }
    expect(modelContext.model.name()?.name()).toBe('M');
    expect(modelContext).not.toHaveProperty('field');
    expect(modelContext).not.toHaveProperty('block');
    expect(modelContext).not.toHaveProperty('blockKeyword');

    const blockContext = classify(['policy Foo {', '  @@audit(ena|bled: true)', '}'].join('\n'));
    expect(blockContext).toMatchObject({
      kind: 'blockAttributeNamedKey',
      attributeName: 'audit',
      blockKeyword: 'policy',
    });
    if (blockContext.kind !== 'blockAttributeNamedKey') {
      throw new Error('expected blockAttributeNamedKey');
    }
    expect(blockContext.block.keyword()?.text).toBe('policy');
    expect(blockContext).not.toHaveProperty('model');
    expect(blockContext).not.toHaveProperty('field');
  });

  it('does not classify closed attribute argument list end positions as named keys', () => {
    expectUnsupported(['model Post {', '  id Int @map()|', '}'].join('\n'));
    expectUnsupported(['model Post {', '  id Int', '  @@index()|', '}'].join('\n'));
    expectUnsupported(['policy Rule {', '  @@audit()|', '}'].join('\n'));
  });

  it('preserves ambiguous slots inside closed and unfinished attribute argument lists', () => {
    for (const source of ['model Post { id Int @map(|) }', 'model Post { id Int @map(|']) {
      expect(classify(source)).toMatchObject({
        kind: 'fieldAttributeArgumentSlot',
        attributeName: 'map',
        path: [],
        positionalIndex: 0,
        existingNamedKeys: [],
      });
    }
  });

  it('distinguishes values from nested ambiguous argument slots', () => {
    expect(classify(['model Post {', '  id Int @map(name: value|)', '}'].join('\n'))).toMatchObject(
      { kind: 'fieldAttributeValue' },
    );
    expect(
      classify(['model Post {', '  id Int @default(autoincrement(|))', '}'].join('\n')),
    ).toMatchObject({
      kind: 'fieldAttributeArgumentSlot',
      path: [
        { kind: 'positionalArgument', index: 0 },
        { kind: 'functionCall', name: 'autoincrement' },
      ],
      positionalIndex: 0,
      existingNamedKeys: [],
    });
    expect(
      classify(['model Post {', '  authorId Int @relation(fields: [|])', '}'].join('\n')),
    ).toMatchObject({ kind: 'fieldAttributeValue' });
  });

  it('bounds field attribute completion to the active attribute span', () => {
    expectUnsupported(['model Post {', '  id Int @id |', '}'].join('\n'));
  });

  it('keeps attribute completion active at the attribute end offset', () => {
    expect(classify(['model Post {', '  id Int @id|', '}'].join('\n'))).toMatchObject({
      kind: 'fieldAttributeName',
    });
    expect(classify(['model Post {', '  id Int', '  @@id|', '}'].join('\n'))).toMatchObject({
      kind: 'modelAttributeName',
    });
    expect(classify(['policy Foo {', '  @@audit|', '}'].join('\n'))).toMatchObject({
      kind: 'blockAttributeName',
      blockKeyword: 'policy',
    });
  });

  it('classifies a composite-type field type position', () => {
    expect(classify(['type Address {', '  city |', '}'].join('\n'))).toMatchObject({
      kind: 'modelType',
      fieldName: 'city',
    });

    expect(classify(['type Address {', '  city U|', '}'].join('\n'))).toMatchObject({
      kind: 'modelType',
      fieldName: 'city',
    });
  });

  it('classifies blank generic block key positions', () => {
    const context = classify(['policy UserAccess {', '  |', '}'].join('\n'));
    expect(context).toMatchObject({
      kind: 'genericBlockKey',
      blockKeyword: 'policy',
    });
    if (context.kind !== 'genericBlockKey') throw new Error('expected genericBlockKey');
    expect(context.block.keyword()?.text).toBe('policy');
  });

  it('carries the enclosing block AST node for generic block key prefixes', () => {
    const context = classify(['policy UserAccess {', '  on = User', '  wh|', '}'].join('\n'));
    expect(context).toMatchObject({
      kind: 'genericBlockKey',
      blockKeyword: 'policy',
    });
    if (context.kind !== 'genericBlockKey') throw new Error('expected genericBlockKey');
    expect(context.block.keyword()?.text).toBe('policy');
    expect([...context.block.entries()].map((entry) => entry.key()?.name())).toEqual(['on', 'wh']);
  });

  it('classifies generic block value positions after the equals sign', () => {
    expect(classify(['datasource db {', '  provider = |', '}'].join('\n'))).toMatchObject({
      kind: 'genericBlockValue',
      blockKeyword: 'datasource',
    });
  });

  it('classifies a generic block value position flush against the equals sign', () => {
    expect(classify(['datasource db {', '  provider =|', '}'].join('\n'))).toMatchObject({
      kind: 'genericBlockValue',
      blockKeyword: 'datasource',
    });
  });

  it('classifies a partial generic block value prefix', () => {
    expect(classify(['datasource db {', '  provider = fo|', '}'].join('\n'))).toMatchObject({
      kind: 'genericBlockValue',
      blockKeyword: 'datasource',
    });
  });

  it('classifies the gap before = as a generic block key with an empty source range', () => {
    const context = classify(['datasource db {', '  url |= "x"', '}'].join('\n'));

    expect(context).toMatchObject({
      kind: 'genericBlockKey',
      blockKeyword: 'datasource',
    });
    // rust-analyzer `source_range()` shape: the cursor sits in whitespace, so the
    // edit range is empty at the cursor rather than synthesising the `url` key.
    if (context.kind === 'genericBlockKey') {
      expect(context.replacementStartOffset).toBe(context.offset);
    }
  });

  it('returns unsupported inside type constructor arguments', () => {
    expectUnsupported(['model Embedding {', '  vector Vector(|)', '}'].join('\n'));
  });

  it('returns unsupported outside model field type prefixes', () => {
    expectUnsupported(['model Post {', '  |id Int', '}'].join('\n'));
    expectUnsupported(['model Post {', '  id Int |', '}'].join('\n'));
  });

  it.each([
    ['model M { value String @probe(', ') }', 'fieldAttributeValue'],
    ['model M { @@probe(', ') }', 'modelAttributeValue'],
    ['policy M { @@probe(', ') }', 'blockAttributeValue'],
  ])('preserves the full nested value position for %s', (prefix, suffix, kind) => {
    const marked = `${prefix}nested: wrap([ordered(direction: A|sc)])${suffix}`;
    const context = classify(marked);
    expect(context).toEqual({
      kind,
      ...(kind === 'fieldAttributeValue'
        ? {
            ownerKind: 'field',
            field: expect.any(FieldDeclarationAst),
            model: expect.any(ModelDeclarationAst),
          }
        : kind === 'modelAttributeValue'
          ? { ownerKind: 'model', model: expect.any(ModelDeclarationAst) }
          : {
              ownerKind: 'block',
              block: expect.any(GenericBlockDeclarationAst),
              blockKeyword: 'policy',
            }),
      attributeName: 'probe',
      path: [
        { kind: 'namedArgument', name: 'nested' },
        { kind: 'functionCall', name: 'wrap' },
        { kind: 'positionalArgument', index: 0 },
        { kind: 'listElement' },
        { kind: 'functionCall', name: 'ordered' },
        { kind: 'namedArgument', name: 'direction' },
      ],
      syntax: 'scalar',
      offset: marked.indexOf('|'),
      replacementStartOffset: marked.indexOf('A|'),
      replacementEndOffset: marked.indexOf('|') + 2,
    });
    expect(context).not.toHaveProperty('attribute');
  });

  it.each([
    [
      'model M { value String @probe(',
      'fieldAttribute',
      {
        ownerKind: 'field',
        field: expect.any(FieldDeclarationAst),
        model: expect.any(ModelDeclarationAst),
      },
    ],
    [
      'model M { @@probe(',
      'modelAttribute',
      { ownerKind: 'model', model: expect.any(ModelDeclarationAst) },
    ],
    [
      'policy M { @@probe(',
      'blockAttribute',
      { ownerKind: 'block', block: expect.any(GenericBlockDeclarationAst), blockKeyword: 'policy' },
    ],
  ])('preserves exact nested keys and ambiguous slots for %s', (prefix, ownerKind, owner) => {
    for (const args of [
      'optional: true, req|uired: []',
      'optional: true, |',
      'optional: true, Asc, |',
      'optional: true, A|sc',
    ]) {
      const marked = `${prefix}choice: ordered(${args})) }`;
      const namedKey = args.includes('req|');
      const identifier = args.includes('A|');
      const offset = marked.indexOf('|');
      expect(classify(marked)).toEqual({
        ...owner,
        kind: `${ownerKind}${namedKey ? 'NamedKey' : 'ArgumentSlot'}`,
        attributeName: 'probe',
        path: [
          { kind: 'namedArgument', name: 'choice' },
          { kind: 'functionCall', name: 'ordered' },
        ],
        existingNamedKeys: ['optional'],
        hasColon: namedKey,
        ...(!namedKey ? { positionalIndex: args.includes('Asc,') ? 1 : 0 } : {}),
        offset,
        replacementStartOffset: namedKey ? offset - 3 : identifier ? offset - 1 : offset,
        replacementEndOffset: namedKey ? offset + 5 : identifier ? offset + 2 : offset,
      });
    }
  });

  it.each(['flags: [true |]', 'scalar: true |', 'call: f |(x: true)', 'flags: []|'])(
    'rejects completed expression boundaries during classification: %s',
    (args) => {
      expectUnsupported(`model M { value String @probe(${args}) }`);
    },
  );

  it.each(['flags: [, |]', 'flags: [true,, |]'])(
    'classifies recovered nested comma gaps: %s',
    (args) => {
      const marked = `model M { value String @probe(${args}) }`;
      expect(classify(marked)).toMatchObject({
        kind: 'fieldAttributeValue',
        attributeName: 'probe',
        path: [{ kind: 'namedArgument', name: 'flags' }, { kind: 'listElement' }],
        syntax: 'scalar',
        offset: marked.indexOf('|'),
        replacementStartOffset: marked.indexOf('|'),
        replacementEndOffset: marked.indexOf('|'),
      });
    },
  );

  it.each([
    ['choice: or|dered(true)', 'choice', 'functionName', 'ordered'],
    ['fixed: "ol|d"', 'fixed', 'scalar', '"old"'],
    ['fixed: -1|2', 'fixed', 'scalar', '-12'],
  ])('captures the exact leaf and replacement for %s', (args, name, syntax, token) => {
    const marked = `model M { value String @probe(${args}) }`;
    const source = marked.replace('|', '');
    expect(classify(marked)).toEqual({
      kind: 'fieldAttributeValue',
      model: expect.any(ModelDeclarationAst),
      field: expect.any(FieldDeclarationAst),
      attributeName: 'probe',
      path: [{ kind: 'namedArgument', name }],
      ownerKind: 'field',
      syntax,
      offset: marked.indexOf('|'),
      replacementStartOffset: source.indexOf(token),
      replacementEndOffset: source.indexOf(token) + token.length,
    });
  });

  it.each(['()', '(', ''])('captures name edit boundaries and existing arguments: %s', (suffix) => {
    const marked = `model M { value String @pr|obe${suffix}`;
    expect(classify(marked)).toEqual({
      kind: 'fieldAttributeName',
      model: expect.any(ModelDeclarationAst),
      field: expect.any(FieldDeclarationAst),
      offset: marked.indexOf('|'),
      replacementStartOffset: marked.indexOf('pr|'),
      replacementEndOffset: marked.indexOf('|') + 3,
      hasArgumentList: suffix.length > 0,
      ownerKind: 'field',
    });
  });

  it('retains the entire recovered record/list path at EOF', () => {
    const marked = 'model M { value String @probe(records: { key: [, |';
    expect(classify(marked)).toEqual({
      kind: 'fieldAttributeValue',
      model: expect.any(ModelDeclarationAst),
      field: expect.any(FieldDeclarationAst),
      attributeName: 'probe',
      ownerKind: 'field',
      path: [
        { kind: 'namedArgument', name: 'records' },
        { kind: 'recordValue' },
        { kind: 'listElement' },
      ],
      syntax: 'scalar',
      offset: marked.indexOf('|'),
      replacementStartOffset: marked.indexOf('|'),
      replacementEndOffset: marked.indexOf('|'),
    });
  });

  it.each([
    ['mo|de', false],
    ['mo|de:   Asc', true],
    ['mo|de :   Asc', true],
  ])('captures colon presence without changing the full key edit: %s', (args, hasColon) => {
    const marked = `model M { value String @probe(${args}) }`;
    expect(classify(marked)).toMatchObject({
      kind: hasColon ? 'fieldAttributeNamedKey' : 'fieldAttributeArgumentSlot',
      hasColon,
      path: [],
      replacementStartOffset: marked.indexOf('mo|'),
      replacementEndOffset: marked.indexOf('|') + 2,
    });
  });

  it('returns unsupported for invalid over-qualified names', () => {
    expectUnsupported(['model Post {', '  owner auth.domain.U|', '}'].join('\n'));
    expectUnsupported(['model Post {', '  owner supabase:auth:U|', '}'].join('\n'));
  });
});
