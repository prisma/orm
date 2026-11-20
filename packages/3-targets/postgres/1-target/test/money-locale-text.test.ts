import { describe, expect, it } from 'vitest';
import { pgMoneyDescriptor } from '../src/core/codecs';

// Texts PostgreSQL 17 printed for 1234.56, -1234.56 and 0.07 under each lc_monetary, on glibc.
const codec = pgMoneyDescriptor.factory()({ name: 'money-locale-text' });
const callCtx = {};

const scaledRowsWarning =
  'Warning: this locale stores money in whole units or in thousandths, so money values Prisma wrote while it was in effect are stored in its units (1234.56 is stored as 1235 under ja_JP). After lc_monetary is changed to C, those rows read back as wrong amounts, with no error. Check or correct the rows written since you upgraded Prisma before you change the setting.';

const fixWithoutWarning =
  "Set lc_monetary to C for the role or the database: ALTER ROLE <role> SET lc_monetary = 'C', or ALTER DATABASE <database> SET lc_monetary = 'C'. This applies to server connections opened afterwards; a connection pooler's existing server connections keep the old value until they are replaced. On a direct connection, not through a pooler, you can instead add options=-c%20lc_monetary%3DC to the connection URL.";

describe('pg/money text printed under a locale', () => {
  it.each([
    ['C', '$1,234.56', '1234.56'],
    ['C', '-$1,234.56', '-1234.56'],
    ['C', '$0.07', '0.07'],
    ['en_US.UTF-8', '$1,234.56', '1234.56'],
    ['en_US.UTF-8', '-$1,234.56', '-1234.56'],
    ['en_US.UTF-8', '$0.07', '0.07'],
  ])('reads the form %s prints, %s, as %s', async (_locale, wire, value) => {
    expect(await codec.fromWire(wire, callCtx)).toBe(value);
  });

  it.each([
    ['en_GB.UTF-8', '£1,234.56'],
    ['en_GB.UTF-8', '-£1,234.56'],
    ['de_DE.UTF-8', '1.234,56 €'],
    ['de_DE.UTF-8', '0,07 €'],
    ['es_CL.UTF-8', '$ 1.234,56'],
    ['zh_TW.UTF-8', 'NT$1,234.56'],
    ['es_MX.UTF-8', '$ 1 234.56'],
    ['fr_CA.UTF-8', '(1 234,56 $)'],
    ['fr_FR.UTF-8', '-1 234,56 €'],
    ['nl_NL.UTF-8', '€ -1.234,56'],
    ['en_SG.UTF-8', '($1,234.56)'],
    ['zh_CN.UTF-8', '￥1,234.56'],
  ])(
    'refuses the form %s prints, %s, without a warning about stored units, because that locale writes cents',
    async (_locale, wire) => {
      await expect(codec.fromWire(wire, callCtx)).rejects.toMatchObject({
        code: 'RUNTIME.LC_MONETARY_NOT_C',
        meta: { codecId: 'pg/money@1', received: wire },
        fix: fixWithoutWarning,
      });
    },
  );

  it.each([
    ['ja_JP.UTF-8', '￥1,235'],
    ['ja_JP.UTF-8', '￥-1,235'],
    ['ja_JP.UTF-8', '￥0'],
    ['ko_KR.UTF-8', '₩1,235'],
    ['ar_KW.UTF-8', 'د.ك. 1,234.560'],
    ['ar_KW.UTF-8', 'د.ك. 1,234.560-'],
    ['ar_KW.UTF-8', 'د.ك. 0.070'],
    ['is_IS.UTF-8', '1.235 kr'],
    ['is_IS.UTF-8', '0 kr'],
    ['vi_VN.UTF-8', '1.235₫'],
    ['vi_VN.UTF-8', '-₫1.235'],
  ])(
    'refuses the form %s prints, %s, and warns that rows written under it are in its units',
    async (_locale, wire) => {
      await expect(codec.fromWire(wire, callCtx)).rejects.toMatchObject({
        code: 'RUNTIME.LC_MONETARY_NOT_C',
        meta: { codecId: 'pg/money@1', received: wire },
        fix: `${fixWithoutWarning} ${scaledRowsWarning}`,
      });
    },
  );

  it('says what it read, that the driver does not set lc_monetary, and that the write may already be committed', async () => {
    await expect(codec.fromWire('1.234,56 €', callCtx)).rejects.toMatchObject({
      message:
        'Codec \'pg/money@1\' read "1.234,56 €", which is money as a locale other than C prints it. Prisma reads money only in the form the C locale prints, as in $1,234.56 and -$1,234.56.',
      why: "PostgreSQL prints a money value in the lc_monetary locale of the connection, with that locale's currency symbol, separators and sign. The PostgreSQL driver does not set lc_monetary, so the connection has the value the database or role sets, and here it prints another locale's form. A write that returns its row, such as create(), gets the row from the same statement, and Prisma decodes it only after PostgreSQL has run the statement: a single statement outside a transaction is already committed when this error is raised, and a transaction that ends with this error is rolled back.",
    });
  });
});
