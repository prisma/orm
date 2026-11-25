import { twoFactor } from 'better-auth/plugins';
import { describe, expect, it } from 'vitest';
import { useContractFixture } from '../helpers/contract-fixture';
import { targets } from '../helpers/databases';
import {
  afterEdit,
  appPsl,
  contractPath,
  editAndEmit,
  insertAfter,
  twoFactorCode,
  twoFactorModel,
  twoFactorSummary,
  userLastField,
} from './sources';

const fixture = useContractFixture();
const options = { plugins: [twoFactor()] };
const twoFactorFields = '\n  twoFactorEnabled Boolean?\n  twoFactors       TwoFactor[]';

function indented(text: string, indent: string): string {
  return text
    .split('\n')
    .map((line) => (line === '' ? '' : `${indent}${line}`))
    .join('\n');
}

describe('auth generate in a Postgres namespace', () => {
  it('adds fields inside the namespace block and the new model in a namespace block of its own', async () => {
    const authModels = appPsl
      .slice(appPsl.indexOf('model User'))
      .replace(`${userLastField}\n`, '')
      .replace(/\/\/\/ A doc comment[\s\S]*?\n}\n\n/, '');
    const text = `// use prisma-8\n\nnamespace auth {\n${indented(authModels, '  ')}}\n`;
    const code = `${insertAfter(text, '    accounts      Account[]', '\n    twoFactorEnabled Boolean?\n    twoFactors       TwoFactor[]')}\nnamespace auth {\n${indented(twoFactorModel, '  ')}\n}\n`;
    expect(
      await editAndEmit(fixture(), 'postgres', [{ path: contractPath, text }], options, {
        namespace: 'auth',
      }),
    ).toEqual({
      edit: {
        path: contractPath,
        code,
        summary: twoFactorSummary(contractPath),
      },
      problemsAfter: [],
    });
  });
});

describe.each(targets)('auth generate on %s', (target) => {
  it('edits only the file of a two-file contract that holds the model it extends', async () => {
    const split = appPsl.indexOf('model Session');
    const users = { path: 'prisma/users.prisma', text: appPsl.slice(0, split) };
    const auth = { path: 'prisma/auth.prisma', text: `// use prisma-8\n\n${appPsl.slice(split)}` };
    expect(await editAndEmit(fixture(), target, [users, auth], options)).toEqual({
      edit: {
        path: users.path,
        code: `${insertAfter(users.text, userLastField, twoFactorFields)}${twoFactorModel}\n`,
        summary: twoFactorSummary(users.path),
      },
      problemsAfter: [],
    });
  });

  it('writes CRLF line endings into a CRLF file', async () => {
    const text = appPsl.replaceAll('\n', '\r\n');
    expect(await editAndEmit(fixture(), target, [{ path: contractPath, text }], options)).toEqual({
      edit: {
        path: contractPath,
        code: twoFactorCode.replaceAll('\n', '\r\n'),
        summary: twoFactorSummary(contractPath),
      },
      problemsAfter: [],
    });
  });

  it('separates the new model with one blank line in a file without a final line break', async () => {
    const text = appPsl.trimEnd();
    expect(await editAndEmit(fixture(), target, [{ path: contractPath, text }], options)).toEqual({
      edit: {
        path: contractPath,
        code: `${insertAfter(text, userLastField, twoFactorFields)}\n\n${twoFactorModel}\n`,
        summary: twoFactorSummary(contractPath),
      },
      problemsAfter: [],
    });
  });

  it('indents added fields and models with tabs in a file indented with tabs', async () => {
    const text = appPsl.replace(/^ {2}/gm, '\t');
    const code = `${insertAfter(text, userLastField.replace('  ', '\t'), twoFactorFields.replaceAll('\n  ', '\n\t'))}\n${twoFactorModel.replace(/^ {2}/gm, '\t')}\n`;
    expect(await editAndEmit(fixture(), target, [{ path: contractPath, text }], options)).toEqual({
      edit: {
        path: contractPath,
        code,
        summary: twoFactorSummary(contractPath),
      },
      problemsAfter: [],
    });
  });
});

describe.each(targets)('auth generate on a model with no fields of its own on %s', (target) => {
  it('adds the fields after the line of the opening brace', async () => {
    const verification =
      /model Verification \{\n([\s\S]*)\n\n {2}@@index\(\[identifier\]\)\n {2}@@map\("verification"\)\n\}\n$/;
    const fields = verification.exec(appPsl)?.[1];
    if (fields === undefined) throw new Error('appPsl has no Verification model');
    const text = appPsl.replace(
      verification,
      `model mixin VerificationFields {\n${fields}\n}\n\nmodel Verification {\n  +VerificationFields\n\n  @@index([identifier])\n  @@map("verification")\n}\n`,
    );
    const options = {
      verification: { additionalFields: { note: { type: 'string' as const, required: false } } },
    };
    expect(await editAndEmit(fixture(), target, [{ path: contractPath, text }], options)).toEqual({
      edit: {
        path: contractPath,
        code: insertAfter(text, 'model Verification {', '\n  note String?'),
        summary: `Changes to ${contractPath}: 1 field added to Verification. ${afterEdit}`,
      },
      problemsAfter: [],
    });
  });
});
