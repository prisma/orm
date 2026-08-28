/**
 * Seam test for the two-bucket `PslDocumentAst` shape: a flat
 * `__unspecified__` namespace can now sit beside a named one, print with
 * top-level declarations first and no `namespace __unspecified__` wrapper,
 * and round-trip through parse + interpret.
 *
 * The flat bucket carries an `enum` block because that is the payload the
 * shape exists for: a domain enum inside `namespace { … }` is the hard
 * diagnostic `PSL_ENUM_NAMESPACE_NOT_SUPPORTED`, so recovering one from a
 * database that also needs a schema wrap requires exactly this two-bucket
 * document. No production caller fills the bucket yet — domain-enum
 * recovery, a later slice, is the first producer — so the tests below pass
 * the blocks in directly.
 */
import sqlFamilyPack from '@internal/family-sql/pack';
import type { PslPrinterOptions } from '@internal/family-sql/psl-infer';
import { parseRawDefault } from '@internal/family-sql/psl-infer';
import {
  type AuthoringTypeNamespace,
  collectScalarTypeConstructors,
} from '@internal/framework-components/authoring';
import type { Codec, CodecLookup } from '@internal/framework-components/codec';
import { assembleAuthoringContributions } from '@internal/framework-components/control';
import type {
  PslDocumentAst,
  PslExtensionBlock,
  PslModel,
  PslNamespace,
  PslSpan,
} from '@internal/framework-components/psl-ast';
import {
  makePslNamespace,
  makePslNamespaceEntries,
  UNSPECIFIED_PSL_NAMESPACE_ID,
} from '@internal/framework-components/psl-ast';
import { buildSymbolTable } from '@internal/psl-parser';
import { parse } from '@internal/psl-parser/syntax';
import { printPsl } from '@internal/psl-printer';
import { interpretPslDocumentToSqlContract } from '@internal/sql-contract-psl';
import { SqlSchemaIR } from '@internal/sql-schema-ir/types';
import { assert, describe, expect, it } from 'vitest';
import {
  postgresAuthoringEntityTypes,
  postgresAuthoringPslBlockDescriptors,
} from '../../../src/core/authoring';
import { isPostgresSchema, postgresCreateNamespace } from '../../../src/core/postgres-schema';
import { buildPslDocumentAst } from '../../../src/core/psl-infer/infer-psl-contract';
import { createPostgresDefaultMapping } from '../../../src/core/psl-infer/postgres-default-mapping';
import { createPostgresTypeMap } from '../../../src/core/psl-infer/postgres-type-map';
import { inferPslAstFromFlat } from '../fixtures';

const authoringTypes = {
  Int: { kind: 'typeConstructor', output: { codecId: 'pg/int4@1', nativeType: 'int4' } },
} as const satisfies AuthoringTypeNamespace;

const assembled = assembleAuthoringContributions([
  { authoring: sqlFamilyPack.authoring },
  {
    authoring: {
      entityTypes: postgresAuthoringEntityTypes,
      type: authoringTypes,
      pslBlockDescriptors: postgresAuthoringPslBlockDescriptors,
    },
  },
]);

const target = {
  kind: 'target' as const,
  familyId: 'sql' as const,
  targetId: 'postgres' as const,
  id: 'postgres',
  version: '0.0.1',
  capabilities: {},
  defaultNamespaceId: 'public',
  authoring: { type: authoringTypes },
};

const textCodec: Codec = {
  id: 'pg/text@1',
  encode: async (v: unknown) => v,
  decode: async (w: unknown) => w,
  encodeJson: (value) => value as never,
  decodeJson(json) {
    if (typeof json !== 'string') throw new Error(`expected string, got ${typeof json}`);
    return json;
  },
};

const codecLookup: CodecLookup = {
  get: (id) => (id === 'pg/text@1' ? textCodec : undefined),
  targetTypesFor: (id) => (id === 'pg/text@1' ? ['text'] : undefined),
  renderOutputTypeFor: () => undefined,
  descriptorFor: () => undefined,
};

function print(ast: PslDocumentAst): string {
  return printPsl(ast, { pslBlockDescriptors: assembled.pslBlockDescriptors });
}

