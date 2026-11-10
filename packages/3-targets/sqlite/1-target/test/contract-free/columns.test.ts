import { describe, expect, it } from 'vitest';
import { datetime, integer, jsonText, sqliteTable, text } from '../../src/exports/contract-free';

describe('sqlite column type helpers', () => {
  it('column helpers return expected codec descriptors', () => {
    expect({
      text: text(),
      integer: integer(),
      jsonText: jsonText(),
      datetime: datetime(),
    }).toEqual({
      text: { codecId: 'sqlite/text@1', nullable: false },
      integer: { codecId: 'sqlite/integer@1', nullable: false },
      jsonText: { codecId: 'sqlite/json@1', nullable: false },
      datetime: { codecId: 'sqlite/datetime@1', nullable: false },
    });
  });

  it('text({ nullable: true }) returns a nullable descriptor', () => {
    expect(text({ nullable: true }).nullable).toBe(true);
  });
});

describe('sqliteTable()', () => {
  const marker = sqliteTable('_prisma_marker', {
    space: text(),
    core_hash: text(),
    contract_json: jsonText({ nullable: true }),
    canonical_version: integer({ nullable: true }),
    updated_at: datetime(),
    invariants: jsonText(),
  });

  it('creates a TableSource with the flat name', () => {
    expect(marker.source.name).toBe('_prisma_marker');
  });
});
