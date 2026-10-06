import { describe, expect, it } from 'vitest';
import { sqliteDataTypeEntries } from '../src/core/data-type-entries';
import sqliteTargetPack from '../src/exports/pack';

describe('the target descriptor authoring data types', () => {
  const registered = sqliteTargetPack.authoring.dataTypes;

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
