import {
  ListCollectionsCommand,
  MongoAndExpr,
  MongoExistsExpr,
  MongoFieldFilter,
} from '@internal/mongo-query-ast/control';
import { describe, expect, it } from 'vitest';
import { createCollection } from '../src/core/migrations/migration-factories';

const absent = (...options: readonly string[]) =>
  options.map((option) => MongoExistsExpr.notExists(`options.${option}`));

const SCALARS = ['validationLevel', 'validationAction', 'capped', 'size', 'max'];
const DOCUMENTS = ['timeseries', 'collation', 'changeStreamPreAndPostImages', 'clusteredIndex'];

describe('createCollection postcheck', () => {
  it('holds only for a collection with none of the options, when the call gives none', () => {
    expect(createCollection('users').postcheck).toEqual([
      {
        description: 'collection users exists with the options it is created with',
        source: new ListCollectionsCommand(),
        filter: MongoAndExpr.of([
          MongoFieldFilter.eq('name', 'users'),
          ...absent('validator', ...SCALARS, ...DOCUMENTS),
        ]),
        expect: 'exists',
        object: 'collection "users"',
      },
    ]);
  });

  it('matches the validator, validation level and action the call sets', () => {
    const schema = { bsonType: 'object', properties: { name: { bsonType: 'string' } } };
    const [check] = createCollection('users', {
      validator: { $jsonSchema: schema },
      validationLevel: 'strict',
      validationAction: 'error',
    }).postcheck;
    expect(check?.filter).toEqual(
      MongoAndExpr.of([
        MongoFieldFilter.eq('name', 'users'),
        MongoFieldFilter.eq('options.validator.$jsonSchema', schema),
        MongoFieldFilter.eq('options.validationLevel', 'strict'),
        MongoFieldFilter.eq('options.validationAction', 'error'),
        ...absent('capped', 'size', 'max', ...DOCUMENTS),
      ]),
    );
  });

  it('matches only the given fields of the options MongoDB completes with defaults', () => {
    const [check] = createCollection('events', {
      capped: true,
      size: 5000,
      max: 10,
      timeseries: { timeField: 'at', metaField: 'source' },
      collation: { locale: 'fr', strength: 2 },
      changeStreamPreAndPostImages: { enabled: true },
      clusteredIndex: { key: { _id: 1 }, unique: true },
    }).postcheck;
    expect(check?.filter).toEqual(
      MongoAndExpr.of([
        MongoFieldFilter.eq('name', 'events'),
        ...absent('validator', 'validationLevel', 'validationAction'),
        MongoFieldFilter.eq('options.capped', true),
        MongoFieldFilter.eq('options.size', 5000),
        MongoFieldFilter.eq('options.max', 10),
        MongoFieldFilter.eq('options.timeseries.timeField', 'at'),
        MongoFieldFilter.eq('options.timeseries.metaField', 'source'),
        MongoFieldFilter.eq('options.collation.locale', 'fr'),
        MongoFieldFilter.eq('options.collation.strength', 2),
        MongoFieldFilter.eq('options.changeStreamPreAndPostImages.enabled', true),
        MongoFieldFilter.eq('options.clusteredIndex.key', { _id: 1 }),
        MongoFieldFilter.eq('options.clusteredIndex.unique', true),
      ]),
    );
  });

  it('takes an option set to a default MongoDB does not report as not set', () => {
    const [check] = createCollection('users', {
      capped: false,
      collation: { locale: 'simple' },
      changeStreamPreAndPostImages: { enabled: false },
    }).postcheck;
    expect(check?.filter).toEqual(
      MongoAndExpr.of([
        MongoFieldFilter.eq('name', 'users'),
        ...absent('validator', ...SCALARS, ...DOCUMENTS),
      ]),
    );
  });
});
