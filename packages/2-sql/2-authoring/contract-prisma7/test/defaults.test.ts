import { describe, expect, it } from 'vitest';
import { loadFixtureTable } from './support';

describe('DateTime string defaults', () => {
  it('carry the default Postgres stores for each native type, not the text Prisma 7 writes', async () => {
    const { columns } = await loadFixtureTable('datetime-defaults', 'Scalars');
    const expressionOf = (column: string) => columns[column]?.['default'];
    expect({
      tsPlus: expressionOf('tsPlus'),
      tzPlus: expressionOf('tzPlus'),
      dMinus: expressionOf('dMinus'),
      tMs: expressionOf('tMs'),
      ttzPlus: expressionOf('ttzPlus'),
    }).toEqual({
      tsPlus: { kind: 'function', expression: "'2024-01-02 03:04:05'" },
      tzPlus: { kind: 'function', expression: "'2024-01-02 01:04:05+00'" },
      dMinus: { kind: 'function', expression: "'2024-01-02'" },
      tMs: { kind: 'function', expression: "'12:34:56.789'" },
      ttzPlus: { kind: 'function', expression: "'03:04:05+02'" },
    });
  });
});

describe('Bytes[] and DateTime[] list defaults', () => {
  it('carry an ARRAY literal of the elements Postgres stores, cast to the column type', async () => {
    const { columns } = await loadFixtureTable('list-defaults', 'Lists');
    expect(
      Object.fromEntries(
        ['bl', 'blEmpty', 'dl', 'dlEmpty', 'tzl', 'datel', 'timel', 'timetzl', 'ts6l'].map(
          (column) => [column, columns[column]?.['default']],
        ),
      ),
    ).toEqual({
      bl: { kind: 'function', expression: "ARRAY['\\x68656c6c6f', '\\x776f726c64']::BYTEA[]" },
      blEmpty: { kind: 'function', expression: 'ARRAY[]::BYTEA[]' },
      dl: {
        kind: 'function',
        expression: "ARRAY['2024-01-01 00:00:00', '2024-01-02 03:04:05.123']::TIMESTAMP(3)[]",
      },
      dlEmpty: { kind: 'function', expression: 'ARRAY[]::TIMESTAMP(3)[]' },
      tzl: { kind: 'function', expression: "ARRAY['2024-01-02 03:04:05+00']::TIMESTAMPTZ(6)[]" },
      datel: { kind: 'function', expression: "ARRAY['2024-01-02']::DATE[]" },
      timel: { kind: 'function', expression: "ARRAY['12:34:56']::TIME(6)[]" },
      timetzl: { kind: 'function', expression: "ARRAY['12:34:56+00']::TIMETZ(6)[]" },
      ts6l: {
        kind: 'function',
        expression: "ARRAY['2024-01-02 03:04:05.123456']::TIMESTAMP(6)[]",
      },
    });
  });
});
