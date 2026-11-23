import type { BetterAuthOptions } from '@better-auth/core';
import { twoFactor } from 'better-auth/plugins';
import { describe, expect, it } from 'vitest';
import { editContractSource } from '../../src/generate/edit-contract-source';
import { useContractFixture } from '../helpers/contract-fixture';
import type { TargetName } from '../helpers/databases';
import {
  type AdapterOptionsForComparison,
  compare,
  pslForConfiguration,
} from '../helpers/printed-psl';
import {
  appPsl,
  contractPath,
  insertAfter,
  refusal,
  twoFactorModel,
  userLastField,
} from './sources';

const fixture = useContractFixture();
const options = { plugins: [twoFactor()] };
const emitFirst =
  'which the emitted contract does not have. Run `prisma contract emit`, then update your database.';
const notChanged = '`auth generate` did not change your contract, because';
const twoFactorAdded = '\n  twoFactorEnabled Boolean?\n  twoFactors       TwoFactor[]';

async function comparisonOver(
  psl: string,
  target: TargetName = 'sqlite',
  betterAuthOptions: BetterAuthOptions = options,
  adapterOptions: AdapterOptionsForComparison = {},
) {
  return compare(await fixture().contractOf(target, psl), betterAuthOptions, adapterOptions);
}

function storedUnderAnotherName(stored: string, lookedFor: string, renameTo: string): string {
  return `${notChanged} ${contractPath} stores ${stored}, but Better Auth looks for ${lookedFor}. Rename ${renameTo}, then run \`prisma contract emit\`.`;
}

describe('auth generate when the source declares, and has not emitted, what it would add', () => {
  it('refuses a model with the name Better Auth looks up, mapped to another table', async () => {
    const comparison = await comparisonOver(appPsl);
    const text = `${appPsl}\nmodel twoFactor {\n  id String @id\n\n  @@map("two_factor")\n}\n`;
    expect(() => editContractSource([{ path: contractPath, text }], comparison)).toThrow(
      refusal(comparison, `${notChanged} ${contractPath} already declares twoFactor, ${emitFirst}`),
    );
  });

  it('refuses a model without @@map with the name Better Auth looks up', async () => {
    const comparison = await comparisonOver(appPsl);
    const text = `${appPsl}\nmodel twoFactor {\n  id String @id\n}\n`;
    expect(() => editContractSource([{ path: contractPath, text }], comparison)).toThrow(
      refusal(comparison, `${notChanged} ${contractPath} already declares twoFactor, ${emitFirst}`),
    );
  });

  it('refuses a model with that name in another Postgres namespace when the adapter searches every namespace', async () => {
    const comparison = await comparisonOver(appPsl, 'postgres');
    const text = `${appPsl}\nnamespace legacy {\n  model TwoFactor {\n    id String @id\n  }\n}\n`;
    expect(() => editContractSource([{ path: contractPath, text }], comparison)).toThrow(
      refusal(comparison, `${notChanged} ${contractPath} already declares TwoFactor, ${emitFirst}`),
    );
  });

  it("ignores a model with that name outside the namespace the adapter's namespace option names", async () => {
    const comparison = await comparisonOver(appPsl, 'postgres', options, { namespace: 'public' });
    const text = `${appPsl}\nnamespace legacy {\n  model TwoFactor {\n    id String @id\n  }\n}\n`;
    const indentedModel = twoFactorModel
      .split('\n')
      .map((line) => (line === '' ? '' : `  ${line}`))
      .join('\n');
    expect(editContractSource([{ path: contractPath, text }], comparison).code).toBe(
      `${insertAfter(text, userLastField, twoFactorAdded)}\nnamespace public {\n${indentedModel}\n}\n`,
    );
  });
});

