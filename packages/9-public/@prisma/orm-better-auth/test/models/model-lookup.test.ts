import { beforeAll, describe, expect, it } from 'vitest';
import { findModel, type SqlContract } from '../../src/models/model-lookup';
import { useContractFixture } from '../helpers/contract-fixture';

const fixture = useContractFixture();
const noOtherModels: ReadonlySet<string> = new Set();
let sqliteContract: SqlContract;
let postgresContract: SqlContract;

beforeAll(async () => {
  sqliteContract = await fixture().contractOf(
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
  );
  postgresContract = await fixture().contractOf(
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
  );
});

describe('findModel', () => {
  it('finds a model by its exact name before the upper-cased name', () => {
    expect(findModel(sqliteContract, 'user', undefined, noOtherModels)).toMatchObject({
      kind: 'found',
      name: 'user',
      namespaceId: '__unbound__',
    });
  });

  it('finds the upper-cased name when no model has the exact name', () => {
    expect(findModel(sqliteContract, 'session', undefined, noOtherModels)).toMatchObject({
      kind: 'found',
      name: 'Session',
    });
  });

  it('does not take the upper-cased name when another Better Auth model has it', () => {
    expect(findModel(sqliteContract, 'session', undefined, new Set(['Session']))).toEqual({
      kind: 'missing',
    });
  });

  it('reports a model the contract lacks', () => {
    expect(findModel(sqliteContract, 'verification', undefined, noOtherModels)).toEqual({
      kind: 'missing',
    });
  });

  it('finds a model in a second Postgres schema without the namespace option', () => {
    expect(findModel(postgresContract, 'account', undefined, noOtherModels)).toMatchObject({
      kind: 'found',
      name: 'Account',
      namespaceId: 'auth',
    });
  });

  it('reports a name found in more than one namespace', () => {
    expect(findModel(postgresContract, 'session', undefined, noOtherModels)).toEqual({
      kind: 'ambiguous',
      name: 'Session',
      namespaceIds: ['auth', 'public'],
    });
  });

  it('searches only the namespace the option names', () => {
    expect(findModel(postgresContract, 'session', 'auth', noOtherModels)).toMatchObject({
      kind: 'found',
      namespaceId: 'auth',
    });
    expect(findModel(postgresContract, 'account', 'public', noOtherModels)).toEqual({
      kind: 'missing',
    });
    expect(findModel(postgresContract, 'account', 'elsewhere', noOtherModels)).toEqual({
      kind: 'missing',
    });
  });
});
