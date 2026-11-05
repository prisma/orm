import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'pathe';
import { describe, expect, it } from 'vitest';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../../..');
const id = 'mongo-query-takes-context';
const facadePackage = ['@prisma', 'orm-mongo'].join('/');
const familyPackage = ['@prisma', 'orm-family-mongo'].join('/');

function detects(audience: 'app' | 'extension', content: string, change = id): boolean {
  const path = `skills/prisma-8/upgrading/${audience}/upgrades/8.0.0-rc.21-to-8.0.0-rc.22/instructions.md`;
  const guide = readFileSync(join(repoRoot, path), 'utf-8');
  const entry = guide.split(/\n {2}- id: /).find((block) => block.startsWith(`${change}\n`));
  if (entry === undefined) throw new Error(`The ${audience} guide has no change ${change}`);
  const patterns = [...entry.matchAll(/^ {8}- '(.*)'$/gm)].map(
    ([, pattern]) => new RegExp((pattern ?? '').replaceAll("''", "'")),
  );
  if (patterns.length === 0) throw new Error(`The ${audience} change ${change} has no detection`);
  return patterns.some((pattern) => pattern.test(content));
}

describe.each(['app', 'extension'] as const)('the %s mongoQuery detection', (audience) => {
  it.each([
    ['a call with a contract', 'const query = mongoQuery({ contract });'],
    ['a call with a named contract', 'mongoQuery({ contract: contractFromJson<Contract>(json) })'],
    ['a call with a type argument', 'mongoQuery<Contract>({\n  contract,\n})'],
    ['an aliased import', `import { mongoQuery as query } from '${facadePackage}/query-builder';`],
    [
      'a call through a namespace import',
      `import * as builder from '${familyPackage}/query-builder';\nbuilder.mongoQuery({ context });`,
    ],
  ])('finds %s', (_name, content) => {
    expect(detects(audience, content)).toBe(true);
  });

  it.each([
    ['a call with a context', 'const query = mongoQuery({ context });'],
    ['the static query', 'const { query } = mongoStatic({ contract });'],
    ['a method of the same name', 'db.mongoQuery({ contract })'],
    ['a longer name', 'myMongoQuery({ contract })'],
    [
      'a member call on another namespace',
      `import * as builder from '${facadePackage}/query-builder';\nother.mongoQuery({ context });`,
    ],
  ])('skips %s', (_name, content) => {
    expect(detects(audience, content)).toBe(false);
  });
});

describe.each(['app', 'extension'] as const)('the %s ORM and raw detection', (audience) => {
  const change = 'mongo-orm-takes-context';

  it.each([
    ['an ORM built from a contract', 'mongoOrm({ contract, executor, enums })'],
    ['an ORM with a type argument', 'mongoOrm<Contract>({\n  contract,\n  executor,\n})'],
    ['a raw client built from a contract', 'const raw = mongoRaw({ contract });'],
    ['the mutationDefaults option', 'mongoOrm({ context, executor, mutationDefaults: context })'],
    ['the removed error code', "if (error.code === 'ORM.MUTATION_DEFAULTS_MISSING') {}"],
    ['an ORM with an executor', 'mongoOrm({ context, executor: runtime })'],
    [
      'an ORM with enum accessors',
      'mongoOrm({\n  context,\n  runtime,\n  enums: buildMongoEnums(contract, codecs),\n})',
    ],
    [
      'a collection built from a contract',
      "createMongoCollection(contract, 'User', executor, enums)",
    ],
    ['the removed enum accessor type', 'let enums: MongoOrmEnums;'],
  ])('finds %s', (_name, content) => {
    expect(detects(audience, content, change)).toBe(true);
  });

  it.each([
    ['an ORM built from a context', 'mongoOrm({ context, runtime })'],
    ['a collection built from a context', "createMongoCollection({ context, runtime }, 'User')"],
    ['enum accessors read from a client', 'const enums = db.enums;'],
    ['a raw client built from a context', 'mongoRaw({ context })'],
    ['the static raw client', 'const { raw } = mongoStatic({ contract });'],
    ['a method of the same name', 'db.mongoOrm({ contract })'],
  ])('skips %s', (_name, content) => {
    expect(detects(audience, content, change)).toBe(false);
  });
});

describe.each(['app', 'extension'] as const)('the %s runtime adapter detection', (audience) => {
  const change = 'mongo-runtime-takes-adapter';

  it.each([
    ['a runtime built from a context', 'const runtime = createMongoRuntime({ context, driver });'],
    ['the stack read from a context', 'const adapter = context.stack.adapter;'],
    ['the stack read from a named context', 'mongoContext.stack.target.targetId'],
    ['a context type with a target id', "type Ctx = MongoExecutionContext<Contract, 'mongo'>;"],
    [
      'a context type with a generic contract and a target id',
      'MongoExecutionContext<MongoContract<Storage>, TTargetId>',
    ],
    ['a context type over unknown', 'MongoExecutionContext<unknown>'],
    ['the removed enum helper', 'const enums = buildMongoEnums(contract, context.codecs);'],
    ['the removed enum accessor type', 'let enums: MongoEnumAccessors;'],
    ['a context type over an object literal type', 'MongoExecutionContext<{ models: {} }>'],
  ])('finds %s', (_name, content) => {
    expect(detects(audience, content, change)).toBe(true);
  });

  it.each([
    ['a stack read from a stack', 'stack.adapter.create(stack)'],
    ['a method of the same name', 'factory.createMongoRuntime({ context })'],
    ['a stack on another object', 'options.stack.adapter'],
    ['a context type over one contract', 'MongoExecutionContext<Contract>'],
    ['a context type over a contract typeof', 'MongoExecutionContext<typeof contract>'],
    ['the enum accessors of a client', 'const { enums } = mongoStatic({ contract });'],
    ['a context type over a generic contract', 'MongoExecutionContext<MongoContract<Storage>>'],
    ['a stack built without a driver', 'createMongoExecutionStack({ target, adapter })'],
    [
      'a stack built with a driver',
      'createMongoExecutionStack({\n  target,\n  adapter,\n  driver: mongoDriver,\n})',
    ],
  ])('skips %s', (_name, content) => {
    expect(detects(audience, content, change)).toBe(false);
  });
});
