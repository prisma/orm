import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findModel } from '../../src/contract/model-lookup';
import { createWorkDir, emitContract, type SqlContract, type WorkDir } from '../helpers/databases';

let workDir: WorkDir;
let sqliteContract: SqlContract;
let postgresContract: SqlContract;

beforeAll(async () => {
  workDir = await createWorkDir();
  sqliteContract = (
    await emitContract(
      'sqlite',
      `// use prisma-8
model user {
  id String @id
  @@map("lower_user")
}

model User {
  id String @id
  @@map("upper_user")
}

model Session {
  id String @id
  @@map("session")
}
`,
      workDir,
    )
  ).contract;
  postgresContract = (
    await emitContract(
      'postgres',
      `// use prisma-8
model Session {
  id String @id
  @@map("session")
}

namespace auth {
  model Session {
    id String @id
    @@map("session")
  }

  model Account {
    id String @id
    @@map("account")
  }
}
`,
      workDir,
    )
  ).contract;
});

afterAll(() => workDir.remove());

describe('findModel', () => {
  it('finds a model by its exact name before the upper-cased name', () => {
    expect(findModel(sqliteContract, 'user', undefined)).toMatchObject({
      kind: 'found',
      name: 'user',
      namespaceId: '__unbound__',
    });
  });

  it('finds the upper-cased name when no model has the exact name', () => {
    expect(findModel(sqliteContract, 'session', undefined)).toMatchObject({
      kind: 'found',
      name: 'Session',
    });
  });

  it('reports a model the contract lacks', () => {
    expect(findModel(sqliteContract, 'verification', undefined)).toEqual({ kind: 'missing' });
  });

  it('finds a model in a second Postgres schema without the namespace option', () => {
    expect(findModel(postgresContract, 'account', undefined)).toMatchObject({
      kind: 'found',
      name: 'Account',
      namespaceId: 'auth',
    });
  });

  it('reports a name found in more than one namespace', () => {
    expect(findModel(postgresContract, 'session', undefined)).toEqual({
      kind: 'ambiguous',
      message:
        'Model "Session" is in more than one namespace of your Prisma contract (auth, public). Set the adapter\'s "namespace" option.',
    });
  });

  it('searches only the namespace the option names', () => {
    expect(findModel(postgresContract, 'session', 'auth')).toMatchObject({
      kind: 'found',
      namespaceId: 'auth',
    });
    expect(findModel(postgresContract, 'account', 'public')).toEqual({ kind: 'missing' });
    expect(findModel(postgresContract, 'account', 'elsewhere')).toEqual({ kind: 'missing' });
  });

  it('refuses a model name that is not an identifier', () => {
    expect(() => findModel(sqliteContract, 'user-table', undefined)).toThrow(/"modelName"/);
  });
});
