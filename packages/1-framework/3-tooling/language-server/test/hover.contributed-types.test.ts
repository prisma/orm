import { describe, expect, it } from 'vitest';
import { hover } from './helpers/hover';

describe('providePslHover', () => {
  it('shows a contributed type with documentation and args', () => {
    const result = hover('model Product {\n  price pg.Varc|har(255)\n}');
    expect(result).toEqual({
      contents: {
        kind: 'markdown',
        value: '```prisma\npg.Varchar(length: a number)\n```\n\nA variable-length string.',
      },
      range: { start: { line: 1, character: 11 }, end: { line: 1, character: 18 } },
    });
  });

  it('shows a contributed type alias with its documentation', () => {
    const result = hover('model Product {\n  createdAt pg.Created|At\n}');
    expect(result).toEqual({
      contents: {
        kind: 'markdown',
        value: '```prisma\npg.CreatedAt\n```\n\nSet to now when a row is created.',
      },
      range: { start: { line: 1, character: 15 }, end: { line: 1, character: 24 } },
    });
  });

  it('shows a contributed type without documentation as the bare path', () => {
    const result = hover('model Product {\n  label pg.Te|xt\n}');
    expect(result).toEqual({
      contents: { kind: 'markdown', value: '```prisma\npg.Text\n```' },
      range: { start: { line: 1, character: 11 }, end: { line: 1, character: 15 } },
    });
  });

  it('omits the documentation section when descriptor.documentation is empty', () => {
    const result = hover('model Product {\n  flag pg.Fl|ag\n}');
    expect(result).toEqual({
      contents: { kind: 'markdown', value: '```prisma\npg.Flag\n```' },
      range: { start: { line: 1, character: 10 }, end: { line: 1, character: 14 } },
    });
  });

  it('shows a value argument by the forms its data type is written in', () => {
    const result = hover('model Product {\n  labels pg.Ra|w(sql`text`)\n}');
    expect(result).toEqual({
      contents: {
        kind: 'markdown',
        value: '```prisma\npg.Raw(sql: sql`...`)\n```\n\nA type written as SQL.',
      },
      range: { start: { line: 1, character: 12 }, end: { line: 1, character: 15 } },
    });
  });

  it('shows a type choice with its choices as written and the explicit type each becomes', () => {
    const result = hover('model Product {\n  at pg.Mo|ment(as: text)\n}');
    expect(result?.contents).toEqual({
      kind: 'markdown',
      value: [
        '```prisma',
        'pg.Moment(as?: date | text, storage?: wide | narrow, precision?: a number)',
        '```',
        '',
        '`pg.Moment(as: text)` is exactly `pg.Text`.',
        '',
        'A moment in time.',
        '',
        '| as | storage | Becomes |',
        '| --- | --- | --- |',
        '| date (default) | wide (default) | `pg.Stamp(precision: 3)` |',
        '| text | wide (default) | `pg.Text` |',
        '| date (default) | narrow | `pg.Flag` |',
      ].join('\n'),
    });
  });

  it('shows the explicit type a bare type choice is, with the arguments its row defaults', () => {
    const value = hover('model Product {\n  at pg.Mo|ment\n}')?.contents;
    expect(value).toMatchObject({
      value: expect.stringContaining('`pg.Moment` is exactly `pg.Stamp(precision: 3)`.'),
    });
  });

  it('shows the explicit type with the arguments a call hands on', () => {
    const value = hover('model Product {\n  at pg.Mo|ment(precision: 6)\n}')?.contents;
    expect(value).toMatchObject({
      value: expect.stringContaining(
        '`pg.Moment(precision: 6)` is exactly `pg.Stamp(precision: 6)`.',
      ),
    });
  });

  it('names no explicit type for a call whose combination has no row', () => {
    const value = hover('model Product {\n  at pg.Mo|ment(as: text, storage: narrow)\n}')?.contents;
    expect(value).toMatchObject({ value: expect.not.stringContaining('is exactly') });
  });

  it('writes each argument of the explicit type as a literal of its data type', () => {
    const value = hover('model Product {\n  shape pg.Sha|pe\n}')?.contents;
    expect(value).toMatchObject({
      value: expect.stringContaining('`pg.Shape` is exactly `` pg.Raw(sql: sql`text`) ``.'),
    });
  });

  it('names no explicit type, and still hovers, when an argument has no literal', () => {
    const value = hover('model Product {\n  shape pg.Sha|pe(as: huge)\n}')?.contents;
    expect(value).toMatchObject({ value: expect.not.stringContaining('is exactly') });
    expect(value).toMatchObject({ value: expect.stringContaining('| huge | `pg.Stamp(...)` |') });
  });
});
