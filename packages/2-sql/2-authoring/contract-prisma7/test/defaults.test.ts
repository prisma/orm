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
