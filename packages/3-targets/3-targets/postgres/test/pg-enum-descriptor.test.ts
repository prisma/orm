import { describe, expect, it } from 'vitest';
import { pgEnumDescriptor } from '../src/core/codecs';

describe('PgEnumDescriptor (pg/enum@1) as a parameterized codec', () => {
  it('is parameterized with a { typeName: string } params schema', async () => {
    expect(pgEnumDescriptor.isParameterized).toBe(true);

    const valid = await pgEnumDescriptor.paramsSchema['~standard'].validate({
      typeName: 'auth.aal_level',
    });
    expect(valid).toMatchObject({ value: { typeName: 'auth.aal_level' } });

    const invalid = await pgEnumDescriptor.paramsSchema['~standard'].validate({ typeName: 42 });
    expect(invalid).toHaveProperty('issues');
  });

  it('represents the enum data type', () => {
    expect(pgEnumDescriptor.dataType).toBe('pg/enum');
  });
});
