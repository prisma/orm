import { twoFactor } from 'better-auth/plugins';
import { describe, expect, it } from 'vitest';
import { firstNewDiagnostic } from '../../src/generate/check-edited-source';
import { editContractSource } from '../../src/generate/edit-contract-source';
import { useContractFixture } from '../helpers/contract-fixture';
import { compare } from '../helpers/printed-psl';
import { appPsl, contractPath, refusal, userLastField } from './sources';

const fixture = useContractFixture();
const options = { plugins: [twoFactor()] };
const notChanged = '`auth generate` did not change your contract, because';

async function comparisonOver(psl: string) {
  return compare(await fixture().contractOf('sqlite', psl), options);
}

describe('auth generate when another declaration has the name of a model it would add', () => {
  it('refuses an enum with the name, and writes nothing', async () => {
    const text = `${appPsl}\nenum TwoFactor {\n  A\n}\n`;
    const comparison = await comparisonOver(text);
    expect(() => editContractSource([{ path: contractPath, text }], comparison)).toThrow(
      refusal(
        comparison,
        `${notChanged} ${contractPath} declares the enum TwoFactor, and Better Auth's model twoFactor needs that name. Rename the enum, then run \`auth generate\` again.`,
      ),
    );
  });

  it('refuses a mixin with the name', async () => {
    const comparison = await comparisonOver(appPsl);
    const text = `${appPsl}\nmodel mixin TwoFactor {\n  secret String\n}\n`;
    expect(() => editContractSource([{ path: contractPath, text }], comparison)).toThrow(
      refusal(
        comparison,
        `${notChanged} ${contractPath} declares the mixin TwoFactor, and Better Auth's model twoFactor needs that name. Rename the mixin, then run \`auth generate\` again.`,
      ),
    );
  });
});

describe('auth generate when a model includes a mixin that declares a field it would add', () => {
  it('refuses as a field the source has and the emitted contract lacks', async () => {
    const comparison = await comparisonOver(appPsl);
    const text = `${appPsl.replace(userLastField, `${userLastField}\n  +Mfa`)}\nmodel mixin Mfa {\n  twoFactorEnabled Boolean?\n}\n`;
    expect(() => editContractSource([{ path: contractPath, text }], comparison)).toThrow(
      refusal(
        comparison,
        `${notChanged} ${contractPath} already declares User.twoFactorEnabled (from the mixin Mfa), which the emitted contract does not have. Run \`prisma contract emit\`, then update your database.`,
      ),
    );
  });
});

describe('the check of the edited source', () => {
  it('reports the first diagnostic the edit introduces', () => {
    const edited = `${appPsl}\nmodel User {\n  id String @id\n}\n`;
    expect(
      firstNewDiagnostic(
        [{ path: contractPath, text: appPsl }],
        [{ path: contractPath, text: edited }],
        'public',
      ),
    ).toEqual({ path: contractPath, message: 'Duplicate declaration of "User"', line: 77 });
  });

  it('reports nothing when the original already had the same diagnostic', () => {
    const original = `${appPsl}\nmodel User {\n  id String @id\n}\n`;
    expect(
      firstNewDiagnostic(
        [{ path: contractPath, text: original }],
        [{ path: contractPath, text: `${original}\nmodel Extra {\n  id String @id\n}\n` }],
        'public',
      ),
    ).toBeUndefined();
  });
});
