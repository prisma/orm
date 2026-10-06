import { describe, expect, it } from 'vitest';
import { VECTOR_MAX_DIM } from '../src/core/constants';
import { vector } from '../src/exports/column-types';

describe('pgvector column-types', () => {
  describe('vector() factory', () => {
    it('creates descriptor with typeParams.length', () => {
      const descriptor = vector(1536);
      expect(descriptor).toMatchObject({
        codecId: 'pg/vector@1',
        typeParams: { length: 1536 },
      });
    });

    it('preserves the dimension type parameter', () => {
      const descriptor768 = vector(768);
      const descriptor384 = vector(384);

      expect(descriptor768).toMatchObject({
        codecId: 'pg/vector@1',
        typeParams: { length: 768 },
      });

      expect(descriptor384).toMatchObject({
        codecId: 'pg/vector@1',
        typeParams: { length: 384 },
      });
    });

    it('works with OpenAI embedding dimensions', () => {
      const small = vector(1536);
      const large = vector(3072);

      expect(small).toMatchObject({
        codecId: 'pg/vector@1',
        typeParams: { length: 1536 },
      });

      expect(large).toMatchObject({
        codecId: 'pg/vector@1',
        typeParams: { length: 3072 },
      });
    });

    it('accepts the bounds of the data type', () => {
      expect(vector(1).typeParams).toEqual({ length: 1 });
      expect(vector(VECTOR_MAX_DIM).typeParams).toEqual({ length: VECTOR_MAX_DIM });
    });
  });
});
