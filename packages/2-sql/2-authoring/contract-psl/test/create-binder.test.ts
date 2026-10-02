import type { ContractSourceContext } from '@internal/config/config-types';
import type { AuthoringFieldNamespace } from '@internal/framework-components/authoring';
import { createBinder } from '@internal/psl-parser';
import { SyntaxNode } from '@internal/psl-parser/syntax';
import { describe, expect, it } from 'vitest';
import { describeUnsupportedSqlAttribute } from '../src/psl-field-resolution';
import { sqlAttributeSpecs } from '../src/sql-attribute-specs';
import { fixtureDataTypeSupport } from './fixture-data-types';
import {
  buildSymbolTableInput,
  createBuiltinLikeControlMutationDefaults,
  postgresCodecLookup,
  postgresScalarAuthoringTypes,
} from './fixtures';

const SCHEMA = `
model User {
  id        Int      @id
  createdAt temporal.createdAt()
  price     Money
  weird     String   @unrecognized
  ghost     Unknown
  session   Session?
  @@index([id])
  @@unrecognizedModelAttribute
}

namespace auth {
  model Account {
    id Int @id
  }
}

model Session {
  id        Int          @id
  accountId Int
  account   auth.Account @relation(fields: [accountId], references: [id])
}
`;

const fieldPresets: AuthoringFieldNamespace = {
  temporal: {
    createdAt: {
      kind: 'fieldPreset',
      output: { codecId: 'pg/timestamptz@1', nativeType: 'timestamptz' },
    },
  },
};

const authoringType = {
  ...postgresScalarAuthoringTypes,
  Money: { kind: 'typeConstructor', output: { codecId: 'pg/numeric@1', nativeType: 'numeric' } },
} as const;

function normalize(resolution: unknown): unknown {
  const r = resolution as {
    readonly kind: string;
    readonly symbol?: unknown;
    readonly name?: string;
  };
  switch (r.kind) {
    case 'attribute': {
      const symbol = r.symbol as { readonly name: string; readonly level: string };
      return { kind: 'attribute', name: symbol.name, level: symbol.level };
    }
    case 'contributedType': {
      const symbol = r.symbol as { readonly name: string; readonly path: readonly string[] };
      return { kind: 'contributedType', name: symbol.name, path: symbol.path };
    }
    case 'contributedNamespace': {
      const symbol = r.symbol as { readonly name: string };
      return { kind: 'contributedNamespace', name: symbol.name };
    }
    case 'crossSpace':
      return { kind: 'crossSpace' };
    case 'unresolved':
      return { kind: 'unresolved', name: r.name };
    case 'model':
    case 'compositeType':
    case 'namedType':
    case 'block':
    case 'namespace':
    case 'field': {
      const symbol = r.symbol as { readonly name: string };
      return { kind: r.kind, name: symbol.name };
    }
    default:
      return resolution;
  }
}

function collectResolutions(
  rootSyntax: SyntaxNode,
  binder: { symbolForNode(node: SyntaxNode): unknown },
) {
  const resolutions: unknown[] = [];
  for (const el of rootSyntax.descendants()) {
    if (el instanceof SyntaxNode) {
      const resolution = binder.symbolForNode(el);
      if (resolution !== undefined) {
        resolutions.push(normalize(resolution));
      }
    }
  }
  return resolutions;
}

describe('createBinder', () => {
  it('produces the expected diagnostics and resolution for every node', () => {
    const { documents, symbolTable, sources } = buildSymbolTableInput(SCHEMA);
    const controlMutationDefaultsBase = createBuiltinLikeControlMutationDefaults();

    const context: ContractSourceContext = {
      composedExtensions: [],
      composedExtensionContracts: new Map(),
      authoringContributions: {
        dataTypes: fixtureDataTypeSupport.entries,
        field: fieldPresets,
        type: authoringType,
        entityTypes: {},
        pslBlockDescriptors: {},
        modelAttributes: {},
        attributeSpecs: sqlAttributeSpecs,
      },
      pslDiagnostics: { describeUnsupportedAttribute: describeUnsupportedSqlAttribute },
      codecLookup: postgresCodecLookup,
      controlMutationDefaults: controlMutationDefaultsBase,
      dataTypeLookup: fixtureDataTypeSupport.lookup,
      resolvedInputs: [],
      capabilities: { sql: { scalarList: true } },
    };

    const { binder, diagnostics } = createBinder({ symbolTable, sources, context });

    expect(diagnostics).toEqual([
      {
        code: 'PSL_UNRESOLVED_REFERENCE',
        message: 'Cannot find type "Unknown"',
        data: { reference: 'type', name: 'Unknown', constructorCall: false },
        filename: 'schema.prisma',
        range: { start: { line: 6, character: 12 }, end: { line: 6, character: 19 } },
      },
      {
        code: 'PSL_UNSUPPORTED_MODEL_ATTRIBUTE',
        message: 'Model "User" uses unsupported attribute "@@unrecognizedModelAttribute"',
        filename: 'schema.prisma',
        range: { start: { line: 9, character: 2 }, end: { line: 9, character: 30 } },
      },
      {
        code: 'PSL_UNSUPPORTED_FIELD_ATTRIBUTE',
        message: 'Field "User.weird" uses unsupported attribute "@unrecognized"',
        filename: 'schema.prisma',
        range: { start: { line: 5, character: 21 }, end: { line: 5, character: 34 } },
      },
    ]);

    const rootSyntax = documents[0]?.syntax;
    if (rootSyntax === undefined) throw new Error('document missing');
    expect(collectResolutions(rootSyntax, binder)).toEqual([
      { kind: 'contributedType', name: 'Int', path: ['Int'] },
      { kind: 'attribute', name: 'id', level: 'field' },
      { kind: 'contributedType', name: 'createdAt', path: ['temporal', 'createdAt'] },
      { kind: 'contributedType', name: 'Money', path: ['Money'] },
      { kind: 'contributedType', name: 'String', path: ['String'] },
      { kind: 'unresolved', name: 'Unknown' },
      { kind: 'model', name: 'Session' },
      { kind: 'attribute', name: 'index', level: 'model' },
      { kind: 'field', name: 'id' },
      { kind: 'contributedType', name: 'Int', path: ['Int'] },
      { kind: 'attribute', name: 'id', level: 'field' },
      { kind: 'contributedType', name: 'Int', path: ['Int'] },
      { kind: 'attribute', name: 'id', level: 'field' },
      { kind: 'contributedType', name: 'Int', path: ['Int'] },
      { kind: 'model', name: 'Account' },
      { kind: 'attribute', name: 'relation', level: 'field' },
      { kind: 'field', name: 'accountId' },
      { kind: 'field', name: 'id' },
    ]);
  });
});
