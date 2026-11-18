import type { LedgerEntryRecord } from '@internal/contract/types';
import { bold, cyan, cyanBright, dim } from 'colorette';
import stringWidth from 'string-width';
import { describe, expect, it } from 'vitest';
import {
  MIGRATION_LIST_EMPTY_SOURCE,
  MIGRATION_LIST_FORWARD_EDGE_GLYPH,
} from '../../../src/utils/formatters/migration-list-data-column';
import { createAnsiMigrationListStyler } from '../../../src/utils/formatters/migration-list-styler';
import {
  formatLedgerAppliedAt,
  renderMigrationLogTable,
  serializeLedgerEntriesForJson,
  sortLedgerEntries,
} from '../../../src/utils/formatters/migration-log-table';

function entry(
  overrides: Partial<LedgerEntryRecord> & Pick<LedgerEntryRecord, 'migrationName'>,
): LedgerEntryRecord {
  return {
    space: 'app',
    migrationHash: 'abc',
    from: null,
    to: 'dest',
    appliedAt: new Date('2026-06-01T08:00:00.000Z'),
    operationCount: 1,
    ...overrides,
  };
}

describe('sortLedgerEntries', () => {
  it('orders by appliedAt ascending with space and migrationName tie-break', () => {
    const sameTime = new Date('2026-06-01T08:00:00.000Z');
    const sorted = sortLedgerEntries([
      entry({ space: 'audit', migrationName: '002_b', appliedAt: sameTime }),
      entry({ space: 'app', migrationName: '002_b', appliedAt: sameTime }),
      entry({ space: 'app', migrationName: '001_a', appliedAt: sameTime }),
      entry({ migrationName: '003_c', appliedAt: new Date('2026-06-02T08:00:00.000Z') }),
    ]);
    expect(sorted.map((e) => [e.space, e.migrationName])).toEqual([
      ['app', '001_a'],
      ['app', '002_b'],
      ['audit', '002_b'],
      ['app', '003_c'],
    ]);
  });
});

describe('formatLedgerAppliedAt', () => {
  const date = new Date('2026-06-01T08:00:00.000Z');

  it('formats ISO-UTC for machine output', () => {
    expect(formatLedgerAppliedAt(date, 'iso')).toBe('2026-06-01T08:00:00.000Z');
  });

  it('formats UTC human output with Z suffix', () => {
    expect(formatLedgerAppliedAt(date, 'utc')).toBe('2026-06-01 08:00:00Z');
  });

  it('formats local output with numeric offset', () => {
    const formatted = formatLedgerAppliedAt(date, 'local');
    expect(formatted).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} [+-]\d{2}:\d{2}$/);
  });
});

