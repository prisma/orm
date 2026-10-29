import type { DataTypeAuthoringEntry } from '@internal/framework-components/authoring';
import { EMPTY_DATA_TYPES, type FuncCallSig } from '@internal/psl-parser';
import { describe, expect, it } from 'vitest';
import { InsertTextFormat } from 'vscode-languageserver';
import { renderSignatureLabel, resolveSignatureParameters } from '../src/signature-help';
import {
  type ActualPostgresDataTypesModule,
  type ActualPostgresDefaultsModule,
  type ActualSqlExpressionModule,
  type ActualSqliteDataTypesModule,
  actualMongoStack,
  actualSqlStack,
  completeWithActualStack,
  completionItemByLabel,
  controlMutationDefaults,
  emptySnippetPlaceholder1,
  importFromPackageRoot,
} from './helpers/completion-provider';

describe('providePslCompletionItems', () => {
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
});
