import { describe, expect, it } from 'vitest';
import { loadFixtureTable } from './support';

describe('native types without arguments', () => {
  it('reads @db.Char with no length as character(1), the column Postgres creates for CHAR', async () => {
    const table = await loadFixtureTable('native-types-without-arguments', 'NativeTypes');
    expect(table.columns['char']).toMatchObject({
      nativeType: 'character',
      typeParams: { length: 1 },
    });
  });
});
