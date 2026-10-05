import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { fixtureDataTypeSupport } from './fixture-data-types';
import {
  createBuiltinLikeControlMutationDefaults,
  interpretSqlContract,
  postgresScalarTypeDescriptors,
  postgresTarget,
} from './fixtures';

const baseInput = {
  dataTypeLookup: fixtureDataTypeSupport.lookup,
  target: postgresTarget,
  scalarColumnDescriptors: postgresScalarTypeDescriptors,
  controlMutationDefaults: createBuiltinLikeControlMutationDefaults(),
  composedExtensionContracts: new Map(),
  createNamespace: createTestSqlNamespace,
  capabilities: { sql: { scalarList: true } },
  authoringContributions: { valueObjectStorageType: 'Jsonb' },
} as const;

function refusalFor(schema: string): readonly { code: string; message: string }[] {
  const result = interpretSqlContract(schema, { ...baseInput });
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('interpretation unexpectedly succeeded');
  return result.failure.diagnostics.map(({ code, message }) => ({ code, message }));
}

describe('who speaks for an unusable relation target', () => {
  it('leaves a sibling-namespace target to the binder alone', () => {
    expect(
      refusalFor(`namespace public {
  model Post {
    id Int @id
    userId Int
    user User @relation(fields: [userId], references: [id])
  }
}

namespace auth {
  model User {
    id Int @id
  }
}
`),
    ).toEqual([
      { code: 'PSL_UNRESOLVED_REFERENCE', message: 'Cannot find type "User"' },
      {
        code: 'PSL_UNRESOLVED_REFERENCE',
        message: 'Cannot find field "id" on the type of "Post.user"',
      },
    ]);
  });

  it('leaves a qualified target naming no namespace to the binder, which names it', () => {
    expect(
      refusalFor(`namespace public {
  model Post {
    id Int @id
    userId Int
    user wrong.User @relation(fields: [userId], references: [id])
  }
}

namespace auth {
  model User {
    id Int @id
  }
}
`),
    ).toEqual([
      { code: 'PSL_UNRESOLVED_REFERENCE', message: 'Cannot find type "wrong.User"' },
      {
        code: 'PSL_UNRESOLVED_REFERENCE',
        message: 'Cannot find field "id" on the type of "Post.user"',
      },
    ]);
  });

  it('names a bare type reference into an unavailable extension namespace', () => {
    expect(
      refusalFor(`model Document {
  id Int @id
  embedding pgvector.Vector
}
`),
    ).toEqual([
      { code: 'PSL_UNRESOLVED_REFERENCE', message: 'Cannot find type "pgvector.Vector"' },
    ]);
  });

  it('leaves an unresolved composite-type field to the binder alone', () => {
    expect(
      refusalFor(`type Address {
  region Province
}

model Person {
  id Int @id
  address Address
}
`),
    ).toEqual([{ code: 'PSL_UNRESOLVED_REFERENCE', message: 'Cannot find type "Province"' }]);
  });

  it('leaves a type-constructor call into an unavailable namespace to the binder alone', () => {
    expect(
      refusalFor(`model Document {
  id Int @id
  embedding pgvector.Vector(1536)
}
`),
    ).toEqual([
      { code: 'PSL_UNRESOLVED_REFERENCE', message: 'Cannot find type "pgvector.Vector"' },
    ]);
  });

  it('reports a resolved-but-non-model target itself, naming what it found', () => {
    expect(
      refusalFor(`type Address {
  street String
}

model Post {
  id Int @id
  addressId Int
  address Address @relation(fields: [addressId], references: [street])
}
`),
    ).toEqual([
      {
        code: 'PSL_INVALID_RELATION_TARGET',
        message:
          'Relation field "Post.address" references composite type "Address"; a relation target must be a model',
      },
    ]);
  });
});