/**
 * Reads the printed text back the way the CLI does. The parse and symbol-table
 * diagnostics are returned alongside the interpreter result because the
 * interpreter succeeds on a document the symbol table has already repaired: a
 * duplicate declaration is reported there and dropped first-wins, so asserting
 * only on the interpreter would accept printed text that is not valid PSL.
 */
function parseAndInterpret(source: string) {
  const { document, sourceFile, diagnostics: parseDiagnostics } = parse(source);
  const { table: symbolTable, diagnostics: symbolTableDiagnostics } = buildSymbolTable({
    document,
    sourceFile,
    pslBlockDescriptors: assembled.pslBlockDescriptors,
  });
  const interpreted = interpretPslDocumentToSqlContract({
    symbolTable,
    sourceFile,
    sourceId: 'schema.prisma',
    capabilities: {},
    target,
    scalarColumnDescriptors: collectScalarTypeConstructors(authoringTypes),
    authoringContributions: assembled,
    composedExtensionContracts: new Map(),
    createNamespace: postgresCreateNamespace,
    codecLookup,
  });
  return { interpreted, sourceDiagnostics: [...parseDiagnostics, ...symbolTableDiagnostics] };
}

const ZERO_SPAN: PslSpan = {
  start: { offset: 0, line: 1, column: 1 },
  end: { offset: 0, line: 1, column: 1 },
};

function idModel(name: string): PslModel {
  return {
    kind: 'model',
    name,
    fields: [
      {
        kind: 'field',
        name: 'id',
        typeName: 'Int',
        optional: false,
        list: false,
        attributes: [{ kind: 'attribute', target: 'field', name: 'id', args: [], span: ZERO_SPAN }],
        span: ZERO_SPAN,
      },
    ],
    attributes: [],
    span: ZERO_SPAN,
  };
}

function enumBlock(name: string, members: Record<string, string>): PslExtensionBlock {
  return {
    kind: 'enum',
    keyword: 'enum',
    name,
    parameters: Object.fromEntries(
      Object.entries(members).map(([memberName, value]) => [
        memberName,
        { kind: 'value' as const, raw: JSON.stringify(value), span: ZERO_SPAN },
      ]),
    ),
    blockAttributes: [
      {
        name: 'type',
        args: [{ kind: 'positional', value: `"pg/text@1"`, span: ZERO_SPAN }],
        span: ZERO_SPAN,
      },
    ],
    attributes: {},
    span: ZERO_SPAN,
  };
}

function flatBucket(blocks: readonly PslExtensionBlock[]): PslNamespace {
  return makePslNamespace({
    kind: 'namespace',
    name: UNSPECIFIED_PSL_NAMESPACE_ID,
    entries: makePslNamespaceEntries([], [], blocks),
    span: ZERO_SPAN,
  });
}

function namedBucket(name: string, models: readonly PslModel[]): PslNamespace {
  return makePslNamespace({
    kind: 'namespace',
    name,
    entries: makePslNamespaceEntries(models, [], []),
    span: ZERO_SPAN,
  });
}

describe('a document with both a flat top-level bucket and a named namespace', () => {
  // The named namespace is listed FIRST so the printer's sort has to move
  // the flat bucket ahead of it. With the flat bucket already first, a
  // stable sort would keep the order even with the comparator deleted.
  const ast: PslDocumentAst = {
    kind: 'document',
    sourceId: 't',
    namespaces: [
      namedBucket('billing', [idModel('Item')]),
      flatBucket([enumBlock('ItemStatus', { draft: 'draft', shipped: 'shipped' })]),
    ],
    span: ZERO_SPAN,
  };

  it('prints the top-level enum before the namespace block, with no __unspecified__ wrapper', () => {
    const printed = print(ast);
    expect(printed).toContain('enum ItemStatus {');
    expect(printed).toContain('namespace billing {');
    expect(printed.indexOf('enum ItemStatus {')).toBeLessThan(
      printed.indexOf('namespace billing {'),
    );
    expect(printed).not.toMatch(/namespace\s+__unspecified__/);
  });

  it('re-parses and re-interprets, with the enum recovered as a value set', () => {
    const { interpreted, sourceDiagnostics } = parseAndInterpret(print(ast));
    expect(sourceDiagnostics.map((d) => `${d.code}: ${d.message}`)).toEqual([]);
    if (!interpreted.ok) {
      assert.fail(interpreted.failure.diagnostics.map((d) => `${d.code}: ${d.message}`).join('\n'));
    }
    expect(interpreted.value.domain.namespaces['billing']?.models['Item']).toBeDefined();
    const publicStorage = interpreted.value.storage.namespaces['public'];
    assert.ok(isPostgresSchema(publicStorage), 'the value set must land in the public namespace');
    expect(publicStorage.valueSet?.['ItemStatus']).toMatchObject({
      values: ['draft', 'shipped'],
    });
  });
});

