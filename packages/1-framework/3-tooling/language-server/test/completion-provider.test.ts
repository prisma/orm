import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type {
  AuthoringEntityTypeNamespace,
  AuthoringPslBlockDescriptorNamespace,
} from '@internal/framework-components/authoring';
import {
  assembleAuthoringContributions,
  assembleControlMutationDefaults,
  type ControlMutationDefaultRegistry,
} from '@internal/framework-components/control';
import {
  type AttributeSpecNamespace,
  blockAttribute,
  buildSymbolTable,
  type FieldAttributeSpecContext,
  fieldAttribute,
  int,
  modelAttribute,
  optional,
  str,
} from '@internal/psl-parser';
import { parse, type SourceFile } from '@internal/psl-parser/syntax';
import { describe, expect, it } from 'vitest';
import { type CompletionItem, CompletionItemKind, InsertTextFormat } from 'vscode-languageserver';
import { classifyPslCompletionContext } from '../src/completion-context';
import { providePslCompletionItems } from '../src/completion-provider';

const scalarTypes = ['String', 'Int', 'Boolean', 'DateTime'] as const;
const nameSnippetPlaceholder = '$' + '{1:Name}';
const emptySnippetPlaceholder1 = '$' + '{1:}';
const emptySnippetPlaceholder2 = '$' + '{2:}';
const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const markerAttribute = fieldAttribute('marker', {
  positional: [{ key: 'target', type: str() }],
  named: { name: str(), priority: optional(int()) },
});
const orderFixtureAttribute = fieldAttribute('orderFixture', {
  named: { zebra: int(), alpha: int(), middle: int() },
});
const rlsAttribute = modelAttribute('rls', {
  named: { enabled: optional(str()), mode: str() },
});
const auditAttribute = blockAttribute('audit', {
  named: { reason: optional(str()), level: int() },
});

const attributeContributions = assembleAuthoringContributions([
  {
    id: 'fixture-family',
    authoring: {
      attributeSpecs: {
        field: {
          marker: () => markerAttribute,
          orderFixture: () => orderFixtureAttribute,
          ownerAware: (ctx: FieldAttributeSpecContext) =>
            fieldAttribute('ownerAware', {
              named: {
                [Object.hasOwn(ctx.model.fields, 'scopedOnly') ? 'scopedKey' : 'topKey']: str(),
              },
            }),
        },
        model: {},
      },
    },
  },
  {
    id: 'fixture-target',
    authoring: {
      modelAttributes: {
        security: {
          rls: {
            kind: 'modelAttribute',
            attribute: 'rls',
            spec: () => rlsAttribute,
            lower: () => undefined,
          },
        },
      },
    },
  },
]);
const controlMutationDefaults = assembleControlMutationDefaults([]);
const pslBlockDescriptors: AuthoringPslBlockDescriptorNamespace = {
  policy: {
    kind: 'pslBlock',
    keyword: 'policy',
    discriminator: 'fixture-policy',
    name: { required: true },
    parameters: {
      on: { kind: 'ref', refKind: 'model', scope: 'same-space' },
      where: { kind: 'value', codecId: 'fixture/text@1' },
      mode: { kind: 'option', values: ['permissive', 'restrictive'] },
      using: { kind: 'value', codecId: 'fixture/text@1' },
    },
    attributes: { audit: () => auditAttribute },
  },
  access: {
    audit: {
      kind: 'pslBlock',
      keyword: 'audit',
      discriminator: 'fixture-audit',
      name: { required: true },
      parameters: {
        on: { kind: 'ref', refKind: 'model', scope: 'same-space' },
      },
    },
  },
};

const candidateSource = [
  'types {',
  '  Email = String',
  '  UserId = User',
  '}',
  'model User {',
  '  id Int',
  '  topOnly String',
  '}',
  'type Address {',
  '  street String',
  '}',
  'policy Audit {',
  '  on = read',
  '}',
  'namespace auth {',
  '  model Account {',
  '    id Int',
  '  }',
  '  model User {',
  '    id Int',
  '    scopedOnly String',
  '  }',
  '  type Profile {',
  '    displayName String',
  '  }',
  '  policy ScopedAudit {',
  '    on = read',
  '  }',
  '}',
].join('\n');

function complete(
  markedFieldSource: string,
  options: { readonly clientSupportsSnippets?: boolean } = {},
) {
  return completeWithSource({
    markedSource: `${candidateSource}\n${markedFieldSource}`,
    pslBlockDescriptors,
    authoringContributions: attributeContributions,
    controlMutationDefaults,
    clientSupportsSnippets: options.clientSupportsSnippets === true,
  });
}

interface CompletionTestStack {
  readonly attributeSpecs: AttributeSpecNamespace;
  readonly entityTypes: AuthoringEntityTypeNamespace;
  readonly pslBlockDescriptors: AuthoringPslBlockDescriptorNamespace;
}

