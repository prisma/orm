import { twoFactor } from 'better-auth/plugins';
import { describe, expect, it } from 'vitest';
import { firstNewDiagnostic } from '../../src/generate/check-edited-source';
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

describe('auth generate when other kinds of declaration have the name of a model it would add', () => {
  it.each([
    { kind: 'composite type', declaration: 'type TwoFactor {\n  secret String\n}' },
    { kind: 'named type', declaration: 'types {\n  TwoFactor = String\n}' },
  ])('refuses a $kind with the name', async ({ kind, declaration }) => {
    const comparison = await comparisonOver(appPsl);
    const text = `${appPsl}\n${declaration}\n`;
    expect(() => editContractSource([{ path: contractPath, text }], comparison)).toThrow(
      refusal(
        comparison,
        `${notChanged} ${contractPath} declares the ${kind} TwoFactor, and Better Auth's model twoFactor needs that name. Rename the ${kind}, then run \`auth generate\` again.`,
      ),
    );
  });

  it('refuses a Postgres namespace with the name', async () => {
    const comparison = compare(await fixture().contractOf('postgres', appPsl), options);
    const text = `${appPsl}\nnamespace TwoFactor {\n  model Old {\n    id String @id\n  }\n}\n`;
    expect(() => editContractSource([{ path: contractPath, text }], comparison)).toThrow(
      refusal(
        comparison,
        `${notChanged} ${contractPath} declares the namespace TwoFactor, and Better Auth's model twoFactor needs that name. Rename the namespace, then run \`auth generate\` again.`,
      ),
    );
  });

  it('adds the model when the declaration with its name is in another Postgres namespace', async () => {
    const comparison = compare(await fixture().contractOf('postgres', appPsl), options);
    const text = `${appPsl}\nnamespace legacy {\n  enum TwoFactor {\n    A\n  }\n}\n`;
    expect(editContractSource([{ path: contractPath, text }], comparison).code).toBe(
      `${insertAfter(text, userLastField, '\n  twoFactorEnabled Boolean?\n  twoFactors       TwoFactor[]')}\n${twoFactorModel}\n`,
    );
  });
});

describe('the check of the edited source', () => {
  it('refuses an edit Prisma would reject that the other checks do not foresee', async () => {
    const comparison = await comparisonOver(appPsl);
    const text = `${appPsl}\nnamespace unbound {\n  enum TwoFactor {\n    A\n  }\n}\n`;
    expect(() => editContractSource([{ path: contractPath, text }], comparison)).toThrow(
      refusal(
        comparison,
        `${notChanged} Prisma would not accept the edited ${contractPath}: Duplicate declaration of "TwoFactor" (line 85).`,
      ),
    );
  });

  it('reports the first diagnostic the edit introduces', () => {
    const added = '\nmodel User {\n  id String @id\n}\n';
    expect(
      firstNewDiagnostic(
        [{ path: contractPath, text: appPsl }],
        [{ path: contractPath, text: `${appPsl}${added}` }],
        'public',
        [{ path: contractPath, offset: appPsl.length, length: added.length }],
      ),
    ).toEqual({ path: contractPath, message: 'Duplicate declaration of "User"', line: 77 });
  });

  it('reports nothing when the original already had the same diagnostic', () => {
    const original = `${appPsl}\nmodel User {\n  id String @id\n}\n`;
    const added = '\nmodel Extra {\n  id String @id\n}\n';
    expect(
      firstNewDiagnostic(
        [{ path: contractPath, text: original }],
        [{ path: contractPath, text: `${original}${added}` }],
        'public',
        [{ path: contractPath, offset: original.length, length: added.length }],
      ),
    ).toBeUndefined();
  });

  it('names where the edit introduced a diagnostic the original also has elsewhere', () => {
    const original = `${appPsl}\nmodel A {\n  id   String @id\n  name Int\n  name Int\n}\n`;
    const added = '\n  name String';
    const at = original.indexOf(userLastField) + userLastField.length;
    const edited = `${original.slice(0, at)}${added}${original.slice(at)}`;
    expect(
      firstNewDiagnostic(
        [{ path: contractPath, text: original }],
        [{ path: contractPath, text: edited }],
        'public',
        [{ path: contractPath, offset: at, length: added.length }],
      ),
    ).toEqual({
      path: contractPath,
      message: 'Duplicate declaration of "name"',
      line: original.slice(0, at).split('\n').length + 1,
    });
  });
});