describe('two flat buckets in one document', () => {
  it('prints text that re-parses cleanly, with the shared enum declared once', () => {
    // The shape a producer reaches by splitting one logical bucket in two.
    // Printing each entry separately would declare `ItemStatus` twice, which
    // parses to a duplicate-declaration diagnostic rather than to a contract.
    const ast: PslDocumentAst = {
      kind: 'document',
      sourceId: 't',
      namespaces: [
        flatBucket([enumBlock('ItemStatus', { draft: 'draft', shipped: 'shipped' })]),
        flatBucket([enumBlock('ItemStatus', { draft: 'draft', shipped: 'shipped' })]),
      ],
      span: ZERO_SPAN,
    };
    const printed = print(ast);
    expect(printed.match(/enum ItemStatus \{/g)).toHaveLength(1);

    const { interpreted, sourceDiagnostics } = parseAndInterpret(printed);
    expect(sourceDiagnostics.map((d) => `${d.code}: ${d.message}`)).toEqual([]);
    expect(interpreted.ok).toBe(true);
  });
});

describe('an empty flat bucket beside a populated named namespace', () => {
  it('prints identically to a document with no flat bucket at all', () => {
    const named = namedBucket('billing', [idModel('Item')]);
    const withEmptyFlatBucket: PslDocumentAst = {
      kind: 'document',
      sourceId: 't',
      namespaces: [flatBucket([]), named],
      span: ZERO_SPAN,
    };
    const withoutFlatBucket: PslDocumentAst = {
      kind: 'document',
      sourceId: 't',
      namespaces: [named],
      span: ZERO_SPAN,
    };
    expect(print(withEmptyFlatBucket)).toBe(print(withoutFlatBucket));
  });
});

describe('buildPslDocumentAst and the top-level bucket', () => {
  const schemaIR = new SqlSchemaIR({
    tables: {
      widget: {
        name: 'widget',
        columns: { id: { name: 'id', nativeType: 'int4', nullable: false } },
        primaryKey: { columns: ['id'] },
        foreignKeys: [],
        uniques: [],
        indexes: [],
      },
    },
  });

  const printerOptions: PslPrinterOptions = {
    typeMap: createPostgresTypeMap(new Set()),
    defaultMapping: createPostgresDefaultMapping(),
    parseRawDefault,
  };

  const foreignKeyExtras = {
    extraRelationsByTable: new Map(),
    crossSpaceFieldNamesByTable: new Map(),
    danglingForeignKeysByTable: new Map(),
  };

  it('emits exactly one namespace when no top-level blocks are passed', () => {
    const ast = inferPslAstFromFlat(schemaIR);
    expect(ast.namespaces).toHaveLength(1);
    expect(ast.namespaces[0]?.name).toBe(UNSPECIFIED_PSL_NAMESPACE_ID);
  });

  it('keeps one namespace when the top-level block list is empty, wrap or no wrap', () => {
    const wrapped = buildPslDocumentAst(
      schemaIR,
      printerOptions,
      foreignKeyExtras,
      'app',
      undefined,
      [],
    );
    expect(wrapped.namespaces).toHaveLength(1);
    expect(wrapped.namespaces[0]?.name).toBe('app');

    const flat = buildPslDocumentAst(
      schemaIR,
      printerOptions,
      foreignKeyExtras,
      undefined,
      undefined,
      [],
    );
    expect(flat.namespaces).toHaveLength(1);
    expect(flat.namespaces[0]?.name).toBe(UNSPECIFIED_PSL_NAMESPACE_ID);
  });

  it('does not split when the wrap name is itself the flat bucket name', () => {
    // A live schema may be called `__unspecified__`. Splitting on it would put
    // two same-named buckets in one document, and the printed output would
    // carry no wrapper at all — so its tables would read back as `public`.
    const ast = buildPslDocumentAst(
      schemaIR,
      printerOptions,
      foreignKeyExtras,
      UNSPECIFIED_PSL_NAMESPACE_ID,
      undefined,
      [enumBlock('WidgetKind', { small: 'small', large: 'large' })],
    );
    expect(ast.namespaces).toHaveLength(1);
    expect(Object.keys(ast.namespaces[0]?.entries?.['enum'] ?? {})).toEqual(['WidgetKind']);
  });

  it('refuses a top-level block whose name a model already claims', () => {
    expect(() =>
      buildPslDocumentAst(schemaIR, printerOptions, foreignKeyExtras, 'app', undefined, [
        enumBlock('Widget', { small: 'small' }),
      ]),
    ).toThrow(/collides with a model, a native enum, a PSL scalar type/);
  });

  it('refuses two top-level blocks that share a name', () => {
    expect(() =>
      buildPslDocumentAst(schemaIR, printerOptions, foreignKeyExtras, 'app', undefined, [
        enumBlock('Kind', { small: 'small' }),
        enumBlock('Kind', { large: 'large' }),
      ]),
    ).toThrow(/another recovered declaration/);
  });

  it('refuses a top-level block named after a PSL scalar type', () => {
    expect(() =>
      buildPslDocumentAst(schemaIR, printerOptions, foreignKeyExtras, 'app', undefined, [
        enumBlock('Int', { small: 'small' }),
      ]),
    ).toThrow(/collides with a model, a native enum, a PSL scalar type/);
  });

  it('splits into a flat bucket and a named one when both have content', () => {
    const ast = buildPslDocumentAst(schemaIR, printerOptions, foreignKeyExtras, 'app', undefined, [
      enumBlock('WidgetKind', { small: 'small', large: 'large' }),
    ]);
    expect(ast.namespaces.map((n) => n.name)).toEqual([UNSPECIFIED_PSL_NAMESPACE_ID, 'app']);
    expect(Object.keys(ast.namespaces[0]?.entries?.['enum'] ?? {})).toEqual(['WidgetKind']);
    expect(Object.keys(ast.namespaces[1]?.entries?.['model'] ?? {})).toEqual(['Widget']);
  });

  it('puts top-level blocks in the single flat bucket when there is no wrap to escape', () => {
    const ast = buildPslDocumentAst(
      schemaIR,
      printerOptions,
      foreignKeyExtras,
      undefined,
      undefined,
      [enumBlock('WidgetKind', { small: 'small', large: 'large' })],
    );
    expect(ast.namespaces).toHaveLength(1);
    expect(ast.namespaces[0]?.name).toBe(UNSPECIFIED_PSL_NAMESPACE_ID);
    expect(Object.keys(ast.namespaces[0]?.entries?.['enum'] ?? {})).toEqual(['WidgetKind']);
  });

  it('prints the block unwrapped on both sides of the split, above the wrap and below the models', () => {
    // Position differs between the two paths because a single bucket prints
    // its models before its blocks. Both keep the block top-level, which is
    // what a wrap would have broken; pinned here so the difference stays
    // deliberate rather than being discovered on a re-emit.
    const blocks = [enumBlock('WidgetKind', { small: 'small', large: 'large' })];

    const split = print(
      buildPslDocumentAst(schemaIR, printerOptions, foreignKeyExtras, 'app', undefined, blocks),
    );
    expect(split).toContain('enum WidgetKind {');
    expect(split).toContain('namespace app {');
    expect(split).not.toMatch(/namespace\s+__unspecified__/);
    expect(split.indexOf('enum WidgetKind {')).toBeLessThan(split.indexOf('namespace app {'));

    const merged = print(
      buildPslDocumentAst(schemaIR, printerOptions, foreignKeyExtras, undefined, undefined, blocks),
    );
    expect(merged).toContain('enum WidgetKind {');
    expect(merged).toContain('model Widget {');
    expect(merged).not.toMatch(/namespace\s/);
    expect(merged.indexOf('model Widget {')).toBeLessThan(merged.indexOf('enum WidgetKind {'));
  });
});
