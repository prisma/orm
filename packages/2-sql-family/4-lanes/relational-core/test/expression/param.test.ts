import { describe, expect, it } from 'vitest';
import { ParamRef } from '../../src/exports/ast';
import { param } from '../../src/exports/expression';

describe('param', () => {
  it('forwards value + codecId to ParamRef.of', () => {
    const result = param('hello', { codecId: 'pg/text' });
    expect(result).toBeInstanceOf(ParamRef);
    expect(result.value).toBe('hello');
    expect(result.codec).toEqual({ codecId: 'pg/text' });
  });
});