interface ActualSqlAttributeModule {
  readonly sqlAttributeSpecs: AttributeSpecNamespace;
}

interface ActualSqlBlockModule {
  readonly sqlFamilyEntityTypes: AuthoringEntityTypeNamespace;
  readonly sqlFamilyPslBlockDescriptors: AuthoringPslBlockDescriptorNamespace;
}

interface ActualPostgresDefaultsModule {
  createPostgresDefaultFunctionRegistry(): ControlMutationDefaultRegistry;
}

interface ActualMongoAttributeModule {
  readonly mongoAttributeSpecs: AttributeSpecNamespace;
}

interface ActualMongoBlockModule {
  readonly mongoFamilyEntityTypes: AuthoringEntityTypeNamespace;
  readonly mongoFamilyPslBlockDescriptors: AuthoringPslBlockDescriptorNamespace;
}

function completeWithSource(input: {
  readonly markedSource: string;
  readonly pslBlockDescriptors: AuthoringPslBlockDescriptorNamespace;
  readonly authoringContributions?: typeof attributeContributions;
  readonly controlMutationDefaults?: typeof controlMutationDefaults;
  readonly clientSupportsSnippets?: boolean;
}) {
  const cursorOffset = input.markedSource.indexOf('|');
  expect(cursorOffset).toBeGreaterThanOrEqual(0);
  const source = `${input.markedSource.slice(0, cursorOffset)}${input.markedSource.slice(cursorOffset + 1)}`;
  const { document, sourceFile } = parse(source);
  const { table: symbolTable } = buildSymbolTable({
    document,
    sourceFile,
    pslBlockDescriptors: input.pslBlockDescriptors,
  });
  const context = classifyPslCompletionContext({
    document,
    sourceFile,
    position: sourceFile.positionAt(cursorOffset),
  });

  return {
    items: providePslCompletionItems({
      context,
      sourceFile,
      candidates: {
        scalarTypes,
        pslBlockDescriptors: input.pslBlockDescriptors,
        symbolTable,
        ...(input.authoringContributions === undefined
          ? {}
          : { authoringContributions: input.authoringContributions }),
        ...(input.controlMutationDefaults === undefined
          ? {}
          : { controlMutationDefaults: input.controlMutationDefaults }),
      },
      clientSupportsSnippets: input.clientSupportsSnippets === true,
    }),
    sourceFile,
    cursorOffset,
  };
}

async function actualSqlStack(): Promise<CompletionTestStack> {
  const [attributes, blocks] = await Promise.all([
    importFromPackageRoot<ActualSqlAttributeModule>(
      '../../../2-sql/2-authoring/contract-psl/src/sql-attribute-specs.ts',
    ),
    importFromPackageRoot<ActualSqlBlockModule>(
      '../../../2-sql/9-family/src/core/authoring-entity-types.ts',
    ),
  ]);
  return {
    attributeSpecs: attributes.sqlAttributeSpecs,
    entityTypes: blocks.sqlFamilyEntityTypes,
    pslBlockDescriptors: blocks.sqlFamilyPslBlockDescriptors,
  };
}

async function actualMongoStack(): Promise<CompletionTestStack> {
  const [attributes, blocks] = await Promise.all([
    importFromPackageRoot<ActualMongoAttributeModule>(
      '../../../2-mongo-family/2-authoring/contract-psl/src/mongo-attribute-specs.ts',
    ),
    importFromPackageRoot<ActualMongoBlockModule>(
      '../../../2-mongo-family/9-family/src/core/authoring-entity-types.ts',
    ),
  ]);
  return {
    attributeSpecs: attributes.mongoAttributeSpecs,
    entityTypes: blocks.mongoFamilyEntityTypes,
    pslBlockDescriptors: blocks.mongoFamilyPslBlockDescriptors,
  };
}

async function importFromPackageRoot<T>(relativePath: string): Promise<T> {
  return (await import(pathToFileURL(resolve(packageRoot, relativePath)).href)) as T;
}

function actualAuthoringContributions(stack: CompletionTestStack): typeof attributeContributions {
  return assembleAuthoringContributions([
    {
      id: 'actual-family',
      authoring: {
        attributeSpecs: stack.attributeSpecs,
        entityTypes: stack.entityTypes,
        pslBlockDescriptors: stack.pslBlockDescriptors,
      },
    },
  ]);
}

function completeWithActualStack(
  markedSource: string,
  stack: CompletionTestStack,
  options: {
    readonly clientSupportsSnippets?: boolean;
    readonly controlMutationDefaults?: typeof controlMutationDefaults;
  } = {},
) {
  return completeWithSource({
    markedSource,
    pslBlockDescriptors: stack.pslBlockDescriptors,
    authoringContributions: actualAuthoringContributions(stack),
    controlMutationDefaults: options.controlMutationDefaults ?? controlMutationDefaults,
    clientSupportsSnippets: options.clientSupportsSnippets === true,
  });
}

