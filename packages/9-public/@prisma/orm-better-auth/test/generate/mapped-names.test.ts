import type { BetterAuthOptions } from '@better-auth/core';
import { twoFactor } from 'better-auth/plugins';
import { describe, expect, it } from 'vitest';
import { editContractSource } from '../../src/generate/edit-contract-source';
import { useContractFixture } from '../helpers/contract-fixture';
import type { TargetName } from '../helpers/databases';
import { compare } from '../helpers/printed-psl';
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

async function comparisonOver(
  psl: string,
  target: TargetName = 'sqlite',
  betterAuthOptions: BetterAuthOptions = options,
) {
  return compare(await fixture().contractOf(target, psl), betterAuthOptions);
}

const twoFactorRecord = `${appPsl}\nmodel TwoFactorRecord {\n  id String @id\n\n  @@map("twoFactor")\n}\n`;
const tfEnabled = insertAfter(
  appPsl,
  userLastField,
  '\n  tfEnabled Boolean? @map("twoFactorEnabled")',
);
const renameModel =
  "Rename TwoFactorRecord to TwoFactor, or set Better Auth's `modelName` for twoFactor to TwoFactorRecord (for a plugin's model, in the plugin's `schema` option), then run `auth generate` again.";
const renameField =
  "Rename User.tfEnabled to twoFactorEnabled, or map Better Auth's field twoFactorEnabled to tfEnabled with the `fields` option (for a plugin's field, in the plugin's `schema` option), then run `auth generate` again.";

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
});

describe('auth generate when the source stores what Better Auth needs under a name it does not look up', () => {
  it('refuses a model under another name in the table of the model it would add, emitted or not', async () => {
    const comparison = await comparisonOver(twoFactorRecord);
    expect(() =>
      editContractSource([{ path: contractPath, text: twoFactorRecord }], comparison),
    ).toThrow(
      refusal(
        comparison,
        `${notChanged} ${contractPath} stores TwoFactorRecord in the table "twoFactor", which Better Auth's model twoFactor needs, but Better Auth finds a model by its name. ${renameModel}`,
      ),
    );
  });

  it('refuses a field under another name in the column of a field it would add, emitted or not', async () => {
    const comparison = await comparisonOver(tfEnabled);
    expect(() => editContractSource([{ path: contractPath, text: tfEnabled }], comparison)).toThrow(
      refusal(
        comparison,
        `${notChanged} ${contractPath} stores User.tfEnabled in the column "twoFactorEnabled", which Better Auth's field twoFactorEnabled needs, but Better Auth finds a field by its name. ${renameField}`,
      ),
    );
  });

  it("finds the model once the plugin's schema option names it, as the refusal advises", async () => {
    const text = `${insertAfter(appPsl, userLastField, '\n  twoFactorEnabled Boolean?\n  twoFactors TwoFactorRecord[]')}\n${twoFactorModel.replace('model TwoFactor {', 'model TwoFactorRecord {')}\n`;
    const renamed = {
      plugins: [twoFactor({ schema: { twoFactor: { modelName: 'TwoFactorRecord' } } })],
    };
    expect((await comparisonOver(text, 'sqlite', renamed)).problems).toEqual([]);
  });

  it("finds the field once the plugin's schema option maps it, as the refusal advises", async () => {
    const text = `${insertAfter(appPsl, userLastField, '\n  tfEnabled Boolean? @map("twoFactorEnabled")\n  twoFactors TwoFactor[]')}\n${twoFactorModel}\n`;
    const renamed = {
      plugins: [twoFactor({ schema: { user: { fields: { twoFactorEnabled: 'tfEnabled' } } } })],
    };
    expect((await comparisonOver(text, 'sqlite', renamed)).problems).toEqual([]);
  });

  it('compares table names ignoring case on SQLite', async () => {
    const comparison = await comparisonOver(appPsl);
    const text = `${appPsl}\nmodel Mfa {\n  id String @id\n\n  @@map("TWOFACTOR")\n}\n`;
    expect(() => editContractSource([{ path: contractPath, text }], comparison)).toThrow(
      refusal(
        comparison,
        `${notChanged} ${contractPath} stores Mfa in the table "TWOFACTOR", which Better Auth's model twoFactor needs, but Better Auth finds a model by its name. Rename Mfa to TwoFactor, or set Better Auth's \`modelName\` for twoFactor to Mfa (for a plugin's model, in the plugin's \`schema\` option), then run \`auth generate\` again.`,
      ),
    );
  });

  it('compares table names exactly on Postgres', async () => {
    const text = `${appPsl}\nmodel Mfa {\n  id String @id\n\n  @@map("TWOFACTOR")\n}\n`;
    const comparison = await comparisonOver(text, 'postgres');
    expect(editContractSource([{ path: contractPath, text }], comparison).code).toBe(
      `${insertAfter(text, userLastField, '\n  twoFactorEnabled Boolean?\n  twoFactors       TwoFactor[]')}\n${twoFactorModel}\n`,
    );
  });

  it('ignores a model in another Postgres namespace stored in a table of the same name', async () => {
    const text = `${appPsl}\nnamespace legacy {\n  model Mfa {\n    id String @id\n\n    @@map("twoFactor")\n  }\n}\n`;
    const comparison = await comparisonOver(text, 'postgres');
    expect(editContractSource([{ path: contractPath, text }], comparison).code).toBe(
      `${insertAfter(text, userLastField, '\n  twoFactorEnabled Boolean?\n  twoFactors       TwoFactor[]')}\n${twoFactorModel}\n`,
    );
  });

  it('adds the model and fields when the mapped names differ, and counts no relation field as a column', async () => {
    const text = `${insertAfter(appPsl, userLastField, '\n  legacy String? @map("twoFactors")')}\nmodel TwoFactorArchive {\n  id String @id\n\n  @@map("twoFactorArchive")\n}\n`;
    const comparison = await comparisonOver(text);
    const edit = editContractSource([{ path: contractPath, text }], comparison);
    expect({ path: edit.file.path, code: edit.code }).toEqual({
      path: contractPath,
      code: `${insertAfter(text, '  legacy String? @map("twoFactors")', '\n  twoFactorEnabled Boolean?\n  twoFactors       TwoFactor[]')}\n${twoFactorModel}\n`,
    });
  });
});
