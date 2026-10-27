import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type {
  AuthoringContributions,
  AuthoringEntityTypeNamespace,
  AuthoringPslBlockDescriptorNamespace,
  AuthoringTypeNamespace,
  DataTypeAuthoringEntry,
  DataTypeSupport,
} from '@internal/framework-components/authoring';
import { createDataTypeLookup, dataType } from '@internal/framework-components/codec';
import {
  EMPTY_GENERATOR_FUNCTIONS,
  type GeneratorFunctionRegistry,
} from '@internal/framework-components/components';

import {
  assembleAuthoringContributions,
  assembleControlMutationDefaults,
  type ControlMutationDefaultRegistry,
} from '@internal/framework-components/control';
import {
  type AttributeSpecNamespace,
  type BlockSpecContext,
  blockAttribute,
  buildSymbolTable,
  EMPTY_DATA_TYPES,
  entityRef,
  type FieldAttributeSpecContext,
  type FuncCallSig,
  fieldAttribute,
  identifier,
  int,
  jsonValue,
  mapBlock,
  modelAttribute,
  oneOf,
  optional,
  str,
  structBlock,
} from '@internal/psl-parser';
import { parse, type SourceFile } from '@internal/psl-parser/syntax';
import { timeouts } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import {
  type CompletionItem,
  CompletionItemKind,
  CompletionItemTag,
  InsertTextFormat,
} from 'vscode-languageserver';
import { classifyPslCompletionContext } from '../src/completion-context';
import { providePslCompletionItems } from '../src/completion-provider';
import { renderSignatureLabel, resolveSignatureParameters } from '../src/signature-help';
import { testBinder } from './helpers/binder';

