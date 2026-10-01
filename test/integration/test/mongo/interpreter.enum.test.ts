import mongoAdapter from '@internal/adapter-mongo/control';
import { mongoFamilyDescriptor } from '@internal/family-mongo/control';
import {
  mongoFamilyEntityTypes,
  mongoFamilyPslBlockDescriptors,
} from '@internal/family-mongo/pack';
import type { CodecLookup } from '@internal/framework-components/codec';
import { createControlStack } from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import {
  type InterpretPslDocumentToMongoContractInput,
  interpretPslDocumentToMongoContract,
} from '@internal/mongo-contract-psl';
import { buildSymbolTable } from '@internal/psl-parser';
import { parse } from '@internal/psl-parser/syntax';
import { MONGO_INT32_CODEC_ID, MONGO_STRING_CODEC_ID } from '@internal/target-mongo/codec-ids';
import { mongoTargetDescriptor } from '@internal/target-mongo/control';
import { timeouts } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';

const authoringContributions = {
  entityTypes: mongoFamilyEntityTypes,
  field: {},
  type: {},
  pslBlockDescriptors: mongoFamilyPslBlockDescriptors,
};

const mongoScalarTypeDescriptors: ReadonlyMap<string, string> = new Map([
  ['ObjectId', 'mongo/objectId@1'],
  ['String', 'mongo/string@1'],
  ['Int32', 'mongo/int32@1'],
]);

const mongoTargetTypes: Record<string, readonly string[]> = {
  'mongo/objectId@1': ['objectId'],
  'mongo/string@1': ['string'],
  'mongo/int32@1': ['int'],
};

const mongoCodecLookup: CodecLookup = {
  get(id: string) {
    const targetTypes = mongoTargetTypes[id];
    if (!targetTypes) return undefined;
    return {
      id,
      encode: async (v: unknown) => v,
      decode: async (w: unknown) => w,
      encodeJson: (v: unknown) => v,
      decodeJson: (j: unknown) => {
        if (id === 'mongo/string@1' && typeof j !== 'string')
          throw new Error(`expected string, got ${typeof j}`);
        return j;
      },
    } as ReturnType<CodecLookup['get']>;
  },
  targetTypesFor: (id: string) => mongoTargetTypes[id],
  renderOutputTypeFor: () => undefined,
};

function interpret(
  schema: string,
  overrides?: Partial<
    Omit<InterpretPslDocumentToMongoContractInput, 'document' | 'symbolTable' | 'sources'>
  >,
) {
  const contributions = overrides?.['authoringContributions'] ?? authoringContributions;
  const { document, sources } = parse(schema, 'mongo-enum-schema.prisma');
  const { symbolTable } = buildSymbolTable({
    documents: [document],
    sources,
  });
  return interpretPslDocumentToMongoContract({
    documents: [document],
    symbolTable,
    sources,
    scalarTypeCodecIds: mongoScalarTypeDescriptors,
    controlMutationDefaults: {
      dataTypeEntries: {},
      defaultFunctionRegistry: new Map(),
    },
    codecLookup: mongoCodecLookup,
    authoringContributions: contributions,
    enumInferenceCodecs: { text: MONGO_STRING_CODEC_ID, int: MONGO_INT32_CODEC_ID },
    ...overrides,
  });
}

function interpretOk(
  schema: string,
  overrides?: Partial<
    Omit<InterpretPslDocumentToMongoContractInput, 'document' | 'symbolTable' | 'sources'>
  >,
) {
  const result = interpret(schema, overrides);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('Expected ok result');
  return result.value;
}