function applyCompletionItem(input: {
  readonly sourceFile: SourceFile;
  readonly item: CompletionItem;
}) {
  const edit = input.item.textEdit;
  if (edit === undefined || !('range' in edit)) {
    throw new Error('Expected a range text edit');
  }
  const start = input.sourceFile.offsetAt(edit.range.start);
  const end = input.sourceFile.offsetAt(edit.range.end);
  return `${input.sourceFile.text.slice(0, start)}${edit.newText}${input.sourceFile.text.slice(end)}`;
}

function completionItemByLabel(items: readonly CompletionItem[], label: string): CompletionItem {
  const item = items.find((candidate) => candidate.label === label);
  if (item === undefined) {
    throw new Error(`Expected completion item "${label}"`);
  }
  return item;
}

describe('providePslCompletionItems', () => {
  it('returns document-level declaration keyword candidates with stable plain-text edits', () => {
    const { items, sourceFile, cursorOffset } = complete('|');

    expect(items.map((item) => item.label)).toEqual([
      'model',
      'type',
      'types',
      'namespace',
      'audit',
      'policy',
    ]);
    expect(items.map((item) => item.detail)).toEqual([
      'PSL declaration keyword',
      'PSL declaration keyword',
      'PSL declaration keyword',
      'PSL declaration keyword',
      'Generic block keyword',
      'Generic block keyword',
    ]);
    expect(items[0]).toMatchObject({
      kind: CompletionItemKind.Keyword,
      filterText: 'model',
      textEdit: {
        range: {
          start: sourceFile.positionAt(cursorOffset),
          end: sourceFile.positionAt(cursorOffset),
        },
        newText: 'model ',
      },
    });
    expect(items[0]?.insertTextFormat).toBeUndefined();
  });

  it('returns the full document-level declaration keyword set with a replace range over the typed segment', () => {
    const { items, sourceFile, cursorOffset } = complete('mo|');

    expect(items.map((item) => item.label)).toEqual([
      'model',
      'type',
      'types',
      'namespace',
      'audit',
      'policy',
    ]);
    expect(items[0]).toMatchObject({
      filterText: 'model',
      textEdit: {
        range: {
          start: sourceFile.positionAt(cursorOffset - 'mo'.length),
          end: sourceFile.positionAt(cursorOffset),
        },
        newText: 'model ',
      },
    });
  });

  it('returns namespace-body declaration keywords without document-only native keywords', () => {
    const { items } = complete(['namespace feature {', '  |', '}'].join('\n'));

    expect(items.map((item) => item.label)).toEqual(['model', 'type', 'audit', 'policy']);
    expect(items.map((item) => item.label)).not.toContain('types');
    expect(items.map((item) => item.label)).not.toContain('namespace');
  });

  it('returns the full namespace-body declaration keyword set with a replace range over the typed segment', () => {
    const { items, sourceFile, cursorOffset } = complete(
      ['namespace feature {', '  po|', '}'].join('\n'),
    );

    expect(items.map((item) => item.label)).toEqual(['model', 'type', 'audit', 'policy']);
    expect(items.find((item) => item.label === 'policy')).toMatchObject({
      filterText: 'policy',
      textEdit: {
        range: {
          start: sourceFile.positionAt(cursorOffset - 'po'.length),
          end: sourceFile.positionAt(cursorOffset),
        },
        newText: 'policy ',
      },
    });
  });

  it('returns snippet declaration keyword edits only when the client supports snippets', () => {
    const { items } = complete('|', { clientSupportsSnippets: true });

    expect(items.find((item) => item.label === 'model')).toMatchObject({
      insertTextFormat: InsertTextFormat.Snippet,
      textEdit: { newText: `model ${nameSnippetPlaceholder} {\n  $0\n}` },
    });
    expect(items.find((item) => item.label === 'policy')).toMatchObject({
      insertTextFormat: InsertTextFormat.Snippet,
      textEdit: { newText: `policy ${nameSnippetPlaceholder} {\n  $0\n}` },
    });
  });

  it('returns registry-backed attribute name completions as function items', () => {
    const fieldItems = complete(['model Post {', '  id Int @|', '}'].join('\n')).items;
    expect(fieldItems.map((item) => item.label)).toEqual(['marker', 'orderFixture', 'ownerAware']);
    expect(fieldItems.map((item) => item.kind)).toEqual([
      CompletionItemKind.Function,
      CompletionItemKind.Function,
      CompletionItemKind.Function,
    ]);

    const modelItems = complete(['model Post {', '  id Int', '  @@|', '}'].join('\n')).items;
    expect(modelItems.map((item) => item.label)).toEqual(['rls']);
    expect(modelItems.map((item) => item.kind)).toEqual([CompletionItemKind.Function]);

    const blockItems = complete(['policy Rule {', '  @@|', '}'].join('\n')).items;
    expect(blockItems.map((item) => item.label)).toEqual(['audit']);
    expect(blockItems.map((item) => item.kind)).toEqual([CompletionItemKind.Function]);
  });

  it('returns configured attribute names from the control stack without an interpretation context', () => {
    const { items } = completeWithSource({
      markedSource: [candidateSource, 'model Post {', '  id Int @|', '}'].join('\n'),
      pslBlockDescriptors,
      authoringContributions: attributeContributions,
      controlMutationDefaults,
    });

    expect(items.map((item) => item.label)).toEqual(['marker', 'orderFixture', 'ownerAware']);
  });

  it('resolves the attribute owner once per attribute-name completion request', () => {
    const markedSource = ['model User {', '  id Int @|', '}'].join('\n');
    const cursorOffset = markedSource.indexOf('|');
    const source = `${markedSource.slice(0, cursorOffset)}${markedSource.slice(cursorOffset + 1)}`;
    const { document, sourceFile } = parse(source);
    const { table: symbolTable } = buildSymbolTable({
      document,
      sourceFile,
      pslBlockDescriptors,
    });
    const context = classifyPslCompletionContext({
      document,
      sourceFile,
      position: sourceFile.positionAt(cursorOffset),
    });
    let modelEnumerationCount = 0;
    const observedSymbolTable = {
      ...symbolTable,
      topLevel: {
        ...symbolTable.topLevel,
        models: new Proxy(symbolTable.topLevel.models, {
          ownKeys(target) {
            modelEnumerationCount += 1;
            return Reflect.ownKeys(target);
          },
        }),
      },
    };
    const factoryOwnerNames: string[] = [];
    const observedAuthoringContributions = assembleAuthoringContributions([
      {
        id: 'observed-family',
        authoring: {
          attributeSpecs: {
            field: {
              first: (ctx: FieldAttributeSpecContext) => {
                factoryOwnerNames.push(ctx.model.name);
                return fieldAttribute('first', {});
              },
              second: (ctx: FieldAttributeSpecContext) => {
                factoryOwnerNames.push(ctx.model.name);
                return fieldAttribute('second', {});
              },
            },
            model: {},
          },
        },
      },
    ]);

    const items = providePslCompletionItems({
      context,
      sourceFile,
      candidates: {
        scalarTypes,
        pslBlockDescriptors,
        symbolTable: observedSymbolTable,
        authoringContributions: observedAuthoringContributions,
        controlMutationDefaults,
      },
      clientSupportsSnippets: true,
    });

    expect(items.map((item) => item.label)).toEqual(['first', 'second']);
    expect(factoryOwnerNames).toEqual(['User', 'User']);
    expect(modelEnumerationCount).toBe(1);
  });

  it('returns attribute named keys including optional keys while omitting supplied keys', () => {
    const { items, sourceFile, cursorOffset } = complete(
      ['model Post {', '  id Int @marker(name: "id", pr|)', '}'].join('\n'),
    );

    expect(items.map((item) => item.label)).toEqual(['priority']);
    expect(items[0]?.textEdit).toEqual({
      range: {
        start: sourceFile.positionAt(cursorOffset - 'pr'.length),
        end: sourceFile.positionAt(cursorOffset),
      },
      newText: 'priority: ',
    });
  });

  it('preserves named-key declaration order while filtering supplied keys', () => {
    const { items } = complete(
      ['model Post {', '  id Int @orderFixture(alpha: 1, |)', '}'].join('\n'),
    );

    expect(items.map((item) => [item.label, item.kind])).toEqual([
      ['zebra', CompletionItemKind.Property],
      ['middle', CompletionItemKind.Property],
    ]);
  });

  it('uses the current declaration owner when model names collide across namespaces', () => {
    const { items } = complete(
      [
        'namespace feature {',
        '  model User {',
        '    scopedOnly String @ownerAware(|)',
        '  }',
        '}',
      ].join('\n'),
    );

    expect(items.map((item) => item.label)).toEqual(['scopedKey']);
  });

  it('inserts required contributed attribute arguments as snippets for snippet clients', () => {
    const { items, sourceFile } = complete(
      ['model Post {', '  id Int @mar| // keep', '}'].join('\n'),
      {
        clientSupportsSnippets: true,
      },
    );
    const item = completionItemByLabel(items, 'marker');

    expect(item).toMatchObject({
      insertTextFormat: InsertTextFormat.Snippet,
      textEdit: {
        newText: `marker("${emptySnippetPlaceholder1}", name: "${emptySnippetPlaceholder2}")`,
      },
    });
    expect(applyCompletionItem({ sourceFile, item })).toEqual(
      [
        candidateSource,
        'model Post {',
        `  id Int @marker("${emptySnippetPlaceholder1}", name: "${emptySnippetPlaceholder2}") // keep`,
        '}',
      ].join('\n'),
    );
  });

  it('keeps plain contributed attribute completion free of snippet syntax', () => {
    const { items, sourceFile } = complete(
      ['model Post {', '  id Int @mar| // keep', '}'].join('\n'),
    );
    const item = completionItemByLabel(items, 'marker');

    expect(item.insertTextFormat).toBeUndefined();
    expect(item.textEdit).toMatchObject({ newText: 'marker' });
    expect(applyCompletionItem({ sourceFile, item })).toEqual(
      [candidateSource, 'model Post {', '  id Int @marker // keep', '}'].join('\n'),
    );
  });

  it('preserves existing attribute delimiters and suffixes instead of inserting required arguments again', () => {
    const { items, sourceFile } = complete(
      ['model Post {', '  id Int @mar|ker(name: "id") @unique', '}'].join('\n'),
      { clientSupportsSnippets: true },
    );
    const item = completionItemByLabel(items, 'marker');

    expect(item.insertTextFormat).toBeUndefined();
    expect(item.textEdit).toMatchObject({ newText: 'marker' });
    expect(applyCompletionItem({ sourceFile, item })).toEqual(
      [candidateSource, 'model Post {', '  id Int @marker(name: "id") @unique', '}'].join('\n'),
    );
  });

  it('uses the attribute AST to preserve an incomplete existing argument list', () => {
    const { items, sourceFile } = complete(['model Post {', '  id Int @mar|ker(', '}'].join('\n'), {
      clientSupportsSnippets: true,
    });
    const item = completionItemByLabel(items, 'marker');

    expect(item.insertTextFormat).toBeUndefined();
    expect(item.textEdit).toMatchObject({ newText: 'marker' });
    expect(applyCompletionItem({ sourceFile, item })).toEqual(
      [candidateSource, 'model Post {', '  id Int @marker(', '}'].join('\n'),
    );
  });

  it('uses actual SQL attribute specs for names and top-level named keys', async () => {
    const stack = await actualSqlStack();

    expect(
      completeWithActualStack(['model Post {', '  id Int @|', '}'].join('\n'), stack).items.map(
        (item) => item.label,
      ),
    ).toEqual(['default', 'id', 'map', 'noCheck', 'relation', 'unique']);
    expect(
      completeWithActualStack(
        ['model Post {', '  id Int', '  @@|', '}'].join('\n'),
        stack,
      ).items.map((item) => item.label),
    ).toEqual(['base', 'check', 'control', 'discriminator', 'id', 'index', 'map', 'unique']);
    expect(
      completeWithActualStack(['enum Role {', '  Admin', '  @@|', '}'].join('\n'), stack).items.map(
        (item) => item.label,
      ),
    ).toEqual(['type']);

    const { items, sourceFile, cursorOffset } = completeWithActualStack(
      ['model Post {', '  id Int', '  @@index(expression: "lower(name)", ma|)', '}'].join('\n'),
      stack,
    );
    expect(items.map((item) => item.label)).toEqual([
      'where',
      'unique',
      'name',
      'map',
      'type',
      'options',
    ]);
    expect(items.find((item) => item.label === 'map')?.textEdit).toEqual({
      range: {
        start: sourceFile.positionAt(cursorOffset - 'ma'.length),
        end: sourceFile.positionAt(cursorOffset),
      },
      newText: 'map: ',
    });

    expect(
      completeWithActualStack(
        ['model Post {', '  id Int @default(|)', '}'].join('\n'),
        stack,
      ).items.map((item) => item.label),
    ).toEqual(['true', 'false']);

    const mapCompletion = completeWithActualStack(
      ['model Post {', '  id Int @ma| // keep', '}'].join('\n'),
      stack,
      { clientSupportsSnippets: true },
    );
    const mapItem = completionItemByLabel(mapCompletion.items, 'map');
    expect(mapItem).toMatchObject({
      insertTextFormat: InsertTextFormat.Snippet,
      textEdit: { newText: `map("${emptySnippetPlaceholder1}")` },
    });
    expect(applyCompletionItem({ sourceFile: mapCompletion.sourceFile, item: mapItem })).toEqual(
      ['model Post {', `  id Int @map("${emptySnippetPlaceholder1}") // keep`, '}'].join('\n'),
    );

    const checkCompletion = completeWithActualStack(
      ['model Post {', '  id Int', '  @@che| // keep', '}'].join('\n'),
      stack,
      { clientSupportsSnippets: true },
    );
    const checkItem = completionItemByLabel(checkCompletion.items, 'check');
    expect(checkItem).toMatchObject({
      insertTextFormat: InsertTextFormat.Snippet,
      textEdit: { newText: `check(expression: "${emptySnippetPlaceholder1}")` },
    });
    expect(
      applyCompletionItem({ sourceFile: checkCompletion.sourceFile, item: checkItem }),
    ).toEqual(
      [
        'model Post {',
        '  id Int',
        `  @@check(expression: "${emptySnippetPlaceholder1}") // keep`,
        '}',
      ].join('\n'),
    );
  }, 5_000);

  it('uses actual Mongo attribute specs for names and dynamic factory keys', async () => {
    const stack = await actualMongoStack();

    expect(
      completeWithActualStack(['model Post {', '  id String @|', '}'].join('\n'), stack).items.map(
        (item) => item.label,
      ),
    ).toEqual(['id', 'map', 'relation', 'unique']);
    expect(
      completeWithActualStack(
        ['model Post {', '  id String', '  @@|', '}'].join('\n'),
        stack,
      ).items.map((item) => item.label),
    ).toEqual(['base', 'discriminator', 'index', 'map', 'textIndex', 'unique']);
    expect(
      completeWithActualStack(['enum Role {', '  Admin', '  @@|', '}'].join('\n'), stack).items.map(
        (item) => item.label,
      ),
    ).toEqual(['type']);

    expect(
      completeWithActualStack(
        [
          'namespace scoped {',
          '  model User {',
          '    id String',
          '    localOnly String',
          '    @@index(fields: [id], la|)',
          '  }',
          '}',
          'model User {',
          '  id String',
          '}',
        ].join('\n'),
        stack,
      ).items.map((item) => item.label),
    ).toEqual([
      'type',
      'sparse',
      'expireAfterSeconds',
      'filter',
      'include',
      'exclude',
      'default_language',
      'languageOverride',
      'collationLocale',
      'collationStrength',
      'collationCaseLevel',
      'collationCaseFirst',
      'collationNumericOrdering',
      'collationAlternate',
      'collationMaxVariable',
      'collationBackwards',
      'collationNormalization',
    ]);
    expect(
      completeWithActualStack(
        ['model Post {', '  author User @relation(name: "Author", f|)', '}'].join('\n'),
        stack,
      ).items.map((item) => item.label),
    ).toEqual(['fields', 'references']);

    const mapCompletion = completeWithActualStack(
      ['model Post {', '  id String @ma| // keep', '}'].join('\n'),
      stack,
      { clientSupportsSnippets: true },
    );
    const mapItem = completionItemByLabel(mapCompletion.items, 'map');
    expect(mapItem).toMatchObject({
      insertTextFormat: InsertTextFormat.Snippet,
      textEdit: { newText: `map("${emptySnippetPlaceholder1}")` },
    });
    expect(applyCompletionItem({ sourceFile: mapCompletion.sourceFile, item: mapItem })).toEqual(
      ['model Post {', `  id String @map("${emptySnippetPlaceholder1}") // keep`, '}'].join('\n'),
    );
  }, 5_000);

  it('returns stable bare model field type completion candidates', () => {
    const { items, sourceFile, cursorOffset } = complete(
      ['model Post {', '  author |', '}'].join('\n'),
    );

    expect(items.map((item) => item.label)).toEqual([
      'Boolean',
      'DateTime',
      'Int',
      'String',
      'Post',
      'User',
      'Address',
      'Email',
      'UserId',
      'auth',
    ]);
    expect(items.map((item) => item.detail)).toEqual([
      'Configured scalar type',
      'Configured scalar type',
      'Configured scalar type',
      'Configured scalar type',
      'Model',
      'Model',
      'Composite type',
      'Scalar type',
      'Type alias',
      'Namespace',
    ]);
    expect(items[0]?.textEdit).toEqual({
      range: {
        start: sourceFile.positionAt(cursorOffset),
        end: sourceFile.positionAt(cursorOffset),
      },
      newText: 'Boolean',
    });
  });

  it('returns the full bare candidate set with a replace range over the typed segment', () => {
    const { items, sourceFile, cursorOffset } = complete(
      ['model Post {', '  reviewer U|', '}'].join('\n'),
    );

    expect(items.map((item) => item.label)).toEqual([
      'Boolean',
      'DateTime',
      'Int',
      'String',
      'Post',
      'User',
      'Address',
      'Email',
      'UserId',
      'auth',
    ]);
    expect(items.find((item) => item.label === 'User')).toMatchObject({
      filterText: 'User',
      textEdit: {
        range: {
          start: sourceFile.positionAt(cursorOffset - 'U'.length),
          end: sourceFile.positionAt(cursorOffset),
        },
        newText: 'User',
      },
    });
  });

  it('returns the full bare candidate set including the namespace qualifier with a replace range over the typed segment', () => {
    const { items, sourceFile, cursorOffset } = complete(
      ['model Post {', '  reviewer a|', '}'].join('\n'),
    );

    expect(items.map((item) => item.label)).toEqual([
      'Boolean',
      'DateTime',
      'Int',
      'String',
      'Post',
      'User',
      'Address',
      'Email',
      'UserId',
      'auth',
    ]);
    expect(items.find((item) => item.label === 'auth')).toMatchObject({
      kind: CompletionItemKind.Module,
      detail: 'Namespace',
      filterText: 'auth',
      textEdit: {
        range: {
          start: sourceFile.positionAt(cursorOffset - 'a'.length),
          end: sourceFile.positionAt(cursorOffset),
        },
        newText: 'auth',
      },
    });
  });

  it('returns namespace members after a namespace qualifier', () => {
    const { items, sourceFile, cursorOffset } = complete(
      ['model Post {', '  owner auth.|', '}'].join('\n'),
    );

    expect(items.map((item) => item.label)).toEqual(['Account', 'User', 'Profile']);
    expect(items[0]?.textEdit).toEqual({
      range: {
        start: sourceFile.positionAt(cursorOffset),
        end: sourceFile.positionAt(cursorOffset),
      },
      newText: 'Account',
    });
  });

  it('returns the full namespace member set with replacement metadata for the typed segment', () => {
    const { items, sourceFile, cursorOffset } = complete(
      ['model Post {', '  owner auth.U|', '}'].join('\n'),
    );

    expect(items.map((item) => item.label)).toEqual(['Account', 'User', 'Profile']);
    expect(items.find((item) => item.label === 'User')).toMatchObject({
      filterText: 'User',
      detail: 'Model in namespace auth',
      textEdit: {
        range: {
          start: sourceFile.positionAt(cursorOffset - 'U'.length),
          end: sourceFile.positionAt(cursorOffset),
        },
        newText: 'User',
      },
    });
  });

  it('does not leak local namespace members into a foreign contract-space reference', () => {
    const { items } = complete(['model Post {', '  owner supabase:auth.P|', '}'].join('\n'));

    expect(items).toEqual([]);
  });

  it('returns no completions for a contract-space-qualified position', () => {
    const { items } = complete(['model Post {', '  external supabase:|', '}'].join('\n'));

    expect(items).toEqual([]);
  });

  it('returns no completions for a generic block value position', () => {
    const { items } = complete(['policy Rule {', '  on = |', '}'].join('\n'));

    expect(items).toEqual([]);
  });

  it('returns descriptor-backed generic block parameter completions', () => {
    const { items, sourceFile, cursorOffset } = complete(['policy Rule {', '  |', '}'].join('\n'));

    expect(items.map((item) => item.label)).toEqual(['on', 'where', 'mode', 'using']);
    expect(items.map((item) => item.detail)).toEqual([
      'Generic block parameter',
      'Generic block parameter',
      'Generic block parameter',
      'Generic block parameter',
    ]);
    expect(items[0]?.textEdit).toEqual({
      range: {
        start: sourceFile.positionAt(cursorOffset),
        end: sourceFile.positionAt(cursorOffset),
      },
      newText: 'on',
    });
  });

  it('returns the full descriptor-backed generic block parameter set excluding already-present sibling keys', () => {
    const { items, sourceFile, cursorOffset } = complete(
      ['policy Rule {', '  on = User', '  wh|', '}'].join('\n'),
    );

    expect(items.map((item) => item.label)).toEqual(['where', 'mode', 'using']);
    expect(items.find((item) => item.label === 'where')).toMatchObject({
      filterText: 'where',
      textEdit: {
        range: {
          start: sourceFile.positionAt(cursorOffset - 'wh'.length),
          end: sourceFile.positionAt(cursorOffset),
        },
        newText: 'where',
      },
    });
  });

  it('still offers the in-progress key while excluding an already-present sibling key', () => {
    const { items } = complete(['policy Rule {', '  where = "x"', '  on|', '}'].join('\n'));

    expect(items.map((item) => item.label)).toEqual(['on', 'mode', 'using']);
  });

  it('returns no generic block parameter completions without a matching descriptor', () => {
    const { items } = complete(['extension Rule {', '  |', '}'].join('\n'));

    expect(items).toEqual([]);
  });

  it('returns an empty list for unsupported classifier contexts', () => {
    const { items } = complete(['model Post {', '  // @|', '}'].join('\n'));

    expect(items).toEqual([]);
  });

  it('uses actual SQL enum metadata and rejects an empty enum without invented values', async () => {
    const stack = await actualSqlStack();
    const names = (schema: string) =>
      completeWithActualStack(schema, stack).items.map((item) => item.label);
    expect(names('enum Mood { Happy Sad }\nmodel Post { mood Mood @default(|) }')).toEqual([
      'Happy',
      'Sad',
    ]);
    expect(names('enum Mood {}\nmodel Post { mood Mood @default(|) }')).toEqual([]);
    expect(
      names(
        'enum Mood { Top }\nnamespace scoped { enum Mood { Scoped }\nmodel Post { mood scoped.Mood @default(|) } }',
      ),
    ).toEqual(['Scoped']);
  }, 5_000);

  it('uses actual adapter default-function signatures through the SQL factory', async () => {
    const stack = await actualSqlStack();
    const defaults = await importFromPackageRoot<ActualPostgresDefaultsModule>(
      '../../../3-targets/6-adapters/postgres/src/core/control-mutation-defaults.ts',
    );
    const options = {
      controlMutationDefaults: {
        ...controlMutationDefaults,
        defaultFunctionRegistry: defaults.createPostgresDefaultFunctionRegistry(),
      },
    };
    const source = (args: string) => `model Post { value String @default(${args}) }`;
    const candidates = completeWithActualStack(source('|'), stack, options).items;
    expect(candidates.map((item) => item.label)).toEqual([
      'true',
      'false',
      'autoincrement',
      'now',
      'uuid',
      'cuid',
      'ulid',
      'nanoid',
      'dbgenerated',
    ]);
    expect(
      completeWithActualStack(source('uuid(|)'), stack, options).items.map((item) => item.label),
    ).toEqual(['4', '7']);
    expect(
      completeWithActualStack(source('cuid(|)'), stack, options).items.map((item) => item.label),
    ).toEqual(['2']);
    expect(completeWithActualStack(source('nanoid(|)'), stack, options).items).toEqual([]);
    expect(completeWithActualStack(source('dbgenerated(|)'), stack, options).items).toEqual([]);
    const snippetItems = completeWithActualStack(source('|'), stack, {
      ...options,
      clientSupportsSnippets: true,
    }).items;
    expect(completionItemByLabel(snippetItems, 'uuid').textEdit?.newText).toBe('uuid()');
    expect(completionItemByLabel(snippetItems, 'cuid').textEdit?.newText).toBe(
      `cuid(${emptySnippetPlaceholder1})`,
    );
    expect(completionItemByLabel(snippetItems, 'dbgenerated').textEdit?.newText).toBe(
      `dbgenerated("${emptySnippetPlaceholder1}")`,
    );
  }, 5_000);

  it('uses distinct local and referenced fields through actual SQL relation specs', async () => {
    const stack = await actualSqlStack();
    const schema = (args: string) =>
      `model Target { topOnly Int }\nnamespace remote { model Target { remoteOnly Int } }\nmodel Owner { ownOnly Int\n relation remote.Target @relation(${args}) }`;
    expect(
      completeWithActualStack(schema('fields: [|]'), stack).items.map((item) => item.label),
    ).toEqual(['ownOnly', 'relation']);
    expect(
      completeWithActualStack(schema('references: [|]'), stack).items.map((item) => item.label),
    ).toEqual(['remoteOnly']);
    expect(
      completeWithActualStack(schema('onDelete: |'), stack).items.map((item) => item.label),
    ).toEqual(['NoAction', 'Restrict', 'Cascade', 'SetNull', 'SetDefault']);
  }, 5_000);

  it('uses actual Mongo field-named functions and keeps distinct snippet edits', async () => {
    const stack = await actualMongoStack();
    const schema = (args: string) => `model Post { title String\n slug String\n @@index(${args}) }`;
    const plain = completeWithActualStack(schema('[|]'), stack).items;
    expect(plain.map((item) => item.label)).toEqual(['title', 'slug', 'wildcard']);
    const snippets = completeWithActualStack(schema('[|]'), stack, {
      clientSupportsSnippets: true,
    }).items;
    expect(snippets.map((item) => [item.label, item.textEdit?.newText])).toEqual([
      ['title', 'title'],
      ['slug', 'slug'],
      ['wildcard', 'wildcard()'],
      ['title', `title(sort: ${emptySnippetPlaceholder1})`],
      ['slug', `slug(sort: ${emptySnippetPlaceholder1})`],
    ]);
    expect(
      completeWithActualStack(schema('[title(|)]'), stack).items.map((item) => item.label),
    ).toEqual(['sort']);
    expect(
      completeWithActualStack(schema('[title(sort: |)]'), stack).items.map((item) => item.label),
    ).toEqual(['Asc', 'Desc']);
    expect(completeWithActualStack(schema('[wildcard(|)]'), stack).items).toEqual([]);
    expect(
      completeWithActualStack(schema('[title], type: |'), stack).items.map((item) => item.label),
    ).toEqual(['1', '-1', '"text"', '"2dsphere"', '"2d"', '"hashed"']);
  }, 5_000);

  it('scopes actual Mongo dynamic function names to the declaring namespace model', async () => {
    const stack = await actualMongoStack();
    const schema =
      'model Post { topOnly String }\nnamespace scoped { model Post { scopedOnly String\n @@index([|]) } }';
    expect(
      completeWithActualStack(schema, stack, { clientSupportsSnippets: true }).items.map((item) => [
        item.label,
        item.textEdit?.newText,
      ]),
    ).toEqual([
      ['scopedOnly', 'scopedOnly'],
      ['wildcard', 'wildcard()'],
      ['scopedOnly', `scopedOnly(sort: ${emptySnippetPlaceholder1})`],
    ]);
  }, 5_000);

  it('does not return generic block symbols as model field type candidates', () => {
    const { items } = complete(['model Post {', '  audit |', '}'].join('\n'));

    expect(items.map((item) => item.label)).not.toContain('Audit');
    expect(items.map((item) => item.label)).not.toContain('auth.ScopedAudit');
  });
});
