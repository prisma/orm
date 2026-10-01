import type { Contract } from '@internal/contract/types';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { interpretPslDocumentToSqlContract } from '../src/interpreter';
import { PSL_HINT_INVALID } from '../src/sql-attribute-specs';
import { fixtureDataTypeSupport } from './fixture-data-types';
import {
  createBuiltinLikeControlMutationDefaults,
  postgresScalarTypeDescriptors,
  postgresTarget,
  symbolTableInputFromParseArgs,
} from './fixtures';

const builtinControlMutationDefaults = createBuiltinLikeControlMutationDefaults();

function interpretSchema(schema: string) {
  return interpretPslDocumentToSqlContract({
    ...symbolTableInputFromParseArgs({ schema, sourceId: 'schema.prisma' }),
    target: postgresTarget,
    scalarColumnDescriptors: postgresScalarTypeDescriptors,
    composedExtensionContracts: new Map(),
    controlMutationDefaults: builtinControlMutationDefaults,
    createNamespace: createTestSqlNamespace,
    dataTypeLookup: fixtureDataTypeSupport.lookup,
    capabilities: { sql: { scalarList: true } },
  });
}

function interpretOk(schema: string): Contract {
  const result = interpretSchema(schema);
  if (!result.ok) throw new Error(JSON.stringify(result.failure.diagnostics, null, 2));
  return result.value;
}

function diagnosticsOf(schema: string): readonly { code: string; message: string }[] {
  const result = interpretSchema(schema);
  expect(result.ok).toBe(false);
  return result.ok
    ? []
    : result.failure.diagnostics.map(({ code, message }) => ({ code, message }));
}

function expectOnlyDiagnostic(schema: string, code: string, message: string): void {
  expect(diagnosticsOf(schema)).toEqual([{ code, message }]);
}

function emittedHints(schema: string): unknown {
  return JSON.parse(JSON.stringify(interpretOk(schema))).hints;
}

function publicTableHints(tables: Record<string, unknown>) {
  return { namespaces: { public: { tables } } };
}

function invalidAttribute(message: string) {
  return { code: 'PSL_INVALID_ATTRIBUTE_SYNTAX', message };
}

describe('@@hint arguments', () => {
  it.each([
    ['@@hint', 'no parentheses'],
    ['@@hint()', 'empty parentheses'],
  ])('rejects %s (%s) with no argument', (attribute) => {
    expectOnlyDiagnostic(
      `model User {
  id Int @id
  ${attribute}
}`,
      PSL_HINT_INVALID,
      '@@hint needs was.',
    );
  });

  it('rejects deleted, which is not a parameter yet, so was and deleted cannot combine', () => {
    expect(
      diagnosticsOf(`model User {
  id Int @id
  @@hint(was: "Profile", deleted: true)
}`),
    ).toEqual([invalidAttribute('Attribute "hint" received unknown argument "deleted"')]);
  });

  it('rejects an empty was', () => {
    expectOnlyDiagnostic(
      `model User {
  id Int @id
  @@hint(was: "")
}`,
      PSL_HINT_INVALID,
      '@@hint(was:) must name the previous storage name.',
    );
  });

  it('rejects deleted: false through the unknown-argument check while deleted is not a parameter', () => {
    expect(
      diagnosticsOf(`model User {
  id Int @id
  @@hint(deleted: false)
}`),
    ).toEqual([invalidAttribute('Attribute "hint" received unknown argument "deleted"')]);
  });

  it.each(['true', 'false'])('rejects deprecated: %s', (value) => {
    expectOnlyDiagnostic(
      `model User {
  id Int @id
  @@hint(deprecated: ${value})
}`,
      PSL_HINT_INVALID,
      '@@hint(deprecated:) is reserved and not yet supported. Remove the model from the schema and run db update.',
    );
  });

  it('rejects a was that is not a string literal', () => {
    expect(
      diagnosticsOf(`model User {
  id Int @id
  @@hint(was: Profile)
}`),
    ).toEqual([invalidAttribute('Expected a string literal')]);
  });

  it('rejects a duplicate was argument', () => {
    expect(
      diagnosticsOf(`model User {
  id Int @id
  @@hint(was: "Profile", was: "Account")
}`),
    ).toEqual([invalidAttribute('Attribute "hint" received duplicate argument "was"')]);
  });
});

