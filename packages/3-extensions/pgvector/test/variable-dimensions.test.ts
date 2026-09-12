import { extractCodecControlHooks } from '@internal/family-sql/control';
import {
  instantiateAuthoringTypeConstructor,
  validateAuthoringHelperArguments,
} from '@internal/framework-components/authoring';
import { describe, expect, it } from 'vitest';
import { pgvectorAuthoringTypes } from '../src/core/authoring';
import { pgVectorColumn, pgVectorDescriptor } from '../src/core/codecs';
import { vector } from '../src/exports/column-types';
import control from '../src/exports/control';

describe('variable dimensions', () => {
  it('authors a vector without dimension metadata', () => {
    expect(vector()).toEqual({ codecId: 'pg/vector@1', nativeType: 'vector', typeParams: {} });
    expect(pgVectorColumn().typeParams).toEqual({});
  });

  it('authors PSL vectors without a length argument', () => {
    validateAuthoringHelperArguments(
      'pgvector.Vector',
      pgvectorAuthoringTypes.pgvector.Vector.args,
      [],
    );
    expect(
      instantiateAuthoringTypeConstructor(pgvectorAuthoringTypes.pgvector.Vector, []),
    ).toMatchObject({
      codecId: 'pg/vector@1',
      nativeType: 'vector',
    });
  });

  it('validates and renders undimensioned contracts', async () => {
    expect(await pgVectorDescriptor.paramsSchema['~standard'].validate({})).toEqual({ value: {} });
    expect(pgVectorDescriptor.renderOutputType({})).toBe('Vector');
    const hooks = extractCodecControlHooks([control]).get('pg/vector@1');
    expect(hooks?.expandNativeType?.({ nativeType: 'vector', typeParams: {} })).toBe('vector');
  });

  it('accepts different lengths through every codec path', async () => {
    const codec = pgVectorColumn().codecFactory({ name: 'embedding' });
    for (const value of [[1], [1, 2, 3], [1, 2]]) {
      const wire = `[${value.join(',')}]`;
      expect(await codec.encode(value, {})).toBe(wire);
      expect(await codec.decode(wire, {})).toEqual(value);
      expect(codec.encodeJson(value)).toEqual(value);
      expect(codec.decodeJson(value)).toEqual(value);
    }
  });
});
