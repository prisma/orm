import type { ContractSourceDiagnostic } from '@internal/config/config-types';
import { buildSymbolTable } from '@internal/psl-parser';
import { parse } from '@internal/psl-parser/syntax';
import { describe, expect, it } from 'vitest';
import { interpretPslDocumentToMongoContract } from '../src/interpreter';

const scalarTypeCodecIds: ReadonlyMap<string, string> = new Map([
  ['String', 'mongo/string@1'],
  ['Int', 'mongo/int32@1'],
  ['ObjectId', 'mongo/objectId@1'],
]);

function diagnosticsOf(schema: string): readonly ContractSourceDiagnostic[] {
  const { document, sourceFile } = parse(schema);
  const { table } = buildSymbolTable({ document, sourceFile, pslBlockDescriptors: {} });
  const result = interpretPslDocumentToMongoContract({
    symbolTable: table,
    sourceFile,
    sourceId: 'schema.prisma',
    scalarTypeCodecIds,
    controlMutationDefaults: new Map(),
  });
  return result.ok ? [] : result.failure.diagnostics;
}

describe('field-level @id and @unique are interpreted against their specs', () => {
  it('rejects an argument on @id and no longer counts the field as the id', () => {
    const diagnostics = diagnosticsOf(`
      model Item {
        id   ObjectId @id("primary") @map("_id")
        name String
      }
    `);
    expect(diagnostics.map((d) => d.code)).toEqual([
      'PSL_INVALID_ATTRIBUTE_SYNTAX',
      'PSL_MISSING_ID_FIELD',
    ]);
  });

  it('rejects an argument on @unique and declares no index for it', () => {
    const diagnostics = diagnosticsOf(`
      model Item {
        id    ObjectId @id @map("_id")
        email String   @unique(1)
      }
    `);
    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: 'PSL_INVALID_ATTRIBUTE_SYNTAX',
        message: 'Attribute "unique" received too many positional arguments',
        span: expect.objectContaining({ start: expect.objectContaining({ line: 4 }) }),
      }),
    ]);
  });

  it('accepts bare @id and @unique', () => {
    expect(
      diagnosticsOf(`
        model Item {
          id    ObjectId @id @map("_id")
          email String   @unique
        }
      `),
    ).toEqual([]);
  });
});

describe('unknown attribute names diagnose against the registered namespace', () => {
  it('reports an unregistered model attribute with its span', () => {
    expect(
      diagnosticsOf(`
        model Item {
          id ObjectId @id @map("_id")
          @@shardKey([id])
        }
      `),
    ).toEqual([
      {
        code: 'PSL_UNSUPPORTED_MODEL_ATTRIBUTE',
        message: 'Model "Item" uses unsupported attribute "@@shardKey"',
        sourceId: 'schema.prisma',
        span: expect.objectContaining({ start: expect.objectContaining({ line: 4 }) }),
      },
    ]);
  });

  it('reports an unregistered field attribute with its span', () => {
    expect(
      diagnosticsOf(`
        model Item {
          id        ObjectId @id @map("_id")
          createdAt Int      @default(1)
        }
      `),
    ).toEqual([
      {
        code: 'PSL_UNSUPPORTED_FIELD_ATTRIBUTE',
        message:
          'Field "Item.createdAt" uses unsupported attribute "@default". Mongo has no default-value lowering; delete the attribute and apply the default in application code.',
        sourceId: 'schema.prisma',
        span: expect.objectContaining({ start: expect.objectContaining({ line: 4 }) }),
      },
    ]);
  });

  it('reports a namespaced field attribute by its full dotted name', () => {
    expect(
      diagnosticsOf(`
      model Item {
        id ObjectId @id @map("_id") @db.ObjectId
      }
    `),
    ).toEqual([
      expect.objectContaining({
        code: 'PSL_UNSUPPORTED_FIELD_ATTRIBUTE',
        message:
          'Field "Item.id" uses unsupported attribute "@db.ObjectId". Mongo has no native-type attributes; delete the attribute, the field\'s PSL type already selects its BSON codec.',
      }),
    ]);
  });

  it('tells the user to delete @updatedAt because Mongo never lowers it', () => {
    expect(
      diagnosticsOf(`
        model Item {
          id        ObjectId @id @map("_id")
          updatedAt Int      @updatedAt
        }
      `),
    ).toEqual([
      expect.objectContaining({
        code: 'PSL_UNSUPPORTED_FIELD_ATTRIBUTE',
        message:
          'Field "Item.updatedAt" uses unsupported attribute "@updatedAt". Mongo has no default-value lowering; delete the attribute and set the timestamp in application code.',
      }),
    ]);
  });

  it('reports an unregistered attribute on a composite-type field', () => {
    expect(
      diagnosticsOf(`
        type Address {
          street String @sensitivity("high")
        }
        model Item {
          id      ObjectId @id @map("_id")
          address Address
        }
      `),
    ).toEqual([
      expect.objectContaining({
        code: 'PSL_UNSUPPORTED_FIELD_ATTRIBUTE',
        message: 'Field "Address.street" uses unsupported attribute "@sensitivity"',
      }),
    ]);
  });

  it('accepts a schema that uses only registered attributes', () => {
    expect(
      diagnosticsOf(`
        type Address {
          street String @map("s")
        }
        model Item {
          id      ObjectId @id @map("_id")
          email   String   @unique
          owner   Owner    @relation(fields: [ownerId], references: [id])
          ownerId ObjectId
          address Address
          @@map("items")
          @@index([email(sort: Desc)])
          @@unique([ownerId, email])
          @@textIndex([email])
        }
        model Owner {
          id    ObjectId @id @map("_id")
          items Item[]
        }
      `),
    ).toEqual([]);
  });
});
