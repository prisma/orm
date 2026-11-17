import { describe, expect, it } from 'vitest';

import {
  RelationalSchemaNodeKind,
  relationalNodeEntityKind,
  relationalNodeGranularity,
} from '../src/ir/schema-node-kinds';

describe('relationalNodeGranularity', () => {
  it('rejects a kind outside the relational vocabulary, naming the kind', () => {
    expect(() => relationalNodeGranularity('postgres-policy')).toThrow(
      'relationalNodeGranularity: unrecognized relational node kind "postgres-policy"',
    );
  });
});

describe('relationalNodeEntityKind', () => {
  it('maps the table kind to the storage entity it keys', () => {
    expect(relationalNodeEntityKind(RelationalSchemaNodeKind.table)).toBe('table');
  });

  it('returns undefined for relational kinds nested under a table', () => {
    const nested = [
      RelationalSchemaNodeKind.column,
      RelationalSchemaNodeKind.columnDefault,
      RelationalSchemaNodeKind.primaryKey,
      RelationalSchemaNodeKind.foreignKey,
      RelationalSchemaNodeKind.unique,
      RelationalSchemaNodeKind.index,
      RelationalSchemaNodeKind.check,
      RelationalSchemaNodeKind.schema,
    ];

    expect(nested.map(relationalNodeEntityKind)).toEqual(nested.map(() => undefined));
  });

  it('returns undefined for a target-specific kind rather than throwing', () => {
    expect(relationalNodeEntityKind('postgres-namespace')).toBeUndefined();
  });
});
