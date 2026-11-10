import { isInternalError } from '@internal/utils/internal-error';
import { describe, expect, it } from 'vitest';
import { generatedLength } from '../src/index';
import { generateId } from '../src/runtime';

describe('@internal/ids', () => {
  it.each(['ulid', 'nanoid', 'uuidv7', 'uuidv4', 'cuid2', 'ksuid'] as const)(
    'generates values for %s',
    (id) => {
      const value = generateId({ id });
      expect(typeof value).toBe('string');
      expect(value).not.toBe('');
    },
  );

  it('applies generator params at runtime', () => {
    const value = generateId({ id: 'nanoid', params: { size: 12 } });
    expect(value).toHaveLength(12);
  });

  it('throws for unknown generator id', () => {
    expect(() => generateId({ id: 'nonexistent' })).toThrow('Unknown built-in ID generator');
  });

  it('throws an InternalError for an unknown generator id', () => {
    let thrown: unknown;
    try {
      generateId({ id: 'nonexistent' });
    } catch (error) {
      thrown = error;
    }
    expect(isInternalError(thrown)).toBe(true);
  });

  it('states how many characters each generator writes', () => {
    expect({
      ulid: generatedLength('ulid', undefined),
      nanoid: generatedLength('nanoid', undefined),
      nanoid12: generatedLength('nanoid', { size: 12 }),
      uuidv7: generatedLength('uuidv7', undefined),
      uuidv4: generatedLength('uuidv4', undefined),
      cuid2: generatedLength('cuid2', undefined),
      ksuid: generatedLength('ksuid', undefined),
    }).toEqual({
      ulid: 26,
      nanoid: 21,
      nanoid12: 12,
      uuidv7: 36,
      uuidv4: 36,
      cuid2: 24,
      ksuid: 27,
    });
  });
});