describe('renderMigrationLogTable', () => {
  it('omits the space column for a single space', () => {
    const table = renderMigrationLogTable([
      entry({
        migrationName: '20260301_init',
        from: null,
        to: 'ef9de27abc',
        operationCount: 5,
        appliedAt: new Date('2026-06-01T08:00:00.000Z'),
      }),
    ]);
    expect(table).toContain('Applied at');
    expect(table).toContain('Migration');
    expect(table).not.toContain('Space');
    expect(table).not.toContain('app');
    expect(table).toContain('20260301_init');
    expect(table).toContain('∅ → ef9de27');
    expect(table).toContain('5 ops');
  });

  it('renders the single-space golden table with heading, divider, and data rows', () => {
    const table = renderMigrationLogTable(
      [
        entry({
          migrationName: '20260301_init',
          from: null,
          to: 'ef9de27abc',
          operationCount: 5,
          appliedAt: new Date('2026-06-01T08:00:00.000Z'),
        }),
        entry({
          migrationName: '20260302_add_users',
          from: 'ef9de27abc',
          to: 'abcd1234def',
          operationCount: 12,
          appliedAt: new Date('2026-06-02T10:30:00.000Z'),
        }),
      ],
      { utc: true },
    );
    expect(table).toBe(
      [
        ' Applied at             Migration            Change                 Ops ',
        '────────────────────── ──────────────────── ─────────────────── ────────',
        ' 2026-06-01 08:00:00Z   20260301_init        ∅ → ef9de27          5 ops ',
        ' 2026-06-02 10:30:00Z   20260302_add_users   ef9de27 → abcd123   12 ops ',
      ].join('\n'),
    );
  });

  it('renders the multi-space golden table with heading, divider, and data rows', () => {
    const table = renderMigrationLogTable(
      [
        entry({
          space: 'app',
          migrationName: '20260301_init',
          appliedAt: new Date('2026-06-01T08:00:00.000Z'),
        }),
        entry({
          space: 'audit',
          migrationName: '20260302_audit',
          appliedAt: new Date('2026-06-01T08:00:00.002Z'),
        }),
      ],
      { utc: true },
    );
    expect(table).toBe(
      [
        ' Applied at             Space   Migration        Change       Ops ',
        '────────────────────── ─────── ──────────────── ────────── ───────',
        ' 2026-06-01 08:00:00Z   app     20260301_init    ∅ → dest   1 ops ',
        ' 2026-06-01 08:00:00Z   audit   20260302_audit   ∅ → dest   1 ops ',
      ].join('\n'),
    );
  });

  it('returns an empty string for no entries', () => {
    expect(renderMigrationLogTable([])).toBe('');
  });

  it('uses ASCII glyphs when glyph mode is ascii', () => {
    const table = renderMigrationLogTable(
      [
        entry({
          migrationName: '20260301_init',
          from: null,
          to: 'ef9de27abc',
          appliedAt: new Date('2026-06-01T08:00:00.000Z'),
        }),
      ],
      { utc: true, glyphMode: 'ascii' },
    );
    expect(table).toContain('- -> ef9de27');
    expect(table).not.toContain(MIGRATION_LIST_FORWARD_EDGE_GLYPH);
    expect(table).not.toContain(MIGRATION_LIST_EMPTY_SOURCE);
    expect(table).not.toContain('─');
  });

  it('widens the migration column to fit the heading when names are shorter', () => {
    const table = renderMigrationLogTable(
      [entry({ migrationName: '01_a', appliedAt: new Date('2026-06-01T08:00:00.000Z') })],
      { utc: true },
    );
    const lines = table.split('\n');
    const changeIdx = lines[0]!.indexOf('Change');
    const migrationStart = lines[0]!.indexOf('Migration');
    const migrationWidth = changeIdx - migrationStart;
    expect(migrationWidth).toBeGreaterThanOrEqual('Migration'.length);
    const migrationChunk = lines[2]!.slice(migrationStart - 1, changeIdx - 1);
    expect(migrationChunk.trim()).toBe('01_a');
  });

  it('aligns columns when migration names are long', () => {
    const longName = '20260603T091500_super_long_migration_with_many_words';
    const table = renderMigrationLogTable(
      [
        entry({ migrationName: longName, appliedAt: new Date('2026-06-01T08:00:00.000Z') }),
        entry({ migrationName: '01_a', appliedAt: new Date('2026-06-02T08:00:00.000Z') }),
      ],
      { utc: true },
    );
    const lines = table.split('\n');
    const changeIdx = lines[0]!.indexOf('Change');
    const migrationStart = lines[0]!.indexOf('Migration');
    const opsIdx = lines[0]!.indexOf('Ops');
    const extractMigration = (line: string) => line.slice(migrationStart - 1, changeIdx - 1);
    const extractChange = (line: string) => line.slice(changeIdx - 1, opsIdx - 1);
    expect(extractMigration(lines[2]!).length).toBe(extractMigration(lines[3]!).length);
    expect(extractMigration(lines[2]!).trim()).toBe(longName);
    expect(extractChange(lines[2]!).length).toBe(extractChange(lines[3]!).length);
  });

  it('aligns columns when migration names use wide characters', () => {
    const wideName = '20260301_日本語';
    const table = renderMigrationLogTable(
      [
        entry({ migrationName: wideName, appliedAt: new Date('2026-06-01T08:00:00.000Z') }),
        entry({ migrationName: '01_a', appliedAt: new Date('2026-06-02T08:00:00.000Z') }),
      ],
      { utc: true },
    );
    const lines = table.split('\n');
    const changeVisualStart = (line: string) => {
      const idx = line.indexOf(MIGRATION_LIST_FORWARD_EDGE_GLYPH);
      return stringWidth(line.slice(0, idx));
    };
    expect(changeVisualStart(lines[2]!)).toBe(changeVisualStart(lines[3]!));
    expect(lines[2]!).toContain(wideName);
    expect(lines[3]!).toContain('01_a');
  });

  it('aligns columns when space names are long', () => {
    const longSpace = 'extension-some-very-long-space-id';
    const table = renderMigrationLogTable(
      [
        entry({
          space: longSpace,
          migrationName: '20260301_init',
          appliedAt: new Date('2026-06-01T08:00:00.000Z'),
        }),
        entry({
          space: 'app',
          migrationName: '20260302_other',
          appliedAt: new Date('2026-06-02T08:00:00.000Z'),
        }),
      ],
      { utc: true },
    );
    const lines = table.split('\n');
    const spaceStart = lines[0]!.indexOf('Space');
    const migrationStart = lines[0]!.indexOf('Migration');
    const extractSpace = (line: string) => line.slice(spaceStart - 1, migrationStart - 1);
    const extractTimestamp = (line: string) => line.slice(0, spaceStart - 1);
    expect(extractSpace(lines[2]!).length).toBe(extractSpace(lines[3]!).length);
    expect(extractSpace(lines[2]!).trim()).toBe(longSpace);
    expect(extractTimestamp(lines[2]!).length).toBe(extractTimestamp(lines[3]!).length);
  });
});

