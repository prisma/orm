import { twoFactor } from 'better-auth/plugins';
import { describe, expect, it } from 'vitest';
import { editContractSource } from '../../src/generate/edit-contract-source';
import { useContractFixture } from '../helpers/contract-fixture';
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

async function comparisonOver(psl: string) {
  return compare(await fixture().contractOf('sqlite', psl), options);
}

describe('auth generate when the source stores something under another name', () => {
  it('refuses a model under another name mapped to the table of the model it would add', async () => {
    const comparison = await comparisonOver(appPsl);
    const text = `${appPsl}\nmodel TwoFactorRecord {\n  id String @id\n\n  @@map("twoFactor")\n}\n`;
    expect(() => editContractSource([{ path: contractPath, text }], comparison)).toThrow(
      refusal(
        comparison,
        `\`auth generate\` did not change your contract, because ${contractPath} already declares TwoFactorRecord (stored in the table "twoFactor"), ${emitFirst}`,
      ),
    );
  });

  it('refuses a model without @@map whose own name is the table of the model it would add', async () => {
    const comparison = await comparisonOver(appPsl);
    const text = `${appPsl}\nmodel twoFactor {\n  id String @id\n}\n`;
    expect(() => editContractSource([{ path: contractPath, text }], comparison)).toThrow(
      refusal(
        comparison,
        `\`auth generate\` did not change your contract, because ${contractPath} already declares twoFactor (stored in the table "twoFactor"), ${emitFirst}`,
      ),
    );
  });

  it('refuses a field under another name mapped to the column of a field it would add', async () => {
    const comparison = await comparisonOver(appPsl);
    const text = insertAfter(
      appPsl,
      userLastField,
      '\n  tfEnabled Boolean? @map("twoFactorEnabled")',
    );
    expect(() => editContractSource([{ path: contractPath, text }], comparison)).toThrow(
      refusal(
        comparison,
        `\`auth generate\` did not change your contract, because ${contractPath} already declares User.tfEnabled (stored in the column "twoFactorEnabled"), ${emitFirst}`,
      ),
    );
  });

  it('adds the model and fields when the mapped names differ', async () => {
    const text = `${insertAfter(appPsl, userLastField, '\n  legacy String? @map("twoFactor")')}\nmodel TwoFactorArchive {\n  id String @id\n\n  @@map("twoFactorArchive")\n}\n`;
    const comparison = await comparisonOver(text);
    const edit = editContractSource([{ path: contractPath, text }], comparison);
    expect({ path: edit.file.path, code: edit.code }).toEqual({
      path: contractPath,
      code: `${insertAfter(text, '  legacy String? @map("twoFactor")', '\n  twoFactorEnabled Boolean?\n  twoFactors       TwoFactor[]')}\n${twoFactorModel}\n`,
    });
  });
});
