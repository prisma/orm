import { sqliteDataTypeEntries } from '@internal/target-sqlite/data-types';
import { describe, expect, it } from 'vitest';
import sqliteAdapterDescriptor from '../src/exports/control';

describe('the adapter descriptor authoring data types', () => {
  const registered = sqliteAdapterDescriptor.authoring?.dataTypes ?? {};

  it('registers the entries the target declares', () => {
    expect(Object.keys(registered)).toEqual(Object.keys(sqliteDataTypeEntries()));
  });

  it('registers the json tag and leaves sql/expression and its tag to the family', () => {
    expect({
      hasSqlExpression: Object.hasOwn(registered, 'sql/expression'),
      tags: Object.values(registered).flatMap((entry) =>
        entry.written.kind === 'tag' ? [entry.written.tag] : [],
      ),
    }).toEqual({ hasSqlExpression: false, tags: ['json'] });
  });
});