describe('auth generate when the source stores what Better Auth needs under a name it does not look up', () => {
  it('refuses a model under another name in the table of the model it would add, emitted or not', async () => {
    const text = `${appPsl}\nmodel TwoFactorRecord {\n  id String @id\n\n  @@map("twoFactor")\n}\n`;
    const comparison = await comparisonOver(text);
    expect(() => editContractSource([{ path: contractPath, text }], comparison)).toThrow(
      refusal(
        comparison,
        storedUnderAnotherName(
          'TwoFactorRecord in the table "twoFactor"',
          'a model named TwoFactor',
          'TwoFactorRecord to TwoFactor',
        ),
      ),
    );
  });

  it('refuses a field under another name in the column of a field it would add, emitted or not', async () => {
    const text = insertAfter(
      appPsl,
      userLastField,
      '\n  tfEnabled Boolean? @map("twoFactorEnabled")',
    );
    const comparison = await comparisonOver(text);
    expect(() => editContractSource([{ path: contractPath, text }], comparison)).toThrow(
      refusal(
        comparison,
        storedUnderAnotherName(
          'User.tfEnabled in the column "twoFactorEnabled"',
          'a field named twoFactorEnabled in User',
          'User.tfEnabled to twoFactorEnabled',
        ),
      ),
    );
  });

  it('names the plural model Better Auth looks for under usePlural', async () => {
    const plural = pslForConfiguration(fixture().emptyContract('sqlite'), {}, { usePlural: true });
    const text = `${plural}\nmodel TwoFactorRecord {\n  id String @id\n\n  @@map("twoFactors")\n}\n`;
    const comparison = await comparisonOver(text, 'sqlite', options, { usePlural: true });
    expect(() => editContractSource([{ path: contractPath, text }], comparison)).toThrow(
      refusal(
        comparison,
        storedUnderAnotherName(
          'TwoFactorRecord in the table "twoFactors"',
          'a model named TwoFactors',
          'TwoFactorRecord to TwoFactors',
        ),
      ),
    );
  });

  it('names the model and field Better Auth looks for after a plugin renamed them', async () => {
    const renamed = {
      plugins: [
        twoFactor({
          schema: {
            twoFactor: { modelName: 'mfa' },
            user: { fields: { twoFactorEnabled: 'mfaOn' } },
          },
        }),
      ],
    };
    const text = `${insertAfter(appPsl, userLastField, '\n  tfEnabled Boolean? @map("mfaOn")')}\nmodel MfaRecord {\n  id String @id\n\n  @@map("mfa")\n}\n`;
    const comparison = await comparisonOver(text, 'sqlite', renamed);
    expect(() => editContractSource([{ path: contractPath, text }], comparison)).toThrow(
      refusal(
        comparison,
        `${storedUnderAnotherName(
          'User.tfEnabled in the column "mfaOn"',
          'a field named mfaOn in User',
          'User.tfEnabled to mfaOn',
        )} ${contractPath} stores MfaRecord in the table "mfa", but Better Auth looks for a model named Mfa. Rename MfaRecord to Mfa, then run \`prisma contract emit\`.`,
      ),
    );
  });

  it('names the field Better Auth looks for from additionalFields', async () => {
    const text = insertAfter(appPsl, userLastField, '\n  nick String? @map("nickname")');
    const withNickname = {
      user: { additionalFields: { nickname: { type: 'string' as const, required: false } } },
    };
    const comparison = await comparisonOver(text, 'sqlite', withNickname);
    expect(() => editContractSource([{ path: contractPath, text }], comparison)).toThrow(
      refusal(
        comparison,
        storedUnderAnotherName(
          'User.nick in the column "nickname"',
          'a field named nickname in User',
          'User.nick to nickname',
        ),
      ),
    );
  });

  it('compares table names ignoring case on SQLite', async () => {
    const comparison = await comparisonOver(appPsl);
    const text = `${appPsl}\nmodel Mfa {\n  id String @id\n\n  @@map("TWOFACTOR")\n}\n`;
    expect(() => editContractSource([{ path: contractPath, text }], comparison)).toThrow(
      refusal(
        comparison,
        storedUnderAnotherName(
          'Mfa in the table "TWOFACTOR"',
          'a model named TwoFactor',
          'Mfa to TwoFactor',
        ),
      ),
    );
  });

  it('folds only the letters A to Z when it compares SQLite names, as SQLite does', async () => {
    const withKind = {
      user: { additionalFields: { kind: { type: 'string' as const, required: false } } },
    };
    const kelvin = insertAfter(appPsl, userLastField, '\n  legacyKind String? @map("\u212Aind")');
    const ascii = insertAfter(appPsl, userLastField, '\n  legacyKind String? @map("KIND")');
    const kelvinComparison = await comparisonOver(kelvin, 'sqlite', withKind);
    const asciiComparison = await comparisonOver(ascii, 'sqlite', withKind);
    expect(editContractSource([{ path: contractPath, text: kelvin }], kelvinComparison).code).toBe(
      insertAfter(kelvin, '  legacyKind String? @map("\u212Aind")', '\n  kind String?'),
    );
    expect(() =>
      editContractSource([{ path: contractPath, text: ascii }], asciiComparison),
    ).toThrow(
      refusal(
        asciiComparison,
        storedUnderAnotherName(
          'User.legacyKind in the column "KIND"',
          'a field named kind in User',
          'User.legacyKind to kind',
        ),
      ),
    );
  });

  it('compares table names exactly on Postgres', async () => {
    const text = `${appPsl}\nmodel Mfa {\n  id String @id\n\n  @@map("TWOFACTOR")\n}\n`;
    const comparison = await comparisonOver(text, 'postgres');
    expect(editContractSource([{ path: contractPath, text }], comparison).code).toBe(
      `${insertAfter(text, userLastField, twoFactorAdded)}\n${twoFactorModel}\n`,
    );
  });

  it('ignores a model in another Postgres namespace stored in a table of the same name', async () => {
    const text = `${appPsl}\nnamespace legacy {\n  model Mfa {\n    id String @id\n\n    @@map("twoFactor")\n  }\n}\n`;
    const comparison = await comparisonOver(text, 'postgres');
    expect(editContractSource([{ path: contractPath, text }], comparison).code).toBe(
      `${insertAfter(text, userLastField, twoFactorAdded)}\n${twoFactorModel}\n`,
    );
  });

  it('adds the model and fields when the mapped names differ, and counts no relation field as a column', async () => {
    const text = `${insertAfter(appPsl, userLastField, '\n  legacy String? @map("twoFactors")')}\nmodel TwoFactorArchive {\n  id String @id\n\n  @@map("twoFactorArchive")\n}\n`;
    const comparison = await comparisonOver(text);
    const edit = editContractSource([{ path: contractPath, text }], comparison);
    expect({ path: edit.file.path, code: edit.code }).toEqual({
      path: contractPath,
      code: `${insertAfter(text, '  legacy String? @map("twoFactors")', twoFactorAdded)}\n${twoFactorModel}\n`,
    });
  });
});