describe('@@hint placement', () => {
  it('rejects a second @@hint on one model', () => {
    expectOnlyDiagnostic(
      `model User {
  id Int @id
  @@hint(was: "Profile")
  @@hint(was: "Account")
}`,
      'PSL_DUPLICATE_ATTRIBUTE',
      '`@@hint` declared more than once on model "User".',
    );
  });

  it('rejects @@hint on a composite type', () => {
    expectOnlyDiagnostic(
      `type Address {
  street String

  @@hint(was: "Location")
}

model User {
  id Int @id
}`,
      'PSL_UNSUPPORTED_COMPOSITE_TYPE_ATTRIBUTE',
      'Composite type "Address" uses attribute "@@hint", which a composite type does not take',
    );
  });

  it('rejects was on a single-table-inheritance child', () => {
    expectOnlyDiagnostic(
      `model Task {
  id   Int    @id
  kind String
  @@discriminator(kind)
}

model Bug {
  severity Int
  @@base(Task, "bug")
  @@hint(was: "Defect")
}`,
      PSL_HINT_INVALID,
      '@@hint(was:) belongs on the model that owns the table, "Task".',
    );
  });

  it('accepts was on a multi-table-inheritance variant, naming its own table', () => {
    expect(
      emittedHints(`model Task {
  id   Int    @id
  kind String
  @@discriminator(kind)
}

model Feature {
  priority Int
  @@base(Task, "feature")
  @@map("features")
  @@hint(was: "feature_requests")
}`),
    ).toEqual(publicTableHints({ features: { was: 'feature_requests' } }));
  });

  it('rejects a was equal to the model storage name', () => {
    expectOnlyDiagnostic(
      `model User {
  id Int @id
  @@map("users")
  @@hint(was: "users")
}`,
      PSL_HINT_INVALID,
      '@@hint(was: "users") names the table\'s current name; the hint is spent, remove it.',
    );
  });

  it('rejects a was naming a table another model declares', () => {
    expectOnlyDiagnostic(
      `model User {
  id Int @id
  @@hint(was: "Post")
}

model Post {
  id Int @id
}`,
      PSL_HINT_INVALID,
      '@@hint(was: "Post") on model User names a table this contract also declares through model Post; a rename cannot apply while both exist.',
    );
  });

  it('rejects two models in one namespace claiming the same was', () => {
    expectOnlyDiagnostic(
      `model User {
  id Int @id
  @@hint(was: "Profile")
}

model Account {
  id Int @id
  @@hint(was: "Profile")
}`,
      PSL_HINT_INVALID,
      'Models User and Account both claim to have been "Profile".',
    );
  });

  it('accepts the same was in two namespaces and a was naming a table of another namespace', () => {
    expect(
      emittedHints(`namespace public {
  model User {
    id Int @id
    @@hint(was: "Profile")
  }
}

namespace auth {
  model Account {
    id Int @id
    @@hint(was: "Profile")
  }
}

namespace billing {
  model Profile {
    id Int @id
  }
}`),
    ).toEqual({
      namespaces: {
        auth: { tables: { Account: { was: 'Profile' } } },
        public: { tables: { User: { was: 'Profile' } } },
      },
    });
  });

  it('matches a was containing a dot verbatim as one table name', () => {
    expect(
      emittedHints(`model User {
  id Int @id
  @@hint(was: "legacy.users")
}

model Users {
  id Int @id
  @@map("users")
}`),
    ).toEqual(publicTableHints({ User: { was: 'legacy.users' } }));
  });
});

describe('@@hint section', () => {
  it('emits a was keyed by the model table name without @@map', () => {
    expect(
      emittedHints(`model User {
  id Int @id
  @@hint(was: "Profile")
}`),
    ).toEqual(publicTableHints({ User: { was: 'Profile' } }));
  });

  it('emits a was keyed by the @@map name', () => {
    expect(
      emittedHints(`model User {
  id Int @id
  @@map("users")
  @@hint(was: "profiles")
}`),
    ).toEqual(publicTableHints({ users: { was: 'profiles' } }));
  });

  it('emits no hints key for a schema without @@hint', () => {
    expect(
      JSON.parse(
        JSON.stringify(
          interpretOk(`model User {
  id Int @id
}`),
        ),
      ),
    ).not.toHaveProperty('hints');
  });

  it('leaves the storage, execution and profile hashes unchanged', () => {
    const schema = (hint: string) => `model User {
  id    String @id @default(uuid())
  email String @unique
  @@map("users")
  ${hint}
}

model Post {
  id     Int    @id
  title  String
}`;
    const hashes = (contract: Contract) => ({
      storageHash: contract.storage.storageHash,
      executionHash: contract.execution?.executionHash,
      profileHash: contract.profileHash,
    });
    const withHint = interpretOk(schema('@@hint(was: "profiles")'));
    const withoutHint = interpretOk(schema(''));
    expect(withHint.execution?.executionHash).toBeDefined();
    expect(hashes(withHint)).toEqual(hashes(withoutHint));
    const { hints, ...rest } = JSON.parse(JSON.stringify(withHint));
    expect(hints).toEqual(publicTableHints({ users: { was: 'profiles' } }));
    expect(rest).toEqual(JSON.parse(JSON.stringify(withoutHint)));
  });
});

describe('@@hint diagnostic anchors', () => {
  function startsOf(schema: string) {
    const result = interpretSchema(schema);
    expect(result.ok).toBe(false);
    return result.ok
      ? []
      : result.failure.diagnostics.map(({ code, span }) => ({
          code,
          line: span?.start.line,
          column: span?.start.column,
        }));
  }

  it('anchors an argument rule on the @@hint attribute', () => {
    expect(
      startsOf(`model User {
  id Int @id
  @@hint
}`),
    ).toEqual([{ code: PSL_HINT_INVALID, line: 3, column: 3 }]);
  });

  it('anchors a placement rule on the @@hint attribute', () => {
    expect(
      startsOf(`model User {
  id Int @id
    @@hint(was: "Post")
}

model Post {
  id Int @id
}`),
    ).toEqual([{ code: PSL_HINT_INVALID, line: 3, column: 5 }]);
  });

  it('anchors a duplicate on the second @@hint', () => {
    expect(
      startsOf(`model User {
  id Int @id
  @@hint(was: "Profile")
   @@hint(was: "Account")
}`),
    ).toEqual([{ code: 'PSL_DUPLICATE_ATTRIBUTE', line: 4, column: 4 }]);
  });
});

describe('@@hint with an inheritance cycle', () => {
  it('returns and reports the cycle when two models name each other in @@base', () => {
    const codes = diagnosticsOf(`model Task {
  id Int @id
  @@base(Bug, "task")
  @@hint(was: "Job")
}

model Bug {
  id Int @id
  @@base(Task, "bug")
}`).map(({ code }) => code);
    expect(codes).toContain('PSL_ORPHANED_BASE');
  });
});