describe('renderMigrationLogTable with ANSI styler', () => {
  it('applies the shared migration family palette to each column token', () => {
    const table = renderMigrationLogTable(
      [
        entry({
          migrationName: '20260603T0915_migration',
          from: '4cb4256abcdef',
          to: 'ef9de27abcdef',
          operationCount: 3,
          appliedAt: new Date('2026-06-03T09:15:00.000Z'),
        }),
      ],
      { utc: true, styler: createAnsiMigrationListStyler({ useColor: true }) },
    );
    expect(table).toContain(bold('20260603T0915_migration'));
    expect(table).toContain(dim(cyan('4cb4256')));
    expect(table).toContain(dim(MIGRATION_LIST_FORWARD_EDGE_GLYPH));
    expect(table).toContain(cyanBright('ef9de27'));
    const dataLine = table.split('\n')[2]!;
    const migrationStart = table.split('\n')[0]!.indexOf('Migration');
    expect(dataLine).toContain('2026-06-03 09:15:00Z');
    expect(dataLine.slice(0, migrationStart - 1).trimEnd()).toBe(' 2026-06-03 09:15:00Z');
    expect(dataLine).toContain('3 ops');
    expect(dataLine.endsWith(' 3 ops ')).toBe(true);
    expect(table).toContain(dim('─'.repeat(22)));
  });

  it('styles the empty source glyph with dim and leaves space column unstyled', () => {
    const table = renderMigrationLogTable(
      [
        entry({
          space: 'app',
          migrationName: '20260301_init',
          from: null,
          to: 'ef9de27abc',
          appliedAt: new Date('2026-06-01T08:00:00.000Z'),
        }),
        entry({
          space: 'audit',
          migrationName: '20260302_audit',
          from: null,
          to: 'aaaaaaaaaaa',
          appliedAt: new Date('2026-06-01T08:00:00.002Z'),
        }),
      ],
      { utc: true, styler: createAnsiMigrationListStyler({ useColor: true }) },
    );
    expect(table).toContain(dim(MIGRATION_LIST_EMPTY_SOURCE));
    const lines = table.split('\n');
    const spaceStart = lines[0]!.indexOf('Space');
    const migrationStart = lines[0]!.indexOf('Migration');
    const extractSpace = (line: string) => line.slice(spaceStart - 1, migrationStart - 1).trim();
    expect(extractSpace(lines[2]!)).toBe('app');
    expect(extractSpace(lines[3]!)).toBe('audit');
    const ansiEsc = String.fromCharCode(27);
    expect(lines[2]!.slice(spaceStart - 1, migrationStart - 1)).not.toContain(`${ansiEsc}[`);
    expect(lines[3]!.slice(spaceStart - 1, migrationStart - 1)).not.toContain(`${ansiEsc}[`);
  });
});

describe('serializeLedgerEntriesForJson', () => {
  it('emits ISO-UTC appliedAt strings sorted ascending', () => {
    const json = serializeLedgerEntriesForJson([
      entry({
        migrationName: '002_later',
        appliedAt: new Date('2026-06-02T08:00:00.000Z'),
      }),
      entry({
        migrationName: '001_first',
        appliedAt: new Date('2026-06-01T08:00:00.000Z'),
      }),
    ]);
    expect(json).toHaveLength(2);
    expect(json[0]!.name).toBe('001_first');
    expect(json[0]!.appliedAt).toBe('2026-06-01T08:00:00.000Z');
    expect(json[1]!.appliedAt).toBe('2026-06-02T08:00:00.000Z');
  });

  it('uses name and hash field names (not migrationName/migrationHash)', () => {
    const json = serializeLedgerEntriesForJson([
      entry({ migrationName: '001_init', migrationHash: 'deadbeef' }),
    ]);
    expect(json[0]).toHaveProperty('name', '001_init');
    expect(json[0]).toHaveProperty('hash', 'deadbeef');
    expect(json[0]).not.toHaveProperty('migrationName');
    expect(json[0]).not.toHaveProperty('migrationHash');
  });
});
