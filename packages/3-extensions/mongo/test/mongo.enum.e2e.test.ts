import { generateContractDts } from '@internal/emitter';
import { type CodecLookup, renderTsLiteral } from '@internal/framework-components/codec';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import type { ExtractMongoFieldOutputTypes } from '@internal/mongo-contract';
import { deriveJsonSchema, type FieldValueSets } from '@internal/mongo-contract-psl';
import { mongoEmission } from '@internal/mongo-emitter';
import { blindCast } from '@internal/utils/casts';
import { timeouts } from '@repo/test-utils';
import { MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, describe, expect, expectTypeOf, it } from 'vitest';
import { defineContract, enumType, field, member, model } from '../src/exports/contract-builder';
import mongo, { type MongoClient as MongoFacadeClient } from '../src/runtime/mongo';

const Role = enumType(
  'Role',
  { codecId: 'mongo/string@1', nativeType: 'string' },
  member('User', 'user'),
  member('Admin', 'admin'),
);

// Status has a different declaration order (C < A < B alphabetically) to prove
// ordinalOf() returns declaration order, not lexical order.
const Status = enumType(
  'Status',
  { codecId: 'mongo/string@1', nativeType: 'string' },
  member('Pending', 'pending'),
  member('Active', 'active'),
  member('Inactive', 'inactive'),
);

const Account = model('Account', {
  collection: 'accounts',
  fields: {
    _id: field.objectId(),
    role: field.namedType(Role),
    mood: field.namedType(Role).optional(),
    tags: field.namedType(Role).many(),
  },
});

const contract = defineContract({
  enums: { Role, Status },
  models: { Account },
});

const mongoTargetTypes: Record<string, readonly string[]> = {
  'mongo/string@1': ['string'],
  'mongo/objectId@1': ['objectId'],
};

const codecLookup: CodecLookup = {
  get: (id: string) => {
    const targetTypes = mongoTargetTypes[id];
    if (!targetTypes) return undefined;
    return {
      id,
      encode: async (v: unknown) => v,
      decode: async (w: unknown) => w,
      encodeJson: (v: unknown) => v,
      decodeJson: (j: unknown) => j,
    } as ReturnType<CodecLookup['get']>;
  },
  targetTypesFor: (id: string) => mongoTargetTypes[id],
  renderOutputTypeFor: () => undefined,
  // Enum field types are produced through the codec seam (TML-2952): the emitter
  // renders each value-set value via `renderValueLiteralFor`. `mongo/string@1` is an
  // identity codec, so it renders the encoded string straight to a quoted literal —
  // mirroring the real `mongo/string@1` descriptor's `renderValueLiteral`.
  renderValueLiteralFor: (id, value) =>
    id === 'mongo/string@1' && typeof value === 'string' ? renderTsLiteral(value) : undefined,
};

// Derive the $jsonSchema validator from the contract via the production deriver.
// This ensures a regression in deriveJsonSchema (e.g. placing enum outside items
// for array fields) breaks this test — not just the unit tests in derive-json-schema.test.ts.
// The validator's `enum` keyword is sourced from the storage value set (as production does), not
// from `domain.enum`.
const ns = contract.domain.namespaces[UNBOUND_NAMESPACE_ID];
const accountFields = ns?.models['Account']?.fields ?? {};
const storageValueSets = blindCast<
  FieldValueSets,
  'a mongo storage namespace exposes entries.valueSet as { <name>: { values } } after authoring'
>(
  (contract.storage as { namespaces: Record<string, { entries: { valueSet?: unknown } }> })
    .namespaces[UNBOUND_NAMESPACE_ID]?.entries.valueSet ?? {},
);
const ACCOUNT_VALIDATOR = deriveJsonSchema(accountFields, undefined, codecLookup, storageValueSets);

