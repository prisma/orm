import { generateContractDts } from '@internal/emitter';
import type { CodecLookup } from '@internal/framework-components/codec';
import { describe, expect, it } from 'vitest';
import { sqlEmission } from '../src/index';
import { createEmitterTestContract as createContract } from './create-emitter-test-contract';

const testHashes = { storageHash: 'test', profileHash: 'test' };

function vectorCodecLookup(): CodecLookup {
  const vectorCodec = {
    id: 'pg/vector@1',
    encode: async (v: unknown) => v,
    decode: async (w: unknown) => w,
    encodeJson: (v: unknown) => v as never,
    decodeJson: (j: unknown) => j as never,
  } as ReturnType<CodecLookup['get']>;
  return {
    get: (id) => (id === 'pg/vector@1' ? vectorCodec : undefined),
    targetTypesFor: (id) => (id === 'pg/vector@1' ? ['vector'] : undefined),
    renderOutputTypeFor: (id, params) =>
      id === 'pg/vector@1' ? `Vector<${params['length']}>` : undefined,
  };
}

describe('contract.d.ts types of a column typed by a named type', () => {
  it('types the field by its domain type parameters and the column by its named type', () => {
    const contract = createContract({
      models: {
        Post: {
          storage: {
            table: 'post',
            fields: {
              id: { column: 'id' },
              embedding: { column: 'embedding' },
            },
          },
          fields: {
            id: { nullable: false, type: { kind: 'scalar', codecId: 'pg/int4@1' } },
            embedding: {
              nullable: true,
              type: { kind: 'scalar', codecId: 'pg/vector@1', typeParams: { length: 1536 } },
            },
          },
          relations: {},
        },
      },
      storage: {
        tables: {
          post: {
            columns: {
              id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
              embedding: {
                nativeType: 'vector',
                codecId: 'pg/vector@1',
                nullable: true,
                typeRef: 'Embedding1536',
              },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
        types: {
          Embedding1536: {
            codecId: 'pg/vector@1',
            nativeType: 'vector',
            typeParams: { length: 1536 },
          },
        },
      },
    });

    const dts = generateContractDts(
      contract,
      sqlEmission,
      [],
      testHashes,
      undefined,
      vectorCodecLookup(),
    );

    expect(dts).toContain('readonly embedding: Vector<1536> | null');
    const fieldOutputMatch = dts.match(/export type FieldOutputTypes = ({.+?});/s);
    expect(fieldOutputMatch).not.toBeNull();
    expect(fieldOutputMatch![0]).not.toContain('CodecTypes["pg/vector@1"]["output"]');
    const storageColumnMatch = dts.match(/export type StorageColumnTypes = ({.+?});/s);
    expect(storageColumnMatch).not.toBeNull();
    expect(storageColumnMatch![0]).toContain('Vector<1536>');
    expect(storageColumnMatch![0]).not.toContain('CodecTypes["pg/vector@1"]["output"]');
  });

  it('types the field by its domain type and the column by its named type when the two differ', () => {
    const contract = createContract({
      models: {
        Post: {
          storage: {
            table: 'post',
            fields: { embedding: { column: 'embedding' } },
          },
          fields: {
            embedding: {
              nullable: false,
              type: {
                kind: 'scalar',
                codecId: 'pg/vector@1',
                typeParams: { length: 768 },
              },
            },
          },
          relations: {},
        },
      },
      storage: {
        tables: {
          post: {
            columns: {
              embedding: {
                nativeType: 'vector',
                codecId: 'pg/vector@1',
                nullable: false,
                typeRef: 'Embedding1536',
              },
            },
            primaryKey: { columns: ['embedding'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
        types: {
          Embedding1536: {
            codecId: 'pg/vector@1',
            nativeType: 'vector',
            typeParams: { length: 1536 },
          },
        },
      },
    });

    const dts = generateContractDts(
      contract,
      sqlEmission,
      [],
      testHashes,
      undefined,
      vectorCodecLookup(),
    );

    const fieldOutputMatch = dts.match(/export type FieldOutputTypes = ({.+?});/s);
    expect(fieldOutputMatch).not.toBeNull();
    expect(fieldOutputMatch![0]).toContain('readonly embedding: Vector<768>');
    expect(fieldOutputMatch![0]).not.toContain('Vector<1536>');
    const fieldInputMatch = dts.match(/export type FieldInputTypes = ({.+?});/s);
    expect(fieldInputMatch).not.toBeNull();
    expect(fieldInputMatch![0]).not.toContain('Vector<1536>');
    const storageColumnMatch = dts.match(/export type StorageColumnTypes = ({.+?});/s);
    expect(storageColumnMatch).not.toBeNull();
    expect(storageColumnMatch![0]).toContain('Vector<1536>');
  });
});