describe('PSL enum lowering', { timeout: timeouts.typeScriptCompilation }, () => {
  it('lowers enum block to domain.namespaces[__unbound__].enum', () => {
    const contract = interpretOk(`
enum Role {
  @@type("mongo/string@1")
  User  = "user"
  Admin = "admin"
}
model Account {
  id   ObjectId @id @map("_id")
  role Role
}
`);

    const ns = contract.domain.namespaces[UNBOUND_NAMESPACE_ID];
    expect(ns).toBeDefined();
    expect(ns?.enum).toBeDefined();
    expect(ns?.enum?.['Role']).toEqual({
      codecId: 'mongo/string@1',
      members: [
        { name: 'User', value: 'user' },
        { name: 'Admin', value: 'admin' },
      ],
    });
  });

  it('stamps valueSet ref on the enum-typed field', () => {
    const contract = interpretOk(`
enum Role {
  @@type("mongo/string@1")
  User  = "user"
  Admin = "admin"
}
model Account {
  id   ObjectId @id @map("_id")
  role Role
}
`);

    const ns = contract.domain.namespaces[UNBOUND_NAMESPACE_ID];
    expect(ns?.models['Account']?.fields['role']).toMatchObject({
      valueSet: {
        plane: 'domain',
        entityKind: 'enum',
        namespaceId: UNBOUND_NAMESPACE_ID,
        entityName: 'Role',
      },
    });
  });

  it('produces the same enum entity shape as the TS DSL (D1 parity)', () => {
    const pslContract = interpretOk(`
enum Role {
  @@type("mongo/string@1")
  User  = "user"
  Admin = "admin"
}
model Account {
  id   ObjectId @id @map("_id")
  role Role
}
`);

    const pslNs = pslContract.domain.namespaces[UNBOUND_NAMESPACE_ID];

    // D1 TS DSL produces exactly this shape:
    expect(pslNs?.enum?.['Role']).toEqual({
      codecId: 'mongo/string@1',
      members: [
        { name: 'User', value: 'user' },
        { name: 'Admin', value: 'admin' },
      ],
    });

    // D1 TS DSL stamps this exact valueSet on the field:
    expect(pslNs?.models['Account']?.fields['role']?.valueSet).toEqual({
      plane: 'domain',
      entityKind: 'enum',
      namespaceId: UNBOUND_NAMESPACE_ID,
      entityName: 'Role',
    });
  });

  it('enum field uses the enum codecId for its scalar type', () => {
    const contract = interpretOk(`
enum Role {
  @@type("mongo/string@1")
  User  = "user"
  Admin = "admin"
}
model Account {
  id   ObjectId @id @map("_id")
  role Role
}
`);

    const ns = contract.domain.namespaces[UNBOUND_NAMESPACE_ID];
    const roleField = ns?.models['Account']?.fields['role'];
    expect(roleField?.type).toEqual({ kind: 'scalar', codecId: 'mongo/string@1' });
    expect(roleField?.nullable).toBe(false);
  });

  it('optional enum field is nullable', () => {
    const contract = interpretOk(`
enum Role {
  @@type("mongo/string@1")
  User  = "user"
  Admin = "admin"
}
model Account {
  id   ObjectId @id @map("_id")
  role Role?
}
`);

    const ns = contract.domain.namespaces[UNBOUND_NAMESPACE_ID];
    const roleField = ns?.models['Account']?.fields['role'];
    expect(roleField?.nullable).toBe(true);
    expect(roleField?.valueSet).toBeDefined();
  });

  it('infers the string codec when @@type is omitted and members are strings', () => {
    const contract = interpretOk(`
enum Role {
  User = "user"
}
model Account {
  id   ObjectId @id @map("_id")
  role Role
}
`);

    const ns = contract.domain.namespaces[UNBOUND_NAMESPACE_ID];
    expect(ns?.enum?.['Role']).toEqual({
      codecId: 'mongo/string@1',
      members: [{ name: 'User', value: 'user' }],
    });
  });

  it('fails to infer @@type when a member is neither a string nor an integer', () => {
    const result = interpret(`
enum Ratio {
  Half = 1.5
}
model Account {
  id    ObjectId @id @map("_id")
  ratio Ratio
}
`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(
      result.failure.diagnostics.some(
        (d: { code: string }) => d.code === 'PSL_ENUM_CANNOT_INFER_TYPE',
      ),
    ).toBe(true);
  });

  it('fails when enum references an unknown codec', () => {
    const result = interpret(`
enum Role {
  @@type("unknown/codec@1")
  User = "user"
}
model Account {
  id   ObjectId @id @map("_id")
  role Role
}
`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(
      result.failure.diagnostics.some(
        (d: { code: string }) => d.code === 'PSL_EXTENSION_INVALID_VALUE',
      ),
    ).toBe(true);
  });

  it('non-enum fields are unaffected', () => {
    const contract = interpretOk(`
enum Role {
  @@type("mongo/string@1")
  User  = "user"
  Admin = "admin"
}
model Account {
  id    ObjectId @id @map("_id")
  name  String
  role  Role
}
`);

    const ns = contract.domain.namespaces[UNBOUND_NAMESPACE_ID];
    const nameField = ns?.models['Account']?.fields['name'];
    expect(nameField?.type).toEqual({ kind: 'scalar', codecId: 'mongo/string@1' });
    expect(nameField?.valueSet).toBeUndefined();
  });
});

describe('PSL enum members read by the target codecs', {
  timeout: timeouts.typeScriptCompilation,
}, () => {
  const { codecLookup } = createControlStack({
    family: mongoFamilyDescriptor,
    target: mongoTargetDescriptor,
    adapter: mongoAdapter,
  });

  function enumDiagnostics(enumBlock: string) {
    const result = interpret(enumBlock, { codecLookup });
    if (result.ok) return [];
    return result.failure.diagnostics.map(({ code, message }) => ({ code, message }));
  }

  it('an int32 enum takes integer members', () => {
    const contract = interpretOk(
      `
enum Priority {
  @@type("mongo/int32@1")
  Low  = 1
  High = 2
}
model Task {
  id       ObjectId @id @map("_id")
  priority Priority
}
`,
      { codecLookup },
    );

    expect(contract.domain.namespaces[UNBOUND_NAMESPACE_ID]?.enum?.['Priority']).toEqual({
      codecId: 'mongo/int32@1',
      members: [
        { name: 'Low', value: 1 },
        { name: 'High', value: 2 },
      ],
    });
  });

  it('an int32 enum refuses a text member', () => {
    expect(
      enumDiagnostics(`
enum Priority {
  @@type("mongo/int32@1")
  Low = "low"
}`),
    ).toEqual([
      {
        code: 'PSL_EXTENSION_INVALID_VALUE',
        message:
          'enum "Priority" member "Low" was rejected by codec "mongo/int32@1": mongo/int32@1 JSON value must be an integer from -2147483648 to 2147483647',
      },
    ]);
  });

  it('an int32 enum refuses a bare member', () => {
    expect(
      enumDiagnostics(`
enum Priority {
  @@type("mongo/int32@1")
  Low
}`),
    ).toEqual([
      {
        code: 'PSL_ENUM_BARE_MEMBER_NON_STRING_CODEC',
        message:
          'enum "Priority" member "Low" has no value and codec "mongo/int32@1" does not accept a bare name as input',
      },
    ]);
  });

  it('a string enum refuses a number member', () => {
    expect(
      enumDiagnostics(`
enum Priority {
  @@type("mongo/string@1")
  Low = 1
}`),
    ).toEqual([
      {
        code: 'PSL_EXTENSION_INVALID_VALUE',
        message:
          'enum "Priority" member "Low" was rejected by codec "mongo/string@1": mongo/string@1 JSON value must be a string',
      },
    ]);
  });
});
