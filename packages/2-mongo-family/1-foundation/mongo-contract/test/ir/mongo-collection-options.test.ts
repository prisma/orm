import { IRNodeBase } from '@internal/framework-components/ir';
import { describe, expect, it } from 'vitest';
import { MongoChangeStreamPreAndPostImagesOptions } from '../../src/ir/mongo-change-stream-pre-and-post-images-options';
import { MongoCollationOptions } from '../../src/ir/mongo-collation-options';
import { MongoCollectionOptions } from '../../src/ir/mongo-collection-options';
import { MongoTimeSeriesCollectionOptions } from '../../src/ir/mongo-time-series-collection-options';

describe('MongoCollectionOptions', () => {
  it('constructs empty (all fields optional)', () => {
    const opts = new MongoCollectionOptions();
    expect(opts.kind).toBe('mongo-collection-options');
    expect(opts.capped).toBeUndefined();
    expect(opts.timeseries).toBeUndefined();
  });

  it('persists the nested storage capped shape with size and optional max', () => {
    const opts = new MongoCollectionOptions({ capped: { size: 4096, max: 100 } });
    expect(opts.capped).toEqual({ size: 4096, max: 100 });
  });

  it('omits max when not provided on the nested capped form', () => {
    const opts = new MongoCollectionOptions({ capped: { size: 1024 } });
    expect(opts.capped).toEqual({ size: 1024 });
    expect(opts.capped?.max).toBeUndefined();
  });

  it('normalises a collation data literal to a MongoCollationOptions instance', () => {
    const opts = new MongoCollectionOptions({ collation: { locale: 'en', strength: 2 } });
    expect(opts.collation).toBeInstanceOf(MongoCollationOptions);
    expect(opts.collation?.locale).toBe('en');
  });

  it('preserves a passed-in class instance with identity equality', () => {
    const collation = new MongoCollationOptions({ locale: 'en' });
    const opts = new MongoCollectionOptions({ collation });
    expect(opts.collation).toBe(collation);
  });

  it('normalises a timeseries data literal to a class instance', () => {
    const opts = new MongoCollectionOptions({
      timeseries: { timeField: 'createdAt', granularity: 'hours' },
    });
    expect(opts.timeseries).toBeInstanceOf(MongoTimeSeriesCollectionOptions);
    expect(opts.timeseries?.timeField).toBe('createdAt');
  });

  it('normalises changeStreamPreAndPostImages to a class instance', () => {
    const opts = new MongoCollectionOptions({ changeStreamPreAndPostImages: { enabled: true } });
    expect(opts.changeStreamPreAndPostImages).toBeInstanceOf(
      MongoChangeStreamPreAndPostImagesOptions,
    );
    expect(opts.changeStreamPreAndPostImages?.enabled).toBe(true);
  });

  it('passes clusteredIndex name through verbatim (storage shape)', () => {
    const opts = new MongoCollectionOptions({ clusteredIndex: { name: 'primary' } });
    expect(opts.clusteredIndex).toEqual({ name: 'primary' });
  });

  it('accepts an empty clusteredIndex object (no name)', () => {
    const opts = new MongoCollectionOptions({ clusteredIndex: {} });
    expect(opts.clusteredIndex).toEqual({});
  });

  it('carries expireAfterSeconds for non-capped collections', () => {
    const opts = new MongoCollectionOptions({ expireAfterSeconds: 86400 });
    expect(opts.expireAfterSeconds).toBe(86400);
  });

  it('extends IRNodeBase and freezes', () => {
    const opts = new MongoCollectionOptions({ capped: { size: 4096 } });
    expect(opts).toBeInstanceOf(IRNodeBase);
    expect(opts).toBeInstanceOf(MongoCollectionOptions);
    expect(Object.isFrozen(opts)).toBe(true);
  });

  it('round-trips through canonical JSON with kind and nested class kinds included', () => {
    const opts = new MongoCollectionOptions({
      capped: { size: 4096 },
      collation: { locale: 'en' },
      changeStreamPreAndPostImages: { enabled: true },
    });
    expect(JSON.parse(JSON.stringify(opts))).toEqual({
      kind: 'mongo-collection-options',
      capped: { size: 4096 },
      collation: { kind: 'mongo-collation-options', locale: 'en' },
      changeStreamPreAndPostImages: {
        kind: 'mongo-change-stream-pre-and-post-images-options',
        enabled: true,
      },
    });
  });
});