describe('mongo enum — end-to-end (replica set)', {
  timeout: timeouts.spinUpMongoMemoryServer,
}, () => {
  let replSet: MongoMemoryReplSet;
  let nativeClient: MongoClient;
  let db: MongoFacadeClient<typeof contract>;
  const dbName = 'enum_e2e_test';

  // D10 narrows the ORM *write* input (create) to the enum value union via the
  // precomputed FieldInputTypes map. The `where` filter still resolves its
  // per-field type through ExtractMongoCodecTypes, which is `never` for a
  // TS-DSL contract, so `where({ _id })` narrows `_id` to `never`. Narrowing
  // `where` needs a separate mechanism (route it through FieldInputTypes too);
  // until that follow-up lands, cast the read predicate narrowly here.
  const byId = (id: unknown) =>
    blindCast<
      Parameters<typeof db.orm.accounts.where>[0],
      'where filter narrows scalar fields via ExtractMongoCodecTypes (never for TS-DSL contracts); D10 narrows create input only, where is a noted follow-up'
    >({ _id: id });

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });

    // Create the collection with the derived validator via the native driver.
    // The validator is collection-scoped, so attach it at creation; subsequent
    // ORM writes target the same collection and are validated by MongoDB.
    nativeClient = new MongoClient(replSet.getUri());
    await nativeClient.connect();
    await nativeClient.db(dbName).createCollection('accounts', {
      validator: { $jsonSchema: ACCOUNT_VALIDATOR.jsonSchema },
      validationLevel: ACCOUNT_VALIDATOR.validationLevel,
      validationAction: ACCOUNT_VALIDATOR.validationAction,
    });

    // Now build the ORM facade against the same replica set + dbName. Writes
    // go through db.orm.accounts.create(...) and hit the validator at the
    // MongoDB layer; reads of db.enums come from the same facade.
    db = mongo({ contract, uri: replSet.getUri(), dbName });
    await db.connect();
  }, timeouts.spinUpMongoMemoryServer);

  afterAll(async () => {
    await db?.close();
    await nativeClient?.close();
    await replSet?.stop();
  }, timeouts.spinUpMongoMemoryServer);

  describe('out-of-set scalar write is rejected', () => {
    it('rejects an insert with a role value not in the enum', async () => {
      // 'nope' is not in the value union — bypass TS to test MongoDB's $jsonSchema enforcement.
      await expect(
        db.orm.accounts.create({ role: 'nope' as never, mood: null, tags: [] }),
      ).rejects.toMatchObject({ code: 121 });
    });

    it('rejects an insert with a null value on a non-nullable field', async () => {
      // null is not valid for a non-nullable field — bypass TS to test MongoDB enforcement.
      await expect(
        db.orm.accounts.create({ role: null as never, mood: null, tags: [] }),
      ).rejects.toMatchObject({ code: 121 });
    });
  });

  describe('in-set scalar write succeeds', () => {
    it('accepts a valid role value and round-trips it', async () => {
      const created = await db.orm.accounts.create({ role: 'user', mood: null, tags: [] });
      expect(created._id).toBeTruthy();
      expect(created.role).toBe('user');

      const found = await db.orm.accounts.where(byId(created._id)).first();
      expect(found?.role).toBe('user');
    });
  });

  describe('nullable scalar enum', () => {
    it('accepts null for a nullable enum field', async () => {
      const created = await db.orm.accounts.create({
        role: 'admin',
        mood: null,
        tags: [],
      });
      expect(created._id).toBeTruthy();

      const found = await db.orm.accounts.where(byId(created._id)).first();
      expect(found?.mood).toBeNull();
    });

    it('accepts an in-set value for a nullable enum field', async () => {
      const created = await db.orm.accounts.create({
        role: 'user',
        mood: 'admin',
        tags: [],
      });
      expect(created._id).toBeTruthy();
      expect(created.mood).toBe('admin');
    });

    it('rejects an out-of-set value on a nullable enum field', async () => {
      // 'bogus' is not in the value union — bypass TS to test MongoDB enforcement.
      await expect(
        db.orm.accounts.create({ role: 'user', mood: 'bogus' as never, tags: [] }),
      ).rejects.toMatchObject({ code: 121 });
    });
  });

  describe('array enum field', () => {
    it('accepts an array of in-set values', async () => {
      const created = await db.orm.accounts.create({
        role: 'user',
        mood: null,
        tags: ['user', 'admin'],
      });
      expect(created._id).toBeTruthy();
      expect(created.tags).toEqual(['user', 'admin']);
    });

    it('accepts an empty array', async () => {
      const created = await db.orm.accounts.create({ role: 'admin', mood: null, tags: [] });
      expect(created._id).toBeTruthy();
    });

    it('rejects an array containing an out-of-set element', async () => {
      // 'bogus' is not in the value union — bypass TS to test MongoDB enforcement.
      await expect(
        db.orm.accounts.create({ role: 'user', mood: null, tags: ['bogus' as never] }),
      ).rejects.toMatchObject({ code: 121 });
    });
  });

  describe('db.enums via mongo() facade', () => {
    it('exposes the enum accessor at db.enums.Role without namespace key', () => {
      expect(db.enums['Role']).toBeDefined();
      expect(db.enums['Role'].values).toEqual(['user', 'admin']);
    });

    it('db.enums.Role.values returns the ordered tuple', () => {
      expect(db.enums['Role'].values).toEqual(['user', 'admin']);
    });

    it('db.enums.Role.members.User === "user"', () => {
      expect(db.enums['Role'].members['User']).toBe('user');
    });

    it('db.enums.Status.ordinalOf returns declaration-order indices (not lexical)', () => {
      const status = db.enums['Status'];
      expect(status).toBeDefined();
      // Declaration order: Pending=0, Active=1, Inactive=2
      // Lexical order would be: Active=0, Inactive=1, Pending=2 — different.
      expect(status.ordinalOf('pending')).toBe(0);
      expect(status.ordinalOf('active')).toBe(1);
      expect(status.ordinalOf('inactive')).toBe(2);
    });

    it('contract domain carries a scalar role field (compile-time)', () => {
      // Prove the contract type sees Account.role as a scalar field.
      // The no-emit InferFieldType path narrows it to the enum value union.
      type NS = (typeof contract)['domain']['namespaces'];
      type Fields = NS[keyof NS]['models']['Account']['fields'];
      type RoleKind = Fields['role']['type']['kind'];
      expectTypeOf<RoleKind>().toEqualTypeOf<'scalar'>();
    });

    it('precomputed FieldOutputTypes is reachable on the built contract type (D8)', () => {
      // D8 attaches FieldOutputTypesFromDefinition to MongoContractResult. The
      // per-model narrowing through this utility is exercised by the hand-built
      // ContractWithEnum fixture in mongo-contract/test/contract-types.test-d.ts
      // (which includes the manyNullableRoles case that F11's precedence fix
      // ensures resolves to Base[] | null, not (Base | null)[]).
      type _Probe = ExtractMongoFieldOutputTypes<typeof contract>;
      expectTypeOf<_Probe>().not.toBeNever();
    });

    it('namespace enum slot is typed on TS-DSL contract (no cast needed, F14)', () => {
      // F14: MongoDomainNamespaceFromDefinition now carries enum?, so the
      // namespace enum entries are accessible without a RuntimeNs cast.
      // The members tuple preserves the literal value union via EnumTypeHandle.
      type Ns = (typeof contract)['domain']['namespaces']['__unbound__'];
      type RoleEntry = NonNullable<Ns['enum']>['Role'];
      type MemberValue = RoleEntry['members'][number]['value'];
      expectTypeOf<MemberValue>().toEqualTypeOf<'user' | 'admin'>();
    });
  });
});