const scalarTypes = ['String', 'Int', 'Boolean', 'DateTime'] as const;
const nameSnippetPlaceholder = '$' + '{1:Name}';
const emptySnippetPlaceholder1 = '$' + '{1:}';
const sqlExpressionSnippet = 'sql`$' + '{1:expression}`';
const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const markerAttribute = fieldAttribute('marker', {
  documentation: 'Attaches a named marker to a target.',
  positional: [{ key: 'target', type: str(), documentation: 'The marker target.' }],
  named: {
    name: { type: str(), documentation: 'The marker name.' },
    priority: { type: optional(int()), documentation: 'The marker priority.' },
  },
});
const orderFixtureAttribute = fieldAttribute('orderFixture', {
  documentation: 'Accepts named values in declaration order rather than alphabetical order.',
  named: {
    zebra: { type: int(), documentation: 'The first declared value.' },
    alpha: { type: int(), documentation: 'The second declared value.' },
    middle: { type: int(), documentation: 'The third declared value.' },
  },
});
const rlsAttribute = modelAttribute('rls', {
  documentation: 'Configures row-level security for this model.',
  named: {
    enabled: { type: optional(str()), documentation: 'The security enablement setting.' },
    mode: { type: str(), documentation: 'The security mode.' },
  },
});
const auditAttribute = blockAttribute('audit', {
  documentation: 'Configures auditing for this block.',
  named: {
    reason: { type: optional(str()), documentation: 'The reason for auditing.' },
    level: { type: int(), documentation: 'The audit level.' },
  },
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
              documentation: 'Selects a key based on the declaring model’s fields.',
              named: {
                [Object.hasOwn(ctx.model.fields, 'scopedOnly') ? 'scopedKey' : 'topKey']: {
                  type: str(),
                  documentation: 'The value for the owner-specific key.',
                },
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
const policySpec = () =>
  structBlock({
    parameters: {
      on: { type: optional(entityRef({ kind: 'model' })), documentation: '' },
      where: { type: optional(str()), documentation: 'The policy predicate.' },
      mode: {
        type: optional(
          oneOf(
            identifier('permissive', { documentation: 'Combined with OR.' }),
            identifier('restrictive', { documentation: 'Combined with AND.' }),
          ),
        ),
        documentation: '',
      },
      using: { type: optional(str()), documentation: '' },
    },
  });

const pslBlockDescriptors: AuthoringPslBlockDescriptorNamespace = {
  policy: {
    kind: 'pslBlock',
    keyword: 'policy',
    documentation: 'Defines a security policy.',
    discriminator: 'fixture-policy',
    name: { required: true },
    spec: policySpec,
    attributes: { audit: () => auditAttribute },
  },
  inventory: {
    kind: 'pslBlock',
    keyword: 'inventory',
    documentation: 'An arbitrary-key block.',
    discriminator: 'fixture-inventory',
    name: { required: true },
    spec: () =>
      mapBlock({
        value: { type: jsonValue(), documentation: 'The entry value.' },
        allowBare: true,
      }),
  },
  access: {
    audit: {
      kind: 'pslBlock',
      keyword: 'audit',
      discriminator: 'fixture-audit',
      name: { required: true },
      spec: () =>
        structBlock({
          parameters: {
            on: { type: optional(entityRef({ kind: 'model' })), documentation: '' },
          },
        }),
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
  options: {
    readonly clientSupportsSnippets?: boolean;
    readonly clientSupportsTriggerParameterHintsCommand?: boolean;
  } = {},
) {
  return completeWithSource({
    markedSource: `${candidateSource}\n${markedFieldSource}`,
    pslBlockDescriptors,
    authoringContributions: attributeContributions,
    controlMutationDefaults,
    clientSupportsSnippets: options.clientSupportsSnippets === true,
    clientSupportsTriggerParameterHintsCommand:
      options.clientSupportsTriggerParameterHintsCommand === true,
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

interface ActualPostgresDataTypesModule {
  postgresDataTypeEntries(): Readonly<Record<string, DataTypeAuthoringEntry>>;
}

interface ActualSqliteDataTypesModule {
  sqliteDataTypeEntries(): Readonly<Record<string, DataTypeAuthoringEntry>>;
}

interface ActualSqlExpressionModule {
  readonly sqlExpressionRegistration: {
    readonly authoring: {
      readonly dataTypes: Readonly<Record<string, DataTypeAuthoringEntry>>;
    };
  };
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
  readonly siblings?: readonly string[];
  readonly pslBlockDescriptors: AuthoringPslBlockDescriptorNamespace;
  readonly authoringContributions?: typeof attributeContributions;
  readonly controlMutationDefaults?: typeof controlMutationDefaults;
  readonly dataTypes?: DataTypeSupport;
  readonly clientSupportsSnippets?: boolean;
  readonly clientSupportsTriggerSuggestCommand?: boolean;
  readonly clientSupportsTriggerParameterHintsCommand?: boolean;
  readonly scalarTypes?: readonly string[];
  readonly generatorFunctions?: GeneratorFunctionRegistry;
}) {
  const cursorOffset = input.markedSource.indexOf('|');
  expect(cursorOffset).toBeGreaterThanOrEqual(0);
  const source = `${input.markedSource.slice(0, cursorOffset)}${input.markedSource.slice(cursorOffset + 1)}`;
  const parsed = parse(source, 'language-server-test.psl');
  const { document } = parsed;
  const others = (input.siblings ?? []).map((text, index) => parse(text, `sibling-${index}.psl`));
  const sources = parsed.sources.merge(...others.map((other) => other.sources));
  const sourceFile = sources.sourceFileFor(document.syntax);
  const { symbolTable } = buildSymbolTable({
    documents: [...others.map((other) => other.document), document],
    sources,
    defaultNamespaceId: 'public',
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
        binder: testBinder({
          ...input,
          sources,
          symbolTable,
          scalarTypes: input.scalarTypes ?? scalarTypes,
        }),
        scalarTypes: input.scalarTypes ?? scalarTypes,
        pslBlockDescriptors: input.pslBlockDescriptors,
        symbolTable,
        ...(input.authoringContributions === undefined
          ? {}
          : { authoringContributions: input.authoringContributions }),
        ...(input.controlMutationDefaults === undefined
          ? {}
          : { controlMutationDefaults: input.controlMutationDefaults }),
        ...(input.dataTypes === undefined ? {} : { dataTypes: input.dataTypes }),
        generatorFunctions: input.generatorFunctions ?? EMPTY_GENERATOR_FUNCTIONS,
      },
      clientSupportsSnippets: input.clientSupportsSnippets === true,
      clientSupportsTriggerSuggestCommand: input.clientSupportsTriggerSuggestCommand === true,
      clientSupportsTriggerParameterHintsCommand:
        input.clientSupportsTriggerParameterHintsCommand === true,
    }),
    sourceFile,
    cursorOffset,
  };
}

async function actualSqlStack(): Promise<CompletionTestStack> {
  const [attributes, blocks] = await Promise.all([
    importFromPackageRoot<ActualSqlAttributeModule>(
      '../../../2-sql-family/2-authoring/contract-psl/src/sql-attribute-specs.ts',
    ),
    importFromPackageRoot<ActualSqlBlockModule>(
      '../../../2-sql-family/9-family/src/core/authoring-entity-types.ts',
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

const fixtureInt = dataType('fixture/int', { read: (json) => json });
const fixtureExpression = dataType('fixture/expression', { read: (json) => json });
const constructorArgumentDataTypes: DataTypeSupport = {
  entries: {
    [fixtureInt.id]: {
      written: {
        kind: 'plain',
        syntax: 'number',
        types: [fixtureInt.id],
        classify: (text) => ({ type: fixtureInt.id, value: Number(text) }),
      },
      print: String,
      documentation: 'A whole number.',
    },
    [fixtureExpression.id]: {
      written: { kind: 'tag', tag: 'sql', parse: (text) => text },
      print: String,
      documentation: 'A SQL expression.',
    },
  },
  lookup: createDataTypeLookup([fixtureInt, fixtureExpression]),
  dataTypeOfCodec: () => undefined,
};

async function sqlExpressionDataTypes(): Promise<Readonly<Record<string, DataTypeAuthoringEntry>>> {
  const family = await importFromPackageRoot<ActualSqlExpressionModule>(
    '../../../2-sql-family/1-core/contract/src/exports/sql-expression.ts',
  );
  return family.sqlExpressionRegistration.authoring.dataTypes;
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
    readonly dataTypes?: Readonly<Record<string, DataTypeAuthoringEntry>>;
  } = {},
) {
  return completeWithSource({
    markedSource,
    pslBlockDescriptors: stack.pslBlockDescriptors,
    authoringContributions: actualAuthoringContributions(stack),
    ...(options.dataTypes === undefined
      ? {}
      : {
          dataTypes: {
            entries: options.dataTypes,
            lookup: createDataTypeLookup([]),
            dataTypeOfCodec: () => undefined,
          },
        }),
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
  it('filters candidates after nearest-name shadowing and includes namespace locals', () => {
    const { items } = completeWithSource({
      pslBlockDescriptors,
      markedSource: `model Shared { id Int }
model ZRoot { id Int }
type ZAddress { value String }
namespace app {
  enum Shared { VALUE }
  model Int { id String }
  model Local { value | }
  type Address { value String }
}
namespace other { model Hidden { id Int } }`,
    });
    expect(items.map(({ label, detail }) => [label, detail]).sort()).toEqual([
      ['Address', 'Composite type'],
      ['Boolean', 'Configured scalar type'],
      ['DateTime', 'Configured scalar type'],
      ['Int', 'Model'],
      ['Local', 'Model'],
      ['String', 'Configured scalar type'],
      ['ZAddress', 'Composite type'],
      ['ZRoot', 'Model'],
      ['app', 'Namespace'],
      ['other', 'Namespace'],
      ['public', 'Namespace'],
    ]);
    expect(items.find(({ label }) => label === 'Int')?.kind).toBe(CompletionItemKind.Class);
  });

  it('enumerates only contributed members for a qualified completion', () => {
    const { items } = completeWithSource({
      markedSource: 'model Top { id Int }\nmodel Owner { value custom.| }',
      pslBlockDescriptors: {},
      authoringContributions: assembleAuthoringContributions([
        {
          id: 'constructors',
          authoring: {
            type: {
              custom: {
                Value: {
                  kind: 'typeConstructor',
                  documentation: 'Custom value',
                  output: { codecId: 'value' },
                },
              },
            },
          },
        },
      ]),
    });
    expect(items.map(({ label, kind, detail }) => ({ label, kind, detail }))).toEqual([
      { label: 'Value', kind: CompletionItemKind.Class, detail: 'Custom value' },
    ]);
  });

  it.each([false, true])('inserts namespace dots with negotiated suggestions: %s', (supported) => {
    for (const qualifier of ['', 'custom.']) {
      const { items } = completeWithSource({
        markedSource: `namespace local {}\nmodel Owner { value ${qualifier}| }`,
        pslBlockDescriptors: {},
        clientSupportsSnippets: supported,
        clientSupportsTriggerSuggestCommand: supported,
        authoringContributions: assembleAuthoringContributions([
          { id: 'namespaces', authoring: { type: { custom: { nested: {} } } } },
        ]),
      });
      for (const label of qualifier === '' ? ['local', 'custom'] : ['nested']) {
        const item = completionItemByLabel(items, label);
        expect({
          label: item.label,
          kind: item.kind,
          filterText: item.filterText,
          newText: item.textEdit?.newText,
          format: item.insertTextFormat,
          command: item.command,
        }).toEqual({
          label,
          kind: CompletionItemKind.Module,
          filterText: label,
          newText: `${label}.`,
          format: undefined,
          command: supported
            ? { title: 'Suggest namespace members', command: 'editor.action.triggerSuggest' }
            : undefined,
        });
      }
    }
  });

  it.each([false, true])(
    'renders scalar and constructor presentations with snippets: %s',
    (snippets) => {
      const types: AuthoringTypeNamespace = {
        Scalar: {
          kind: 'typeConstructor',
          output: { codecId: 'fixture/value' },
        },
        Deprecated: {
          kind: 'typeConstructor',
          deprecated: { replacement: 'Scalar' },
          output: { codecId: 'fixture/value' },
        },
        Empty: {
          kind: 'typeConstructor',
          args: [],
          output: { codecId: 'fixture/value' },
        },
        Required: {
          kind: 'typeConstructor',
          args: [
            { name: 'size', kind: 'value', dataType: 'fixture/int' },
            { name: 'label', kind: 'value', dataType: 'fixture/expression' },
            { name: 'scale', kind: 'value', dataType: 'fixture/int', optional: true },
          ],
          output: { codecId: 'fixture/value' },
        },
        Optional: {
          kind: 'typeConstructor',
          args: [{ name: 'size', kind: 'value', dataType: 'fixture/int', optional: true }],
          output: { codecId: 'fixture/value' },
        },
        Entity: {
          kind: 'typeConstructor',
          entityRefArg: { index: 0, entityKind: 'choice' },
          output: { codecId: 'fixture/value' },
        },
      };
      for (const qualifier of ['', 'custom.']) {
        const { items } = completeWithSource({
          markedSource: `model Owner { value ${qualifier}| }`,
          pslBlockDescriptors: {},
          scalarTypes: [],
          clientSupportsSnippets: snippets,
          authoringContributions: assembleAuthoringContributions([
            { id: 'constructors', authoring: { type: { ...types, custom: types } } },
          ]),
          dataTypes: constructorArgumentDataTypes,
        });
        for (const [label, snippet] of [
          ['Scalar', 'Scalar'],
          ['Deprecated', 'Deprecated'],
          ['Empty', 'Empty()'],
          ['Required', 'Required($' + '{1:size}, sql`$' + '{2:label}`)'],
          ['Optional', 'Optional($' + '{1:})'],
          ['Entity', 'Entity($' + '{1:choice})'],
        ] as const) {
          const item = completionItemByLabel(items, label);
          const callable = label !== 'Scalar' && label !== 'Deprecated';
          expect({
            label: item.label,
            kind: item.kind,
            newText: item.textEdit?.newText,
            format: item.insertTextFormat,
            command: item.command,
            tags: item.tags,
          }).toEqual({
            label,
            kind: callable ? CompletionItemKind.Function : CompletionItemKind.Class,
            newText: snippets ? snippet : callable ? `${label}()` : label,
            format: callable && snippets ? InsertTextFormat.Snippet : undefined,
            command: undefined,
            tags: label === 'Deprecated' ? [CompletionItemTag.Deprecated] : undefined,
          });
        }
      }
    },
  );

  it('renders a contributed type alias as a type with its documentation', () => {
    const now = { name: 'now', args: {} } as const;
    const { items } = completeWithSource({
      markedSource: 'model Owner { value temporal.| }',
      pslBlockDescriptors: {},
      scalarTypes: [],
      clientSupportsSnippets: true,
      authoringContributions: assembleAuthoringContributions([
        {
          id: 'aliases',
          authoring: {
            type: {
              temporal: {
                CreatedAt: {
                  kind: 'typeAlias',
                  documentation: 'Set to now when a row is created.',
                  output: { type: { codecId: 'fixture/value' }, onCreate: now },
                },
                UpdatedAt: {
                  kind: 'typeAlias',
                  output: { type: { codecId: 'fixture/value' }, onCreate: now, onUpdate: now },
                },
              },
            },
          },
        },
      ]),
    });
    expect(
      items.map((item) => ({
        label: item.label,
        kind: item.kind,
        detail: item.detail,
        newText: item.textEdit?.newText,
        format: item.insertTextFormat,
      })),
    ).toEqual([
      {
        label: 'CreatedAt',
        kind: CompletionItemKind.Class,
        detail: 'Set to now when a row is created.',
        newText: 'CreatedAt',
        format: undefined,
      },
      {
        label: 'UpdatedAt',
        kind: CompletionItemKind.Class,
        detail: 'Type alias',
        newText: 'UpdatedAt',
        format: undefined,
      },
    ]);
  });

  it('does not complete a global namespace when its qualifier is shadowed locally', () => {
    const { items } = complete(`namespace remote { model Item { id Int } }
namespace app {
  model remote { id Int }
  model Owner { value remote.| }
}`);
    expect(items).toEqual([]);
  });

  it('returns document-level declaration keyword candidates with stable plain-text edits', () => {
    const { items, sourceFile, cursorOffset } = complete('|');

    expect(items.map((item) => item.label)).toEqual([
      'model',
      'model mixin',
      'type',
      'type mixin',
      'types',
      'namespace',
      'audit',
      'audit mixin',
      'inventory',
      'inventory mixin',
      'policy',
      'policy mixin',
    ]);
    expect(items.map((item) => item.detail)).toEqual([
      'Defines a data model.',
      'Declares a mixin for model blocks.',
      'Defines a reusable composite type.',
      'Declares a mixin for type blocks.',
      'Defines reusable type aliases.',
      'Groups declarations belonging to the same database schema or database.',
      'Generic block keyword',
      'Declares a mixin for audit blocks.',
      'An arbitrary-key block.',
      'Declares a mixin for inventory blocks.',
      'Defines a security policy.',
      'Declares a mixin for policy blocks.',
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
      'model mixin',
      'type',
      'type mixin',
      'types',
      'namespace',
      'audit',
      'audit mixin',
      'inventory',
      'inventory mixin',
      'policy',
      'policy mixin',
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

    expect(items.map((item) => item.label)).toEqual([
      'model',
      'model mixin',
      'type',
      'type mixin',
      'audit',
      'audit mixin',
      'inventory',
      'inventory mixin',
      'policy',
      'policy mixin',
    ]);
    expect(items.map((item) => item.label)).not.toContain('types');
    expect(items.map((item) => item.label)).not.toContain('namespace');
  });

  it('returns the full namespace-body declaration keyword set with a replace range over the typed segment', () => {
    const { items, sourceFile, cursorOffset } = complete(
      ['namespace feature {', '  po|', '}'].join('\n'),
    );

    expect(items.map((item) => item.label)).toEqual([
      'model',
      'model mixin',
      'type',
      'type mixin',
      'audit',
      'audit mixin',
      'inventory',
      'inventory mixin',
      'policy',
      'policy mixin',
    ]);
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
      textEdit: { newText: `model ${nameSnippetPlaceholder} {\n  \${0:// Fields}\n}` },
    });
    expect(items.find((item) => item.label === 'policy')).toMatchObject({
      insertTextFormat: InsertTextFormat.Snippet,
      textEdit: {
        newText: `policy ${nameSnippetPlaceholder} {\n  \${0:// Block keys and attributes}\n}`,
      },
    });
  });

  it.each([true, false])(
    'inserts a body placeholder without pre-filled keys, snippets=%s',
    (snippets) => {
      const { items } = completeWithSource({
        markedSource: '|',
        clientSupportsSnippets: snippets,
        pslBlockDescriptors: {
          security: {
            policy: {
              kind: 'pslBlock',
              keyword: 'policy',
              discriminator: 'policy',
              name: { required: true },
              spec: policySpec,
              attributes: { audit: () => auditAttribute },
            },
          },
        },
      });
      const item = completionItemByLabel(items, 'policy');
      expect(item.textEdit?.newText).toBe(
        snippets
          ? [
              `policy ${nameSnippetPlaceholder} {`,
              '  $' + '{0:// Block keys and attributes}',
              '}',
            ].join('\n')
          : 'policy ',
      );
      expect(item.insertTextFormat).toBe(snippets ? InsertTextFormat.Snippet : undefined);
    },
  );

  describe('mixin declaration items', () => {
    const sortedLabels = (items: readonly CompletionItem[]) =>
      [...items]
        .sort((left, right) => ((left.sortText ?? '') < (right.sortText ?? '') ? -1 : 1))
        .map((item) => item.label);

    it('offers model before model mixin when a prefix of the keyword is typed', () => {
      const { items, sourceFile, cursorOffset } = complete('mo|');
      const range = {
        start: sourceFile.positionAt(cursorOffset - 'mo'.length),
        end: sourceFile.positionAt(cursorOffset),
      };

      expect(sortedLabels(items).slice(0, 2)).toEqual(['model', 'model mixin']);
      expect(completionItemByLabel(items, 'model mixin')).toMatchObject({
        kind: CompletionItemKind.Keyword,
        detail: 'Declares a mixin for model blocks.',
        filterText: 'model mixin',
        sortText: '0:model mixin',
        textEdit: { range, newText: 'model mixin ' },
      });
    });

    it('sorts each mixin item directly after the item of its keyword', () => {
      expect(sortedLabels(complete('|').items)).toEqual([
        'model',
        'model mixin',
        'namespace',
        'type',
        'type mixin',
        'types',
        'audit',
        'audit mixin',
        'inventory',
        'inventory mixin',
        'policy',
        'policy mixin',
      ]);
    });

    it('offers no mixin item for namespace or types, and never the word mixin alone', () => {
      const labels = complete('|').items.map((item) => item.label);

      expect(labels).not.toContain('namespace mixin');
      expect(labels).not.toContain('types mixin');
      expect(labels).not.toContain('mixin');
    });

    it('inserts a mixin declaration with an empty body for a native and for a struct block keyword', () => {
      const { items } = completeWithSource({
        markedSource: '|',
        clientSupportsSnippets: true,
        pslBlockDescriptors: {
          security: {
            policy: {
              kind: 'pslBlock',
              keyword: 'policy',
              discriminator: 'policy',
              name: { required: true },
              spec: policySpec,
              attributes: { audit: () => auditAttribute },
            },
          },
        },
      });

      expect(completionItemByLabel(items, 'model mixin')).toMatchObject({
        insertTextFormat: InsertTextFormat.Snippet,
        textEdit: { newText: `model mixin ${nameSnippetPlaceholder} {\n  \${0:// Fields}\n}` },
      });
      expect(completionItemByLabel(items, 'policy mixin')).toMatchObject({
        kind: CompletionItemKind.Keyword,
        detail: 'Declares a mixin for policy blocks.',
        filterText: 'policy mixin',
        sortText: '1:policy mixin',
        insertTextFormat: InsertTextFormat.Snippet,
        textEdit: {
          newText: `policy mixin ${nameSnippetPlaceholder} {\n  \${0:// Block keys and attributes}\n}`,
        },
      });
    });

    it('offers the mixin item while the whole keyword is the word before the cursor, and nothing once more is typed', () => {
      expect(complete('model|').items.map((item) => item.label)).toContain('model mixin');
      expect(complete('model m|').items).toEqual([]);
      expect(complete('model mixin|').items).toEqual([]);
    });

    it.each([
      ['a model', ['model User {', '  |', '}']],
      ['a block', ['policy P {', '  |', '}']],
      ['a model mixin', ['model mixin M {', '  |', '}']],
      ['a block mixin', ['policy mixin M {', '  |', '}']],
    ])('offers none inside %s', (_where, lines) => {
      const labels = complete(lines.join('\n')).items.map((item) => item.label);

      expect(labels.filter((label) => label.endsWith(' mixin'))).toEqual([]);
    });
  });

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

  it('returns bare model field type completion candidates without custom ranking', () => {
    const { items, sourceFile, cursorOffset } = complete(
      ['model Post {', '  author |', '}'].join('\n'),
    );

    expect(items.map(({ label, detail }) => [label, detail]).sort()).toEqual([
      ['Address', 'Composite type'],
      ['Boolean', 'Configured scalar type'],
      ['DateTime', 'Configured scalar type'],
      ['Email', 'Scalar type'],
      ['Int', 'Configured scalar type'],
      ['Post', 'Model'],
      ['String', 'Configured scalar type'],
      ['User', 'Model'],
      ['UserId', 'Type alias'],
      ['auth', 'Namespace'],
      ['public', 'Namespace'],
    ]);
    for (const item of items) expect(item).not.toHaveProperty('sortText');
    expect(completionItemByLabel(items, 'Boolean').textEdit).toEqual({
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

    expect(items.map((item) => item.label).sort()).toEqual([
      'Address',
      'Boolean',
      'DateTime',
      'Email',
      'Int',
      'Post',
      'String',
      'User',
      'UserId',
      'auth',
      'public',
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

    expect(items.map((item) => item.label).sort()).toEqual([
      'Address',
      'Boolean',
      'DateTime',
      'Email',
      'Int',
      'Post',
      'String',
      'User',
      'UserId',
      'auth',
      'public',
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
        newText: 'auth.',
      },
    });
  });

  it('returns namespace members after a namespace qualifier', () => {
    const { items, sourceFile, cursorOffset } = complete(
      ['model Post {', '  owner auth.|', '}'].join('\n'),
    );

    expect(items.map((item) => item.label).sort()).toEqual(['Account', 'Profile', 'User']);
    expect(completionItemByLabel(items, 'Account').textEdit).toEqual({
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

    expect(items.map((item) => item.label).sort()).toEqual(['Account', 'Profile', 'User']);
    for (const item of items) expect(item).not.toHaveProperty('sortText');
    expect(items.find((item) => item.label === 'User')).toMatchObject({
      filterText: 'User',
      detail: 'Model',
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

  it('completes a generic block value from the block spec', () => {
    const { items } = complete(['policy Rule {', '  on = |', '}'].join('\n'));

    expect(items.map((item) => item.label)).toEqual(['User', 'public', 'auth']);
  });

  it('returns descriptor-backed generic block parameter completions', () => {
    const { items, sourceFile, cursorOffset } = complete(['policy Rule {', '  |', '}'].join('\n'));

    expect(items.map((item) => item.label)).toEqual(['on', 'where', 'mode', 'using']);
    expect(items.map((item) => item.detail)).toEqual([
      'Generic block parameter',
      'The policy predicate.',
      'Generic block parameter',
      'Generic block parameter',
    ]);
    expect(items[0]?.textEdit).toEqual({
      range: {
        start: sourceFile.positionAt(cursorOffset),
        end: sourceFile.positionAt(cursorOffset),
      },
      newText: 'on = ',
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
        newText: 'where = ',
      },
    });
  });

  it('uses generic block parameter documentation with a fallback for undocumented parameters', () => {
    const { items } = complete('policy Rule { | }');
    expect(completionItemByLabel(items, 'where').detail).toBe('The policy predicate.');
    expect(completionItemByLabel(items, 'on').detail).toBe('Generic block parameter');
  });

  it('still offers the in-progress key while excluding an already-present sibling key', () => {
    const { items } = complete(['policy Rule {', '  where = "x"', '  on|', '}'].join('\n'));

    expect(items.map((item) => item.label)).toEqual(['on', 'mode', 'using']);
  });

  it('returns no generic block parameter completions without a matching descriptor', () => {
    const { items } = complete(['extension Rule {', '  |', '}'].join('\n'));

    expect(items).toEqual([]);
  });

  it('offers no key candidates for an arbitrary-key block spec', () => {
    const { items } = complete(['inventory Stock {', '  |', '}'].join('\n'));

    expect(items).toEqual([]);
  });

  it('keeps key completion available inside an invalid block', () => {
    const { items } = complete(
      ['policy Rule {', '  bogus = "not a declared key"', '  |', '}'].join('\n'),
    );

    expect(items.map((item) => item.label)).toEqual(['on', 'where', 'mode', 'using']);
  });

  it('calls the spec factory with the spec context and never invokes rule parsing', () => {
    const dataTypes: DataTypeSupport = {
      entries: {},
      lookup: createDataTypeLookup([]),
      dataTypeOfCodec: () => undefined,
    };
    const factoryContexts: BlockSpecContext[] = [];
    const throwingRule = {
      kind: 'str' as const,
      label: 'string',
      value: undefined,
      parse: () => {
        throw new Error('metadata inspection must not invoke rule parsing');
      },
    };
    const { items } = completeWithSource({
      markedSource: ['guard Rule {', '  |', '}'].join('\n'),
      pslBlockDescriptors: {
        guard: {
          kind: 'pslBlock',
          keyword: 'guard',
          discriminator: 'fixture-guard',
          name: { required: true },
          spec: (ctx: BlockSpecContext) => {
            factoryContexts.push(ctx);
            return structBlock({
              parameters: {
                shield: { type: throwingRule, documentation: 'The shield key.' },
              },
            });
          },
        },
      },
      dataTypes,
    });

    expect(items.map((item) => item.label)).toEqual(['shield']);
    expect(items[0]?.detail).toBe('The shield key.');
    expect(factoryContexts).toHaveLength(2);
    for (const ctx of factoryContexts) {
      expect(ctx).toEqual({ symbols: expect.any(Object), dataTypes: expect.any(Object) });
      expect(ctx.dataTypes).toBe(dataTypes);
    }
  });

  it.each(['|', '[|]', '{ nested: | }', '[{ nested: [|] }]'])(
    'completes recursive JSON values at %s',
    (value) => {
      const { items } = completeWithSource({
        markedSource: `model Post { value String @jsonFixture(${value}) }`,
        pslBlockDescriptors: {},
        authoringContributions: assembleAuthoringContributions([
          {
            id: 'json-fixture',
            authoring: {
              attributeSpecs: {
                field: {
                  jsonFixture: () =>
                    fieldAttribute('jsonFixture', {
                      documentation: '',
                      positional: [{ key: 'value', type: jsonValue(), documentation: '' }],
                    }),
                },
                model: {},
              },
            },
          },
        ]),
        controlMutationDefaults,
      });
      expect(items.map((item) => item.label)).toEqual(['true', 'false', 'null']);
    },
  );

  it('returns an empty list for unsupported classifier contexts', () => {
    const { items } = complete(['model Post {', '  // @|', '}'].join('\n'));

    expect(items).toEqual([]);
  });

  it('uses registered scalar documentation for completion details', () => {
    const { items } = completeWithSource({
      markedSource: 'model Post { value | }',
      pslBlockDescriptors: {},
      authoringContributions: assembleAuthoringContributions([
        {
          id: 'documented-scalars',
          authoring: {
            type: {
              String: {
                kind: 'typeConstructor',
                documentation: 'Variable-length Unicode text.',
                output: { codecId: 'fixture/text@1' },
              },
            },
          },
        },
      ]),
      controlMutationDefaults,
    });
    expect(completionItemByLabel(items, 'String').detail).toBe('Variable-length Unicode text.');
    expect(completionItemByLabel(items, 'Int').detail).toBe('Configured scalar type');
  });

  it(
    'offers no field preset of the real Postgres pack in type position',
    async () => {
      const { postgresTargetDescriptorMeta } = await importFromPackageRoot<{
        readonly postgresTargetDescriptorMeta: { readonly authoring: AuthoringContributions };
      }>('../../../3-targets/postgres/1-target/src/core/descriptor-meta.ts');
      const authoringContributions = assembleAuthoringContributions([
        { id: 'postgres', authoring: postgresTargetDescriptorMeta.authoring },
      ]);
      const labels = (markedSource: string) =>
        completeWithSource({
          markedSource,
          pslBlockDescriptors: {},
          clientSupportsSnippets: false,
          authoringContributions,
          controlMutationDefaults,
        }).items.map((item) => item.label);

      const topLevel = labels('model Post { value | }');
      const temporal = labels('model Post { value temporal.| }');
      expect({
        topLevel: ['text', 'json', 'uuidNative', 'id'].filter((name) => topLevel.includes(name)),
        temporal: ['createdAt', 'updatedAt', 'timestamp'].filter((name) => temporal.includes(name)),
        aliases: ['CreatedAt', 'UpdatedAt'].filter((name) => temporal.includes(name)),
      }).toEqual({ topLevel: [], temporal: [], aliases: ['CreatedAt', 'UpdatedAt'] });
    },
    timeouts.typeScriptCompilation,
  );

  it(
    'lists deprecated Mongo scalar names tagged deprecated, naming the replacement',
    async () => {
      const { mongoScalarAuthoringTypes } = await importFromPackageRoot<{
        readonly mongoScalarAuthoringTypes: AuthoringTypeNamespace;
      }>('../../../3-targets/mongo/2-adapter/src/exports/control.ts');
      const { items } = completeWithSource({
        markedSource: 'model Post { value | }',
        pslBlockDescriptors: {},
        scalarTypes: Object.keys(mongoScalarAuthoringTypes),
        authoringContributions: assembleAuthoringContributions([
          { id: 'mongo-scalars', authoring: { type: mongoScalarAuthoringTypes } },
        ]),
        controlMutationDefaults,
      });
      const scalars = items.filter((item) => item.kind === CompletionItemKind.Class);
      const current = ['Int32', 'Double', 'Bool', 'Date'];
      const deprecated = [
        ['Int', 'Int32'],
        ['Float', 'Double'],
        ['Boolean', 'Bool'],
        ['DateTime', 'Date'],
      ] as const;

      expect(
        scalars
          .filter((item) => item.tags?.includes(CompletionItemTag.Deprecated))
          .map((item) => item.label)
          .sort(),
      ).toEqual(deprecated.map(([name]) => name).sort());
      for (const name of current) {
        expect(completionItemByLabel(items, name)).not.toHaveProperty('tags');
      }
      for (const [name, replacement] of deprecated) {
        expect(completionItemByLabel(items, name)).toMatchObject({
          tags: [CompletionItemTag.Deprecated],
          detail: expect.stringContaining(`Deprecated: use ${replacement}`),
        });
      }
    },
    timeouts.coldTransformImport,
  );

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
    const degraded = names('enum Mood { Happy Happy }\nmodel Post { mood Mood @default(|) }');
    expect(degraded).toEqual(['Happy']);
  }, 5_000);

  it('uses actual adapter default-function signatures through the SQL factory', async () => {
    const stack = await actualSqlStack();
    const defaults = await importFromPackageRoot<ActualPostgresDefaultsModule>(
      '../../../3-targets/postgres/2-adapter/src/core/migrations/control-mutation-defaults.ts',
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
      'null',
      'autoincrement',
      'now',
    ]);
    const snippetItems = completeWithActualStack(source('|'), stack, {
      ...options,
      clientSupportsSnippets: true,
    }).items;
    expect(completionItemByLabel(snippetItems, 'now').textEdit?.newText).toBe('now()');
  }, 5_000);

  it('labels each generator function argument by the values the function takes', async () => {
    const postgres = await importFromPackageRoot<{
      readonly postgresGeneratorFunctions: readonly {
        readonly name: string;
        readonly signature?: unknown;
      }[];
    }>('../../../3-targets/postgres/1-target/src/core/generator-functions.ts');
    const labelOf = (name: string) => {
      const declared = postgres.postgresGeneratorFunctions.find(
        (contribution) => contribution.name === name && contribution.signature !== undefined,
      )!.signature as (dataTypes: unknown) => FuncCallSig;
      const signature = declared(EMPTY_DATA_TYPES);
      return renderSignatureLabel(name, signature, resolveSignatureParameters(signature, undefined))
        .label;
    };
    expect(['uuid', 'cuid', 'nanoid'].map(labelOf)).toEqual([
      'uuid((4 | 7)?)',
      'cuid(2)',
      'nanoid(integer from 2 to 255?)',
    ]);
  });

  it('offers each registered tag inside @default( with its own documentation', async () => {
    const stack = await actualSqlStack();
    const [postgres, sqlite, family] = await Promise.all([
      importFromPackageRoot<ActualPostgresDataTypesModule>(
        '../../../3-targets/postgres/1-target/src/exports/data-types.ts',
      ),
      importFromPackageRoot<ActualSqliteDataTypesModule>(
        '../../../3-targets/sqlite/1-target/src/exports/data-types.ts',
      ),
      importFromPackageRoot<ActualSqlExpressionModule>(
        '../../../2-sql-family/1-core/contract/src/exports/sql-expression.ts',
      ),
    ]);
    const withFamilyEntry = (
      targetEntries: Readonly<Record<string, DataTypeAuthoringEntry>>,
    ): Readonly<Record<string, DataTypeAuthoringEntry>> => ({
      ...family.sqlExpressionRegistration.authoring.dataTypes,
      ...targetEntries,
    });
    const complete = (
      dataTypes: Readonly<Record<string, DataTypeAuthoringEntry>>,
      clientSupportsSnippets: boolean,
    ) =>
      completeWithActualStack('model Post { value String @default(|) }', stack, {
        clientSupportsSnippets,
        controlMutationDefaults,
        dataTypes,
      }).items.map((item) => ({
        label: item.label,
        detail: item.detail,
        newText: item.textEdit?.newText,
        insertTextFormat: item.insertTextFormat,
      }));
    const postgresEntries = withFamilyEntry(postgres.postgresDataTypeEntries());
    // This stack has no type constructors, so no column has a known type and every tag is offered.
    const postgresTags = [
      'sql',
      'json',
      'date',
      'time',
      'timetz',
      'timestamp',
      'timestamptz',
      'interval',
      'bytea',
    ];
    const documentationOf = (
      entries: Readonly<Record<string, DataTypeAuthoringEntry>>,
      tag: string,
    ) =>
      Object.values(entries).find(
        (entry) => entry.written.kind === 'tag' && entry.written.tag === tag,
      )?.documentation;
    const value = (label: string) => ({
      label,
      detail: 'PSL argument value',
      newText: label,
      insertTextFormat: undefined,
    });
    const tag = (
      entries: Readonly<Record<string, DataTypeAuthoringEntry>>,
      label: string,
      snippet: boolean,
    ) => ({
      label,
      detail: documentationOf(entries, label),
      newText: snippet ? `${label}\`$1\`` : label,
      insertTextFormat: snippet ? InsertTextFormat.Snippet : undefined,
    });

    expect(complete(postgresEntries, true)).toEqual([
      value('true'),
      value('false'),
      value('null'),
      ...postgresTags.map((name) => tag(postgresEntries, name, true)),
    ]);
    const sqliteEntries = withFamilyEntry(sqlite.sqliteDataTypeEntries());
    expect(complete(sqliteEntries, true)).toEqual([
      value('true'),
      value('false'),
      value('null'),
      tag(sqliteEntries, 'sql', true),
      tag(sqliteEntries, 'json', true),
      tag(sqliteEntries, 'blob', true),
      tag(sqliteEntries, 'datetime', true),
    ]);
    expect(complete(postgresEntries, false)).toEqual([
      value('true'),
      value('false'),
      value('null'),
      ...postgresTags.map((name) => tag(postgresEntries, name, false)),
    ]);

    // Each tag carries the text of the tag it names, not every registered tag's text.
    expect(documentationOf(postgresEntries, 'json')).not.toBe(
      documentationOf(postgresEntries, 'sql'),
    );
  }, 5_000);

  it('uses distinct local and referenced fields through actual SQL relation specs', async () => {
    const stack = await actualSqlStack();
    const schema = (args: string) =>
      `model Target { topOnly Int }\nnamespace remote { model Target { remoteOnly Int } }\nmodel Owner { ownOnly Int\n relation remote.Target @relation(${args}) }`;
    expect(
      completeWithActualStack(schema('fields: [|]'), stack).items.map((item) => item.label),
    ).toEqual(['ownOnly']);
    expect(
      completeWithActualStack(schema('references: [|]'), stack).items.map((item) => item.label),
    ).toEqual(['remoteOnly']);
    expect(
      completeWithActualStack(schema('onDelete: |'), stack).items.map((item) => item.label),
    ).toEqual(['NoAction', 'Restrict', 'Cascade', 'SetNull', 'SetDefault']);
  }, 5_000);

  it('uses actual Mongo sort functions and completes their positional arguments', async () => {
    const stack = await actualMongoStack();
    const schema = (args: string) => `model Post { title String\n slug String\n @@index(${args}) }`;
    const plain = completeWithActualStack(schema('[|]'), stack).items;
    expect(plain.map((item) => item.label)).toEqual(['title', 'slug', 'wildcard', 'sort']);
    const snippets = completeWithActualStack(schema('[|]'), stack, {
      clientSupportsSnippets: true,
    }).items;
    expect(snippets.map((item) => [item.label, item.textEdit?.newText])).toEqual([
      ['title', 'title'],
      ['slug', 'slug'],
      ['wildcard', `wildcard(${emptySnippetPlaceholder1})`],
      ['sort', 'sort($' + '{1:field}, $' + '{2:direction})'],
    ]);
    expect(
      completeWithActualStack(schema('[sort(|)]'), stack).items.map((item) => item.label),
    ).toEqual(['title', 'slug']);
    expect(
      completeWithActualStack(schema('[sort(title, |)]'), stack).items.map((item) => item.label),
    ).toEqual(['Asc', 'Desc']);
    expect(completeWithActualStack(schema('[wildcard(|)]'), stack).items).toEqual([]);
    expect(
      completeWithActualStack(schema('[title], type: |'), stack).items.map((item) => item.label),
    ).toEqual(['1', '-1', '"text"', '"2dsphere"', '"2d"', '"hashed"']);
  }, 5_000);

  it('scopes actual Mongo sort fields to the declaring namespace model', async () => {
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
      ['wildcard', `wildcard(${emptySnippetPlaceholder1})`],
      ['sort', 'sort($' + '{1:field}, $' + '{2:direction})'],
    ]);
    expect(
      completeWithActualStack(schema.replace('[|]', '[sort(|)]'), stack).items.map(
        (item) => item.label,
      ),
    ).toEqual(['scopedOnly']);
  }, 5_000);

  it('does not return generic block symbols as model field type candidates', () => {
    const { items } = complete(['model Post {', '  audit |', '}'].join('\n'));

    expect(items.map((item) => item.label)).not.toContain('Audit');
    expect(items.map((item) => item.label)).not.toContain('auth.ScopedAudit');
  });

  it('offers the same field type candidates in a document that holds a mixin and an inclusion', () => {
    const model = ['model Post {', '  author |', '}'].join('\n');
    const mixins = [
      'model mixin Timestamps {',
      '  createdAt DateTime',
      '}',
      'model Tagged {',
      '  id Int',
      '  +Timestamps',
      '}',
    ].join('\n');
    const plain = ['', '', '', 'model Tagged {', '  id Int', '', '}'].join('\n');

    expect(complete(`${mixins}\n${model}`).items).toEqual(complete(`${plain}\n${model}`).items);
  });

  it.each([
    ['in a mixin field type slot', 'model mixin Timestamps {\n  createdAt |\n}'],
    ['in a mixin header', 'model mixin |'],
    ['after the plus of an inclusion', 'model Post {\n  id Int\n  +|\n}'],
    ['inside the name of an inclusion', 'model Post {\n  +auth.Ti|\n}'],
    ['in an enum mixin body', 'enum mixin BaseRoles {\n  |\n}'],
  ])('completes without an error %s', (_case, markedSource) => {
    expect(() => complete(markedSource)).not.toThrow();
  });

  it('does not offer a mixin as a field type, by its name or as a namespace member', () => {
    const mixins = [
      'model mixin Timestamps {',
      '  createdAt DateTime',
      '}',
      'namespace shared {',
      '  model mixin Audited {',
      '    actor String',
      '  }',
      '  model Marker {',
      '    id Int',
      '  }',
      '}',
    ].join('\n');
    const unqualified = complete(`${mixins}\nmodel Post {\n  stamps |\n}`).items;
    const qualified = complete(`${mixins}\nmodel Post {\n  stamps shared.|\n}`).items;

    expect(unqualified.map((item) => item.label)).toContain('shared');
    expect(unqualified.map((item) => item.label)).not.toContain('Timestamps');
    expect(qualified.map((item) => item.label)).toEqual(['Marker']);
  });
});

describe('providePslCompletionItems — after the plus of an inclusion', () => {
  const mixinsOf = (prefix: string, indent: string) =>
    [
      `model mixin ${prefix}Stamps {`,
      '}',
      `type mixin ${prefix}Geo {`,
      '}',
      `enum mixin ${prefix}Roles {`,
      '}',
      `policy mixin ${prefix}Policy {`,
      '}',
    ].map((line) => `${indent}${line}`);

  function after(block: readonly string[], placement: 'billing' | 'top' = 'billing') {
    const namespace = placement === 'top' ? undefined : placement;
    const blockLines =
      namespace === undefined ? block : block.map((line) => (line === '' ? line : `  ${line}`));
    const markedSource = [
      ...mixinsOf('Top', ''),
      ...(namespace === undefined ? blockLines : []),
      'namespace auth {',
      ...mixinsOf('Auth', '  '),
      '}',
      'namespace billing {',
      ...mixinsOf('Billing', '  '),
      '  model mixin Used {',
      '  }',
      ...(namespace === undefined ? [] : blockLines),
      '}',
    ].join('\n');
    return completeWithSource({ markedSource, pslBlockDescriptors });
  }

  const offered = (block: readonly string[], placement: 'billing' | 'top' = 'billing') =>
    after(block, placement)
      .items.map(({ label, detail }) => [label, detail])
      .sort();

  const namespaces = [
    ['auth', 'Namespace'],
    ['billing', 'Namespace'],
    ['public', 'Namespace'],
  ];

  it.each([
    ['a model', ['model Invoice {', '  id Int', '  +Used', '  +|', '}'], 'Stamps', 'model mixin'],
    ['a composite type', ['type Address {', '  +|', '  street String', '}'], 'Geo', 'type mixin'],
    ['an enum', ['enum Role {', '  +|', '  GUEST', '}'], 'Roles', 'enum mixin'],
    ['a struct block', ['policy P {', '  +|', '}'], 'Policy', 'policy mixin'],
  ])(
    'offers the mixins of the keyword that an unqualified name reaches, and each namespace, in %s',
    (_block, lines, suffix, detail) => {
      expect(offered(lines)).toEqual(
        [[`Billing${suffix}`, detail], [`Top${suffix}`, detail], ...namespaces].sort(),
      );
    },
  );

  it('offers the same while a name is being typed after the plus', () => {
    expect(offered(['model Invoice {', '  +Bil|', '}'])).toEqual(
      offered(['model Invoice {', '  +|', '}']),
    );
  });

  it('offers only top-level mixins of the keyword and each namespace in a top-level block', () => {
    expect(offered(['enum Role {', '  +|', '}'], 'top')).toEqual(
      [['TopRoles', 'enum mixin'], ...namespaces].sort(),
    );
  });

  it.each([
    ['a model', ['model Invoice {', '  +auth.|', '}'], [['AuthStamps', 'model mixin']]],
    ['a composite type', ['type Address {', '  +auth.|', '}'], [['AuthGeo', 'type mixin']]],
    ['an enum', ['enum Role {', '  +auth.|', '}'], [['AuthRoles', 'enum mixin']]],
    ['a struct block', ['policy P {', '  +auth.|', '}'], [['AuthPolicy', 'policy mixin']]],
  ])(
    'offers the mixins of the keyword in the named namespace after a qualifier, in %s',
    (_block, lines, expected) => {
      expect(offered(lines)).toEqual(expected);
      expect(offered(lines.map((line) => line.replace('auth.|', 'auth.Au|')))).toEqual(expected);
    },
  );

  it('offers a namespace only when it has a mixin that would be offered after its qualifier', () => {
    const source = (block: readonly string[]) =>
      [
        'namespace models {',
        '  model mixin Stamps {',
        '  }',
        '}',
        'namespace enums {',
        '  enum mixin Roles {',
        '  }',
        '}',
        'namespace empty {',
        '  model Plain {',
        '    id Int',
        '  }',
        '}',
        ...block,
      ].join('\n');
    const labels = (block: readonly string[]) =>
      completeWithSource({ markedSource: source(block), pslBlockDescriptors })
        .items.map(({ label, detail }) => [label, detail])
        .sort();

    expect(labels(['model Invoice {', '  +|', '}'])).toEqual([['models', 'Namespace']]);
    expect(labels(['enum Role {', '  +|', '}'])).toEqual([['enums', 'Namespace']]);
    expect(labels(['model Invoice {', '  +models.Stamps', '  +|', '}'])).toEqual([]);
    expect(labels(['policy P {', '  +|', '}'])).toEqual([]);
  });

  it('does not offer a top-level mixin whose name a model of the namespace hides', () => {
    const { items } = completeWithSource({
      markedSource: [
        'model mixin Timestamps {',
        '  createdAt DateTime',
        '}',
        'namespace app {',
        '  model Timestamps {',
        '    id Int',
        '  }',
        '  model User {',
        '    id Int',
        '    +|',
        '  }',
        '}',
      ].join('\n'),
      pslBlockDescriptors,
    });

    expect(items.map(({ label, detail }) => [label, detail])).toEqual([['public', 'Namespace']]);
  });

  it('offers nothing after a qualifier that names no namespace', () => {
    expect(offered(['model Invoice {', '  +nowhere.|', '}'])).toEqual([]);
    expect(offered(['model Invoice {', '  +Invoice.|', '}'])).toEqual([]);
  });

  it('leaves out a mixin the block already includes, by either spelling', () => {
    expect(
      offered(['model Invoice {', '  +Used', '  +billing.BillingStamps', '  +|', '}']),
    ).toEqual([
      ['TopStamps', 'model mixin'],
      ['auth', 'Namespace'],
      ['public', 'Namespace'],
    ]);
    expect(offered(['model Invoice {', '  +Used', '  +billing.|', '}'])).toEqual([
      ['BillingStamps', 'model mixin'],
    ]);
  });

  it('still offers the mixin whose complete name the cursor is at the end of', () => {
    expect(offered(['model Invoice {', '  +Used|', '}'])).toContainEqual(['Used', 'model mixin']);
  });

  it('offers nothing after a plus inside a mixin body', () => {
    expect(offered(['model mixin Audited {', '  +|', '}'])).toEqual([]);
    expect(offered(['policy mixin Shared {', '  +auth.|', '}'])).toEqual([]);
  });

  it('offers no entry keys after a plus in a struct block', () => {
    const labels = after(['policy P {', '  +|', '}']).items.map((item) => item.label);
    const keys = after(['policy P {', '  |', '}']).items.map((item) => item.label);

    expect(keys.length).toBeGreaterThan(0);
    expect(labels.filter((label) => keys.includes(label))).toEqual([]);
  });

  it('offers no mixins on the line after a plus', () => {
    expect(offered(['model Invoice {', '  +', '  |', '}'])).toEqual([]);
  });

  it('replaces the typed name with the mixin name, and a namespace with its name and a dot', () => {
    const { items, sourceFile, cursorOffset } = after(['model Invoice {', '  +Bil|', '}']);
    const range = {
      start: sourceFile.positionAt(cursorOffset - 3),
      end: sourceFile.positionAt(cursorOffset),
    };

    expect(completionItemByLabel(items, 'BillingStamps')).toMatchObject({
      kind: CompletionItemKind.Interface,
      detail: 'model mixin',
      filterText: 'BillingStamps',
      textEdit: { range, newText: 'BillingStamps' },
    });
    expect(completionItemByLabel(items, 'auth')).toMatchObject({
      kind: CompletionItemKind.Module,
      detail: 'Namespace',
      textEdit: { range, newText: 'auth.' },
    });
  });
});

describe('providePslCompletionItems — inside a mixin body', () => {
  const declarationKeywords = ['namespace', 'types'];

  const withoutOwnName = (items: readonly CompletionItem[]) =>
    items.filter((item) => item.label !== 'Probe');

  function itemsIn(header: string, body: readonly string[], closed = true) {
    return complete([header, ...body, ...(closed ? ['}'] : [])].join('\n')).items;
  }

  it.each([
    ['a field type', ['  scopedOnly Int', '  value |']],
    ['a field attribute name', ['  scopedOnly Int', '  value Int @|']],
    ['a field attribute argument', ['  value Int @marker(|)']],
    [
      'a field attribute key that depends on the fields of the owner',
      ['  scopedOnly Int', '  value Int @ownerAware(|)'],
    ],
    ['a field attribute key when the owner lacks the field', ['  value Int @ownerAware(|)']],
    ['a block attribute name', ['  value Int', '  @@|']],
    ['a block attribute argument', ['  value Int', '  @@security.rls(|)']],
  ])('offers in a model mixin what a model offers at %s', (_position, body) => {
    const inMixin = itemsIn('model mixin Probe {', body);

    expect(inMixin).toEqual(withoutOwnName(itemsIn('model Probe {', body)));
    expect(
      inMixin.map((item) => item.label).filter((label) => declarationKeywords.includes(label)),
    ).toEqual([]);
  });

  it('offers something at each model position the fixture has candidates for', () => {
    expect(itemsIn('model mixin Probe {', ['  value |']).length).toBeGreaterThan(0);
    expect(itemsIn('model mixin Probe {', ['  value Int @|']).length).toBeGreaterThan(0);
    expect(itemsIn('model mixin Probe {', ['  value Int', '  @@|']).length).toBeGreaterThan(0);
    expect(
      itemsIn('model mixin Probe {', ['  scopedOnly Int', '  value Int @ownerAware(|)']).map(
        (item) => item.label,
      ),
    ).toEqual(['scopedKey']);
  });

  it.each([
    ['a field type', ['  value |']],
    ['a field attribute name', ['  value Int @|']],
    ['a field attribute argument', ['  value Int @marker(|)']],
    ['a block attribute name', ['  value Int', '  @@|']],
  ])('offers in a type mixin what a composite type offers at %s', (_position, body) => {
    const inMixin = itemsIn('type mixin Probe {', body);

    expect(inMixin).toEqual(withoutOwnName(itemsIn('type Probe {', body)));
    expect(
      inMixin.map((item) => item.label).filter((label) => declarationKeywords.includes(label)),
    ).toEqual([]);
  });

  it.each([
    ['an entry key', 'policy', ['  |']],
    ['an entry key after another entry', 'policy', ['  on = User', '  |']],
    ['an entry value that names a model', 'policy', ['  on = |']],
    ['an entry value with fixed identifiers', 'policy', ['  mode = |']],
    ['a block attribute name', 'policy', ['  @@|']],
    ['a block attribute argument', 'policy', ['  @@audit(|)']],
    ['an entry key of a map block', 'inventory', ['  |']],
    ['an entry value of a map block', 'inventory', ['  count = |']],
  ])(
    'offers in a mixin for a key = value keyword what a block of that keyword offers at %s',
    (_position, keyword, body) => {
      const inMixin = itemsIn(`${keyword} mixin Probe {`, body);

      expect(inMixin).toEqual(itemsIn(`${keyword} Probe {`, body));
      expect(
        inMixin.map((item) => item.label).filter((label) => declarationKeywords.includes(label)),
      ).toEqual([]);
    },
  );

  it('offers something at each struct block position', () => {
    expect(itemsIn('policy mixin Probe {', ['  |']).map((item) => item.label)).toContain('on');
    expect(itemsIn('policy mixin Probe {', ['  mode = |']).map((item) => item.label)).toEqual([
      'permissive',
      'restrictive',
    ]);
    expect(itemsIn('policy mixin Probe {', ['  @@|']).map((item) => item.label)).toEqual(['audit']);
  });

  it('offers nothing and does not fail in a mixin for a keyword with no registered block', () => {
    expect(itemsIn('widget mixin Probe {', ['  |'])).toEqual(itemsIn('widget Probe {', ['  |']));
    expect(itemsIn('widget mixin Probe {', ['  |'])).toEqual([]);
    expect(itemsIn('widget mixin Probe {', ['  @@|'])).toEqual([]);
    expect(itemsIn('widget mixin Probe {', ['  key = |'])).toEqual([]);
  });

  it('completes inside a mixin that is not closed yet as inside a model that is not closed yet', () => {
    const body = ['  scopedOnly Int', '  value Int @|'];

    expect(itemsIn('model mixin Probe {', body, false)).toEqual(
      itemsIn('model Probe {', body, false),
    );
    expect(itemsIn('model mixin Probe {', body, false).length).toBeGreaterThan(0);
    expect(itemsIn('policy mixin Probe {', ['  |'], false)).toEqual(
      itemsIn('policy Probe {', ['  |'], false),
    );
  });

  it('offers the same inside a mixin declared in a namespace', () => {
    const inNamespace = (header: string) =>
      complete(['namespace scoped {', `  ${header}`, '    value |', '  }', '}'].join('\n')).items;

    expect(inNamespace('model mixin Probe {')).toEqual(
      withoutOwnName(inNamespace('model Probe {')),
    );
  });
});

describe('providePslCompletionItems — keys a block already has', () => {
  const keysOf = (block: readonly string[]) =>
    complete(['policy mixin Shared {', '  on = User', '  where = "true"', '}', ...block].join('\n'))
      .items.map((item) => item.label)
      .sort();

  it('does not offer a key that an included mixin provides', () => {
    expect(keysOf(['policy P {', '  +Shared', '  |', '}'])).toEqual(['mode', 'using']);
  });

  it('offers that key in the same block without the inclusion', () => {
    expect(keysOf(['policy P {', '  |', '}'])).toEqual(['mode', 'on', 'using', 'where']);
  });

  it('does not offer a key written in the block itself, and still offers the key under the cursor', () => {
    expect(keysOf(['policy P {', '  mode = permissive', '  |', '}'])).toEqual([
      'on',
      'using',
      'where',
    ]);
    expect(keysOf(['policy P {', '  +Shared', '  mo|', '}'])).toEqual(['mode', 'using']);
  });
});
