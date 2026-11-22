import { describe, expect, it } from 'vitest';
import { testTypeLookups } from '../../1-core/contract/test/test-type-lookups';
import { contractToSchemaIR } from '../src/core/migrations/contract-to-schema-ir';
import { planFieldEventCalls } from '../src/core/migrations/field-event-planner';
import type { CodecControlHooks } from '../src/core/migrations/types';
import { col, contract, makeOp, noDataTypes, recordingHook, table } from './field-event-fixtures';

describe('names every object has as a property', () => {
  it('are a table of the schema IR like any other name', () => {
    const schema = contractToSchemaIR(
      contract({ constructor: table({ id: col({ codecId: 'pg/text@1' }) }) }),
      {
        annotationNamespace: 'pg',
        dataTypeLookup: testTypeLookups.dataTypeLookup,
        codecLookup: testTypeLookups.codecLookup,
      },
    );
    expect(Object.keys(schema.tables)).toEqual(['constructor']);
  });

  it('keep a table named __proto__ as a table of the schema IR', () => {
    const schema = contractToSchemaIR(
      contract(Object.fromEntries([['__proto__', table({ id: col({ codecId: 'pg/text@1' }) })]])),
      {
        annotationNamespace: 'pg',
        dataTypeLookup: testTypeLookups.dataTypeLookup,
        codecLookup: testTypeLookups.codecLookup,
      },
    );
    expect({
      tables: Object.keys(schema.tables),
      plainPrototype: Object.getPrototypeOf(schema.tables) === Object.prototype,
    }).toEqual({ tables: ['__proto__'], plainPrototype: true });
  });

  it('keep a column named __proto__ as a column of its table', () => {
    const schema = contractToSchemaIR(
      contract({
        users: table(Object.fromEntries([['__proto__', col({ codecId: 'pg/text@1' })]])),
      }),
      {
        annotationNamespace: 'pg',
        dataTypeLookup: testTypeLookups.dataTypeLookup,
        codecLookup: testTypeLookups.codecLookup,
      },
    );
    expect(Object.keys(schema.tables['users']?.columns ?? {})).toEqual(['__proto__']);
  });

  it('are added and dropped tables and fields, never altered ones', () => {
    const cs = recordingHook((call) => [
      makeOp(`${call.event}-${call.tableName}.${call.fieldName}`),
    ]);
    const calls = planFieldEventCalls({
      priorContract: contract({
        User: table({
          id: col({ codecId: 'pg/text@1' }),
          toString: col({ codecId: 'cs/string@1' }),
        }),
        valueOf: table({ id: col({ codecId: 'cs/string@1' }) }),
      }),
      newContract: contract({
        User: table({
          id: col({ codecId: 'pg/text@1' }),
          constructor: col({ codecId: 'cs/string@1' }),
        }),
        constructor: table({ id: col({ codecId: 'cs/string@1' }) }),
      }),
      codecHooks: new Map<string, CodecControlHooks>([['cs/string@1', cs.hook]]),
      tableRenames: [],
      columnRenames: [],
      dataTypes: noDataTypes,
    });
    expect(calls.map(({ call }) => call.factoryName).sort()).toEqual([
      'added-User.constructor',
      'added-constructor.id',
      'dropped-User.toString',
      'dropped-valueOf.id',
    ]);
  });
});