describe('emit-then-consume: value-union narrowing through the emitted contract.d.ts', () => {
  const mongoCodecImports = [
    {
      package: '@internal/target-mongo/codec-types',
      named: 'CodecTypes' as const,
      alias: 'MongoCodecTypes' as const,
    },
  ];

  const testHashes = {
    storageHash: 'enum-e2e-test',
    profileHash: 'enum-e2e-profile',
  };

  it('emits the enum value union into FieldOutputTypes for a Role field', () => {
    const dts = generateContractDts(
      contract as never,
      mongoEmission,
      mongoCodecImports,
      testHashes,
      undefined,
      codecLookup,
    );

    const outputMap = dts.slice(
      dts.indexOf('export type FieldOutputTypes'),
      dts.indexOf('export type FieldInputTypes'),
    );

    // The enum field narrows to the literal value union (not the codec channel).
    expect(outputMap).toContain('readonly role: "user" | "admin"');
    expect(outputMap).not.toContain('readonly role: CodecTypes["mongo/string@1"]["output"]');
    // Negative: must not widen to a union with string or the full codec channel.
    expect(outputMap).not.toContain('readonly role: "user" | "admin" | string');
    expect(outputMap).not.toContain('readonly role: string');

    // The non-enum fields are unchanged.
    expect(dts).toContain('CodecTypes["mongo/objectId@1"]');
  });

  it('emits null-inclusive union for a nullable enum field', () => {
    const dts = generateContractDts(
      contract as never,
      mongoEmission,
      mongoCodecImports,
      testHashes,
      undefined,
      codecLookup,
    );

    const outputMap = dts.slice(
      dts.indexOf('export type FieldOutputTypes'),
      dts.indexOf('export type FieldInputTypes'),
    );

    expect(outputMap).toContain('readonly mood: "user" | "admin" | null');
    expect(outputMap).not.toContain('readonly mood: "user" | "admin" | null | string');
    expect(outputMap).not.toContain('readonly mood: string | null');
  });

  it('emits ReadonlyArray value union for an array enum field', () => {
    const dts = generateContractDts(
      contract as never,
      mongoEmission,
      mongoCodecImports,
      testHashes,
      undefined,
      codecLookup,
    );

    const outputMap = dts.slice(
      dts.indexOf('export type FieldOutputTypes'),
      dts.indexOf('export type FieldInputTypes'),
    );

    expect(outputMap).toContain('readonly tags: ReadonlyArray<"user" | "admin">');
    expect(outputMap).not.toContain('readonly tags: ReadonlyArray<"user" | "admin" | string>');
    expect(outputMap).not.toContain('readonly tags: ReadonlyArray<string>');
  });

  it('non-vacuous: emits the enum domain block in the namespace type (contract.d.ts carries it)', () => {
    const dts = generateContractDts(
      contract as never,
      mongoEmission,
      mongoCodecImports,
      testHashes,
      undefined,
      codecLookup,
    );

    // The emitted contract.d.ts must carry the enum entity in the domain namespace
    // type so the consumer's type checker can resolve it. Without this block, the
    // FieldOutputTypes narrowing above would not fire.
    expect(dts).toContain('readonly enum:');
    expect(dts).toContain('readonly Role:');
    expect(dts).toContain('readonly codecId: "mongo/string@1"');
    expect(dts).toContain('readonly name: "User"');
    expect(dts).toContain('readonly value: "user"');
    expect(dts).toContain('readonly name: "Admin"');
    expect(dts).toContain('readonly value: "admin"');
  });
});
