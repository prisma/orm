import { generateContractDts } from '@internal/emitter';
import type { CodecLookup } from '@internal/framework-components/codec';
import { describe, expect, it } from 'vitest';
import { sqlEmission } from '../src/index';
import { createEmitterTestContract as createContract } from './create-emitter-test-contract';

// Integration test for the typeRef-resolver path: exercise the real SQL emitter walk end-to-end. Confirms that `sqlEmission.resolveFieldTypeParams` walks `storage.fields → namespace tables → columns → storage.types[ref] or namespace.types[ref]` and that the framework emit path (`generateContractDts`) consults the resolver via the `EmissionSpi.resolveFieldTypeParams` hook.

const testHashes = { storageHash: 'test', profileHash: 'test' };

function vectorCodecLookup(): CodecLookup {
  const vectorCodec = {
    id: 'pg/vector@1',
    encode: async (v: unknown) => v,
    decode: (w: unknown) => w,
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

describe('sqlEmission.resolveFieldTypeParams (integration via generateContractDts)', () => {
  it('renders typeRef-shaped parameterized columns via the codec descriptor', () => {
    // Two columns share a named storage.types entry. The SQL emitter's resolveFieldTypeParams walk finds `Embedding1536`'s typeParams via `storage.fields[embedding].column → namespace tables → post.columns.embedding.typeRef → storage.types.Embedding1536.typeParams`, then the framework emit path renders the codec's output expression.
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
              type: { kind: 'scalar', codecId: 'pg/vector@1' },
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
    // FieldOutputTypes must use the rendered Vector<1536> type, not the raw codec accessor.
    const fieldOutputMatch = dts.match(/export type FieldOutputTypes = ({.+?});/s);
    expect(fieldOutputMatch).not.toBeNull();
    expect(fieldOutputMatch![0]).not.toContain('CodecTypes["pg/vector@1"]["output"]');
    // StorageColumnTypes is now param-refined too (it carries the full column type).
    const storageColumnMatch = dts.match(/export type StorageColumnTypes = ({.+?});/s);
    expect(storageColumnMatch).not.toBeNull();
    expect(storageColumnMatch![0]).toContain('Vector<1536>');
    expect(storageColumnMatch![0]).not.toContain('CodecTypes["pg/vector@1"]["output"]');
  });

  it('inline column typeParams continue to win over the resolver', () => {
    // Inline `field.type.typeParams` takes precedence: even though the SQL resolver could find `Embedding1536`, the inline 768 wins.
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

    // Inline 768 wins in the FIELD maps; the storage column keeps its own 1536.
    const fieldOutputMatch = dts.match(/export type FieldOutputTypes = ({.+?});/s);
    expect(fieldOutputMatch).not.toBeNull();
    expect(fieldOutputMatch![0]).toContain('readonly embedding: Vector<768>');
    expect(fieldOutputMatch![0]).not.toContain('Vector<1536>');
    const fieldInputMatch = dts.match(/export type FieldInputTypes = ({.+?});/s);
    expect(fieldInputMatch).not.toBeNull();
    expect(fieldInputMatch![0]).not.toContain('Vector<1536>');
    // StorageColumnTypes reflects the column's storage type (typeRef 1536).
    const storageColumnMatch = dts.match(/export type StorageColumnTypes = ({.+?});/s);
    expect(storageColumnMatch).not.toBeNull();
    expect(storageColumnMatch![0]).toContain('Vector<1536>');
  });
});
