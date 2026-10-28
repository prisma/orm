import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { sqlAttributeSpecs } from '../src/sql-attribute-specs';
import { fixtureInterpreterTypes } from './fixture-codec-descriptors';
import { fixtureGeneratorFunctions } from './fixture-generator-functions';
import {
  createBuiltinLikeControlMutationDefaults,
  interpretSqlContract,
  postgresNativeScalarTypeDescriptors,
  postgresScalarAuthoringTypes,
  postgresTarget,
} from './fixtures';

function interpret(schema: string) {
  return interpretSqlContract(schema, {
    target: postgresTarget,
    scalarColumnDescriptors: postgresNativeScalarTypeDescriptors,
    authoringContributions: { type: postgresScalarAuthoringTypes },
    composedExtensionContracts: new Map(),
    createNamespace: createTestSqlNamespace,
    ...fixtureInterpreterTypes,
    capabilities: { sql: { scalarList: true, checkConstraint: true } },
    controlMutationDefaults: createBuiltinLikeControlMutationDefaults(),
    generatorFunctions: fixtureGeneratorFunctions,
  });
}

function unsupportedAttributeDiagnostics(schema: string) {
  const result = interpret(schema);
  if (result.ok) return [];
  return result.failure.diagnostics
    .filter(
      (diagnostic) =>
        diagnostic.code === 'PSL_UNSUPPORTED_MODEL_ATTRIBUTE' ||
        diagnostic.code === 'PSL_UNSUPPORTED_FIELD_ATTRIBUTE',
    )
    .map(({ code, message }) => ({ code, message }));
}

const everyRegisteredAttribute = `
model User {
  id     Int    @id @default(autoincrement())
  email  String @unique @map("email_address")
  tags   String[]
  posts  Post[]

  @@map("users")
  @@control(managed)
}

model Post {
  postId   Int  @map("post_id")
  authorId Int
  author   User @relation(fields: [authorId], references: [id])
  slug     String
  seenAt   DateTime @onCreate(now()) @onUpdate(now())

  @@id([postId])
  @@unique([slug])
  @@index([authorId])
  @@check(expression: sql\`post_id > 0\`, name: "post_id_positive")
}
`;

describe('unknown attribute diagnostics derive from the registered SQL namespace', () => {
  it('diagnoses a model attribute the namespace does not register', () => {
    expect(unsupportedAttributeDiagnostics('model User {\n  id Int @id\n  @@bogus\n}\n')).toEqual([
      {
        code: 'PSL_UNSUPPORTED_MODEL_ATTRIBUTE',
        message: 'Model "User" uses unsupported attribute "@@bogus"',
      },
    ]);
  });

  it('diagnoses a field attribute the namespace does not register', () => {
    expect(
      unsupportedAttributeDiagnostics('model User {\n  id Int @id\n  name String @bogus\n}\n'),
    ).toEqual([
      {
        code: 'PSL_UNSUPPORTED_FIELD_ATTRIBUTE',
        message: 'Field "User.name" uses unsupported attribute "@bogus"',
      },
    ]);
  });

  it('accepts every registered attribute at both levels', () => {
    expect(interpret(everyRegisteredAttribute).ok).toBe(true);
  });

  it('exercises every registered name in the acceptance schema', () => {
    const used = (prefix: string) =>
      new Set(
        [...everyRegisteredAttribute.matchAll(new RegExp(`${prefix}(\\w+)`, 'g'))].map((m) => m[1]),
      );
    const modelNames = Object.keys(sqlAttributeSpecs.model).filter(
      (name) => name !== 'discriminator' && name !== 'base',
    );
    expect([...used('@@')].sort()).toEqual(modelNames.sort());
    expect([...used('(?<!@)@')].sort()).toEqual(Object.keys(sqlAttributeSpecs.field).sort());
  });
});

describe('a field attribute Prisma 8 removed', () => {
  it('names what to write instead of @updatedAt', () => {
    expect(
      unsupportedAttributeDiagnostics(
        'model Stale {\n  id Int @id\n  updatedAt DateTime @updatedAt\n}\n',
      ),
    ).toEqual([
      {
        code: 'PSL_UNSUPPORTED_FIELD_ATTRIBUTE',
        message:
          'Field "Stale.updatedAt" uses unsupported attribute "@updatedAt". Use @onCreate(now()) @onUpdate(now()), or type the field temporal.UpdatedAt.',
      },
    ]);
  });

  it('leaves out the hint when the field already writes @onUpdate', () => {
    expect(
      unsupportedAttributeDiagnostics(
        'model Migrated {\n  id Int @id\n  updatedAt DateTime @onUpdate(now()) @updatedAt\n}\n',
      ),
    ).toEqual([
      {
        code: 'PSL_UNSUPPORTED_FIELD_ATTRIBUTE',
        message: 'Field "Migrated.updatedAt" uses unsupported attribute "@updatedAt"',
      },
    ]);
  });
});
