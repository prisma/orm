import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'pathe';
import { describe, expect, it } from 'vitest';
import { detectionPatterns } from '../guide-detections';

const GUIDE_PATH =
  'skills/prisma-8/upgrading/app/upgrades/8.0.0-rc.18-to-8.0.0-rc.19/instructions.md';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../../..');
const example = (path: string) => readFileSync(join(repoRoot, 'examples', path), 'utf-8');

function detects(content: string): boolean {
  return detectionPatterns(GUIDE_PATH, 'mongo-orm-uses-field-names').some((pattern) =>
    pattern.test(content),
  );
}

describe('mongo-orm-uses-field-names detection', () => {
  it.each([
    ['a filter on a variable named _id', 'const user = await db.orm.users.where({ _id }).first();'],
    ['a filter that names _id', 'await db.orm.users.where({ _id: userId }).first();'],
    ['a row read by _id', 'console.log(user._id.toHexString());'],
    ['a destructured _id', 'const { _id, email } = user;'],
    ['a selection of _id', "await db.orm.users.select('_id', 'email').all();"],
    ['a type that omits _id', "type NewUser = Omit<User, '_id'>;"],
  ])('finds %s', (_name, content) => {
    expect(detects(content)).toBe(true);
  });

  it.each([
    ['a generated contract.d.ts', example('mongo-demo/src/contract.d.ts')],
    [
      'a migration.ts',
      example('mongo-demo/migrations/app/20260626T1605_add_user_role_enum/migration.ts'),
    ],
    ['a TypeScript contract source', example('bundle-size/src/mongo/contract.ts')],
    [
      'code that names fields by their schema names',
      'await db.orm.users.where({ id }).select("id").all();',
    ],
    ['a name that ends in _id', 'const { user_id: owner } = row; owner.author_id;'],
  ])('skips %s', (_name, content) => {
    expect(detects(content)).toBe(false);
  });
});
