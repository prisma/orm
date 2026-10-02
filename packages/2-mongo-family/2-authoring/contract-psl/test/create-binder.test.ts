import type { ContractSourceContext } from '@internal/config/config-types';
import type {
  AuthoringFieldNamespace,
  AuthoringTypeNamespace,
} from '@internal/framework-components/authoring';
import { buildSymbolTable, createBinder, EMPTY_DATA_TYPES } from '@internal/psl-parser';
import { parse, SyntaxNode } from '@internal/psl-parser/syntax';
import { describe, expect, it } from 'vitest';
import {
  describeUnsupportedMongoAttribute,
  mongoAttributeSpecs,
} from '../src/mongo-attribute-specs';

const SCHEMA = `
model User {
  id        ObjectId @id @map("_id")
  createdAt temporal.createdAt()
  score     Points
  weird     String   @unrecognized
  ghost     Unknown
  sessionId ObjectId
  session   Session  @relation(fields: [sessionId], references: [id])
  @@index([sessionId])
  @@unrecognizedModelAttribute
}

model Session {
  id ObjectId @id @map("_id")
}
`;

const fieldPresets: AuthoringFieldNamespace = {
  temporal: {
    createdAt: {
      kind: 'fieldPreset',
      output: { codecId: 'mongo/date@1', nativeType: 'date' },
    },
  },
};

const mongoScalarAuthoringTypes: AuthoringTypeNamespace = {
  String: { kind: 'typeConstructor', output: { codecId: 'mongo/string@1', nativeType: 'string' } },
  ObjectId: {
    kind: 'typeConstructor',
    output: { codecId: 'mongo/objectId@1', nativeType: 'objectId' },
  },
  Points: { kind: 'typeConstructor', output: { codecId: 'mongo/int32@1', nativeType: 'int' } },
};

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
    const { document, sources } = parse(SCHEMA, 'schema.prisma');
    const { symbolTable } = buildSymbolTable({ documents: [document], sources });

    const defaultFunctionRegistry = new Map();

    const context: ContractSourceContext = {
      composedExtensions: [],
      composedExtensionContracts: new Map(),
      authoringContributions: {
        dataTypes: {},
        field: fieldPresets,
        type: mongoScalarAuthoringTypes,
        entityTypes: {},
        pslBlockDescriptors: {},
        modelAttributes: {},
        attributeSpecs: mongoAttributeSpecs,
      },
      pslDiagnostics: { describeUnsupportedAttribute: describeUnsupportedMongoAttribute },
      codecLookup: {
        get: () => undefined,
        targetTypesFor: () => undefined,
        renderOutputTypeFor: () => undefined,
        descriptorFor: () => undefined,
      },
      controlMutationDefaults: { defaultFunctionRegistry, generatorDescriptors: [] },
      dataTypes: EMPTY_DATA_TYPES,
      resolvedInputs: [],
      capabilities: {},
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
        range: { start: { line: 10, character: 2 }, end: { line: 10, character: 30 } },
      },
      {
        code: 'PSL_UNSUPPORTED_FIELD_ATTRIBUTE',
        message: 'Field "User.weird" uses unsupported attribute "@unrecognized"',
        filename: 'schema.prisma',
        range: { start: { line: 5, character: 21 }, end: { line: 5, character: 34 } },
      },
    ]);

    expect(collectResolutions(document.syntax, binder)).toEqual([
      { kind: 'contributedType', name: 'ObjectId', path: ['ObjectId'] },
      { kind: 'attribute', name: 'id', level: 'field' },
      { kind: 'attribute', name: 'map', level: 'field' },
      { kind: 'contributedType', name: 'createdAt', path: ['temporal', 'createdAt'] },
      { kind: 'contributedType', name: 'Points', path: ['Points'] },
      { kind: 'contributedType', name: 'String', path: ['String'] },
      { kind: 'unresolved', name: 'Unknown' },
      { kind: 'contributedType', name: 'ObjectId', path: ['ObjectId'] },
      { kind: 'model', name: 'Session' },
      { kind: 'attribute', name: 'relation', level: 'field' },
      { kind: 'field', name: 'sessionId' },
      { kind: 'field', name: 'id' },
      { kind: 'attribute', name: 'index', level: 'model' },
      { kind: 'field', name: 'sessionId' },
      { kind: 'contributedType', name: 'ObjectId', path: ['ObjectId'] },
      { kind: 'attribute', name: 'id', level: 'field' },
      { kind: 'attribute', name: 'map', level: 'field' },
    ]);
  });
});
