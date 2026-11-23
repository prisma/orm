import type { BetterAuthOptions } from '@better-auth/core';
import { admin, twoFactor } from 'better-auth/plugins';
import { describe, expect, it } from 'vitest';
import { editContractSource } from '../../src/generate/edit-contract-source';
import { useContractFixture } from '../helpers/contract-fixture';
import { compare } from '../helpers/printed-psl';
import { appPsl, contractPath, refusal } from './sources';

const fixture = useContractFixture();
const options = { plugins: [twoFactor()] };
const userModel = /\/\/ The application's own comment[\s\S]*?\n}\n\n/;

async function comparisonOver(psl: string, betterAuthOptions: BetterAuthOptions = options) {
  return compare(await fixture().contractOf('sqlite', psl), betterAuthOptions);
}

describe('auth generate writes nothing and reports why', () => {
  it('when a source file does not parse, with the first parse error', async () => {
    const comparison = await comparisonOver(appPsl);
    const text = `${appPsl}\nmodel Broken {\n`;
    expect(() => editContractSource([{ path: contractPath, text }], comparison)).toThrow(
      refusal(
        comparison,
        `\`auth generate\` did not change your contract, because ${contractPath} does not parse: Unterminated block declaration (line 77).`,
      ),
    );
  });

  it('when a source file is not a Prisma 8 contract', async () => {
    const comparison = await comparisonOver(appPsl);
    const text = appPsl.replace('// use prisma-8\n', '');
    expect(() => editContractSource([{ path: contractPath, text }], comparison)).toThrow(
      refusal(
        comparison,
        `\`auth generate\` did not change your contract, because ${contractPath} does not start with \`// use prisma-8\`.`,
      ),
    );
  });

  it.each([
    { name: 'a field of the wrong type', psl: appPsl.replace('image    String?', 'image    Int?') },
    {
      name: 'an optional field that is required',
      psl: appPsl.replace('image    String?', 'image    String'),
    },
    {
      name: 'a required field Better Auth never writes',
      psl: appPsl.replace(
        "  posts   Post[] // the application's relation",
        "  posts   Post[] // the application's relation\n  nickname String",
      ),
    },
  ])('when the contract has $name, with only the message', async ({ psl }) => {
    const comparison = await comparisonOver(psl);
    expect(() => editContractSource([{ path: contractPath, text: psl }], comparison)).toThrow(
      refusal(comparison),
    );
  });

  it('when a model to extend is not in the source files', async () => {
    const comparison = await comparisonOver(appPsl);
    const text = appPsl.replace(userModel, '');
    expect(() => editContractSource([{ path: contractPath, text }], comparison)).toThrow(
      refusal(
        comparison,
        `\`auth generate\` did not change your contract, because no model User is declared in ${contractPath}.`,
      ),
    );
  });

  it('when a model to extend is declared more than once', async () => {
    const comparison = await comparisonOver(appPsl);
    const extra = {
      path: 'prisma/extra.prisma',
      text: '// use prisma-8\n\nmodel User {\n  id String @id\n}\n',
    };
    expect(() =>
      editContractSource([{ path: contractPath, text: appPsl }, extra], comparison),
    ).toThrow(
      refusal(
        comparison,
        `\`auth generate\` did not change your contract, because model User is declared more than once in ${contractPath} and ${extra.path}.`,
      ),
    );
  });

  it('when the additions belong in more than one file', async () => {
    const comparison = await comparisonOver(appPsl, { plugins: [admin()] });
    const split = appPsl.indexOf('model Session');
    const users = { path: 'prisma/users.prisma', text: appPsl.slice(0, split) };
    const auth = { path: 'prisma/auth.prisma', text: `// use prisma-8\n\n${appPsl.slice(split)}` };
    expect(() => editContractSource([users, auth], comparison)).toThrow(
      refusal(
        comparison,
        `\`auth generate\` did not change your contract, because the additions belong in ${users.path} and ${auth.path}, and Better Auth writes one file. Add them by hand.`,
      ),
    );
  });

  it('when a model has no field named id', async () => {
    const psl = appPsl
      .replace(
        '  id            String    @id\n  name',
        '  userId        String    @id @onCreate(uuid())\n  name',
      )
      .replaceAll(/(User\s+@relation\(fields: \[\w+\], references: )\[id\]/g, '$1[userId]');
    const comparison = await comparisonOver(psl, {});
    expect(() => editContractSource([{ path: contractPath, text: psl }], comparison)).toThrow(
      refusal(
        comparison,
        '`auth generate` did not change your contract, because model User has no field named `id`. Add the `id` field above by hand, with `@unique` in place of `@id`.',
      ),
    );
  });

  it('when the source already declares an addition, because the contract was not emitted', async () => {
    const comparison = await comparisonOver(appPsl);
    const edited = editContractSource([{ path: contractPath, text: appPsl }], comparison);
    expect(() =>
      editContractSource([{ path: contractPath, text: edited.code }], comparison),
    ).toThrow(
      refusal(
        comparison,
        `\`auth generate\` did not change your contract, because ${contractPath} already declares User.twoFactorEnabled, User.twoFactors and TwoFactor, which the emitted contract does not have. Run \`prisma contract emit\`, then update your database.`,
      ),
    );
  });

  it('when a model is written on one line, so its fields cannot be placed', async () => {
    const comparison = await comparisonOver(appPsl, {
      verification: { additionalFields: { note: { type: 'string', required: false } } },
    });
    const text = appPsl.replace(
      /model Verification \{[\s\S]*\}\n$/,
      'model Verification { id String @id }\n',
    );
    expect(() => editContractSource([{ path: contractPath, text }], comparison)).toThrow(
      refusal(
        comparison,
        '`auth generate` did not change your contract, because model Verification is written on one line. Put its `}` on a line of its own and run `auth generate` again.',
      ),
    );
  });
});
