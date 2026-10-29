import { EMPTY_GENERATOR_FUNCTIONS } from '@internal/framework-components/components';
import { assembleAuthoringContributions } from '@internal/framework-components/control';
import {
  buildSymbolTable,
  type FieldAttributeSpecContext,
  fieldAttribute,
} from '@internal/psl-parser';
import { parse } from '@internal/psl-parser/syntax';
import { describe, expect, it } from 'vitest';
import { CompletionItemKind, InsertTextFormat } from 'vscode-languageserver';
import { classifyPslCompletionContext } from '../src/completion-context';
import { providePslCompletionItems } from '../src/completion-provider';
import { testBinder } from './helpers/binder';
import {
  actualMongoStack,
  actualSqlStack,
  applyCompletionItem,
  attributeContributions,
  candidateSource,
  complete,
  completeWithActualStack,
  completionItemByLabel,
  controlMutationDefaults,
  pslBlockDescriptors,
  scalarTypes,
  sqlExpressionDataTypes,
  sqlExpressionSnippet,
} from './helpers/completion-provider';

describe('providePslCompletionItems', () => {
  it('returns registry-backed attribute name completions as function items', () => {
    const fieldItems = complete(['model Post {', '  id Int @|', '}'].join('\n')).items;
    expect(fieldItems.map((item) => item.label)).toEqual(['marker', 'orderFixture', 'ownerAware']);
    expect(fieldItems.find((item) => item.label === 'marker')?.detail).toBe(
      'Attaches a named marker to a target.',
    );
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

  it('resolves the attribute owner without enumerating declarations', () => {
    const markedSource = ['model User {', '  id Int @|', '}'].join('\n');
    const cursorOffset = markedSource.indexOf('|');
    const source = `${markedSource.slice(0, cursorOffset)}${markedSource.slice(cursorOffset + 1)}`;
    const { document, sources } = parse(source, 'language-server-test.psl');
    const sourceFile = sources.sourceFileFor(document.syntax);
    const { symbolTable } = buildSymbolTable({
      documents: [document],
      sources,
      defaultNamespaceId: 'public',
    });
    const context = classifyPslCompletionContext({
      document,
      sourceFile,
      position: sourceFile.positionAt(cursorOffset),
    });
    let modelEnumerationCount = 0;
    const observedDefaultNamespace = {
      ...symbolTable.defaultNamespace,
      models: new Proxy(symbolTable.defaultNamespace.models, {
        ownKeys(target) {
          modelEnumerationCount += 1;
          return Reflect.ownKeys(target);
        },
      }),
    };
    const observedSymbolTable = {
      ...symbolTable,
      defaultNamespace: observedDefaultNamespace,
      namespaces: { [observedDefaultNamespace.id]: observedDefaultNamespace },
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
                return fieldAttribute('first', {
                  documentation: 'Marks the first contributed field attribute.',
                });
              },
              second: (ctx: FieldAttributeSpecContext) => {
                factoryOwnerNames.push(ctx.model.name);
                return fieldAttribute('second', {
                  documentation: 'Marks the second contributed field attribute.',
                });
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
        binder: testBinder({
          sources,
          symbolTable,
          scalarTypes,
          authoringContributions: attributeContributions,
          controlMutationDefaults,
          pslBlockDescriptors,
        }),
        authoringContributions: observedAuthoringContributions,
        controlMutationDefaults,
        generatorFunctions: EMPTY_GENERATOR_FUNCTIONS,
      },
      clientSupportsSnippets: true,
    });

    expect(items.map((item) => item.label)).toEqual(['first', 'second']);
    expect(factoryOwnerNames).toEqual(['User', 'User']);
    expect(modelEnumerationCount).toBe(0);
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
        newText: `marker("\${1:target}", name: "\${2:name}")`,
      },
    });
    expect(applyCompletionItem({ sourceFile, item })).toEqual(
      [
        candidateSource,
        'model Post {',
        `  id Int @marker("\${1:target}", name: "\${2:name}") // keep`,
        '}',
      ].join('\n'),
    );
  });

  it.each([false, true])('gates argument snippet hints on client support: %s', (supported) => {
    for (const [source, snippets, hints] of [
      ['model Post { id Int @mar| }', true, true],
      ['model Post { id Int @mar| }', false, false],
      ['model Post { id Int @mar|ker("x") }', true, false],
      ['|', true, false],
    ] as const) {
      const { items } = complete(source, {
        clientSupportsSnippets: snippets,
        clientSupportsTriggerParameterHintsCommand: supported,
      });
      const item = completionItemByLabel(items, source === '|' ? 'model' : 'marker');
      expect(item.command).toEqual(
        supported && hints
          ? { title: 'Show argument hints', command: 'editor.action.triggerParameterHints' }
          : undefined,
      );
    }
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
    ).toEqual(['default', 'id', 'map', 'onCreate', 'onUpdate', 'relation', 'unique']);
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
      ['model Post {', '  id Int', '  @@index(expression: sql`lower(name)`, ma|)', '}'].join('\n'),
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
    ).toEqual(['true', 'false', 'null']);

    const mapCompletion = completeWithActualStack(
      ['model Post {', '  id Int @ma| // keep', '}'].join('\n'),
      stack,
      { clientSupportsSnippets: true },
    );
    const mapItem = completionItemByLabel(mapCompletion.items, 'map');
    expect(mapItem).toMatchObject({
      insertTextFormat: InsertTextFormat.Snippet,
      textEdit: { newText: `map("\${1:name}")` },
    });
    expect(applyCompletionItem({ sourceFile: mapCompletion.sourceFile, item: mapItem })).toEqual(
      ['model Post {', `  id Int @map("\${1:name}") // keep`, '}'].join('\n'),
    );

    const checkCompletion = completeWithActualStack(
      ['model Post {', '  id Int', '  @@che| // keep', '}'].join('\n'),
      stack,
      { clientSupportsSnippets: true, dataTypes: await sqlExpressionDataTypes() },
    );
    const checkItem = completionItemByLabel(checkCompletion.items, 'check');
    expect(checkItem).toMatchObject({
      insertTextFormat: InsertTextFormat.Snippet,
      textEdit: { newText: `check(expression: ${sqlExpressionSnippet})` },
    });
    expect(
      applyCompletionItem({ sourceFile: checkCompletion.sourceFile, item: checkItem }),
    ).toEqual(
      [
        'model Post {',
        '  id Int',
        `  @@check(expression: ${sqlExpressionSnippet}) // keep`,
        '}',
      ].join('\n'),
    );
  }, 5_000);

  it('offers a sql literal where @@index and @@check take SQL', async () => {
    const stack = await actualSqlStack();
    const dataTypes = await sqlExpressionDataTypes();
    const [entry] = Object.values(dataTypes);
    const valuesAt = (attribute: string) =>
      completeWithActualStack(
        ['model Post {', '  id Int', `  ${attribute}`, '}'].join('\n'),
        stack,
        {
          clientSupportsSnippets: true,
          dataTypes,
        },
      ).items.map((item) => ({
        label: item.label,
        detail: item.detail,
        newText: item.textEdit?.newText,
        insertTextFormat: item.insertTextFormat,
      }));
    const sqlItem = {
      label: 'sql',
      detail: entry?.documentation,
      newText: 'sql`$1`',
      insertTextFormat: InsertTextFormat.Snippet,
    };

    expect(valuesAt('@@index([id], where: |)')).toEqual([sqlItem]);
    expect(valuesAt('@@index(expression: |, map: "post_idx")')).toEqual([sqlItem]);
    expect(valuesAt('@@check(expression: |, name: "post_check")')).toEqual([sqlItem]);
  }, 5_000);

  it('completes model and field attributes when the source has no data types', async () => {
    const stack = await actualSqlStack();
    const labelsAt = (markedSource: string) =>
      completeWithActualStack(markedSource, stack).items.map((item) => item.label);

    expect(labelsAt(['model Post {', '  id Int', '  @@|', '}'].join('\n'))).toEqual([
      'base',
      'check',
      'control',
      'discriminator',
      'id',
      'index',
      'map',
      'unique',
    ]);
    expect(labelsAt(['model Post {', '  id Int @|', '}'].join('\n'))).toEqual([
      'default',
      'id',
      'map',
      'onCreate',
      'onUpdate',
      'relation',
      'unique',
    ]);
    expect(
      labelsAt(['model Post {', '  id Int', '  @@check(expression: |)', '}'].join('\n')),
    ).toEqual([]);
  }, 5_000);

  it('uses actual Mongo attribute specs for names and dynamic factory keys', async () => {
    const stack = await actualMongoStack();

    expect(
      completeWithActualStack(['model Post {', '  id String @|', '}'].join('\n'), stack).items.map(
        (item) => item.label,
      ),
    ).toEqual(['id', 'map', 'onCreate', 'onUpdate', 'relation', 'unique']);
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
      textEdit: { newText: `map("\${1:name}")` },
    });
    expect(applyCompletionItem({ sourceFile: mapCompletion.sourceFile, item: mapItem })).toEqual(
      ['model Post {', `  id String @map("\${1:name}") // keep`, '}'].join('\n'),
    );
  }, 5_000);
});
