import { describe, expect, it } from 'vitest';
import sqliteTargetPack from '../src/exports/pack';

describe('the target descriptor authoring data types', () => {
  const registered = sqliteTargetPack.authoring.dataTypes;

  it('registers the json, blob and date and time tags and leaves sql/expression and its tag to the family', () => {
    expect({
      hasSqlExpression: Object.hasOwn(registered, 'sql/expression'),
      tags: Object.values(registered).flatMap((entry) =>
        entry.written.kind === 'tag' ? [entry.written.tag] : [],
      ),
    }).toEqual({
      hasSqlExpression: false,
      tags: ['json', 'blob', 'datetime', 'date', 'time', 'duration'],
    });
  });

  it('registers each tag under the data type it reads, with no prefixed alias', () => {
    expect({
      json: registered['sqlite/json']?.written,
      datetime: registered['sqlite/datetime']?.written,
      blob: registered['sqlite/blob']?.written,
      prefixed: registered['sqlite.json'],
    }).toMatchObject({
      json: { kind: 'tag', tag: 'json' },
      datetime: { kind: 'tag', tag: 'datetime' },
      blob: { kind: 'tag', tag: 'blob' },
      prefixed: undefined,
    });
  });
});
