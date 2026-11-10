import { IRNodeBase } from '@internal/framework-components/ir';
import { describe, expect, it } from 'vitest';
import { MongoCollationOptions } from '../../src/ir/mongo-collation-options';

describe('MongoCollationOptions', () => {
  it('constructs with required locale', () => {
    const opts = new MongoCollationOptions({ locale: 'en' });
    expect(opts.locale).toBe('en');
    expect(opts.caseLevel).toBeUndefined();
    expect(opts.strength).toBeUndefined();
  });

  it('constructs with full option set', () => {
    const opts = new MongoCollationOptions({
      locale: 'en_US',
      caseLevel: true,
      caseFirst: 'upper',
      strength: 3,
      numericOrdering: true,
      alternate: 'shifted',
      maxVariable: 'punct',
      backwards: false,
      normalization: true,
    });
    expect(opts.locale).toBe('en_US');
    expect(opts.caseLevel).toBe(true);
    expect(opts.caseFirst).toBe('upper');
    expect(opts.strength).toBe(3);
    expect(opts.numericOrdering).toBe(true);
    expect(opts.alternate).toBe('shifted');
    expect(opts.maxVariable).toBe('punct');
    expect(opts.backwards).toBe(false);
    expect(opts.normalization).toBe(true);
  });

  it('is an instance of IRNodeBase (extends the framework IR base)', () => {
    const opts = new MongoCollationOptions({ locale: 'en' });
    expect(opts).toBeInstanceOf(IRNodeBase);
    expect(opts).toBeInstanceOf(MongoCollationOptions);
  });

  it('is frozen after construction (mutation rejected in strict mode)', () => {
    const opts = new MongoCollationOptions({ locale: 'en' });
    expect(Object.isFrozen(opts)).toBe(true);
    expect(() => {
      Object.assign(opts, { locale: 'fr' });
    }).toThrow();
  });

  it('produces canonical JSON via JSON.stringify with kind included', () => {
    const opts = new MongoCollationOptions({ locale: 'en', strength: 2 });
    const json = JSON.parse(JSON.stringify(opts)) as Record<string, unknown>;
    expect(json).toEqual({ kind: 'mongo-collation-options', locale: 'en', strength: 2 });
  });

  it('omits undefined optional fields from canonical JSON', () => {
    const opts = new MongoCollationOptions({ locale: 'en' });
    const json = JSON.parse(JSON.stringify(opts)) as Record<string, unknown>;
    expect(json).toEqual({ kind: 'mongo-collation-options', locale: 'en' });
    expect(json).not.toHaveProperty('strength');
    expect(json).not.toHaveProperty('caseLevel');
  });
});
