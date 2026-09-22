import { isStructuredError } from '@internal/utils/structured-error';
import { describe, expect, it } from 'vitest';
import { generateContractDts } from '../src/generate-contract-dts';
import { createMockSpi } from './mock-spi';
import { createTestContract } from './utils';

const mockSqlHook = createMockSpi();

const HASHES = {
  storageHash: '0000000000000000000000000000000000000000000000000000000000000001',
  profileHash: '0000000000000000000000000000000000000000000000000000000000000002',
};

describe('generateContractDts domain namespace handling', () => {
  it('emits successfully for a single namespace', () => {
    const contract = {
      ...createTestContract(),
      domain: {
        namespaces: {
          public: { models: {} },
        },
      },
    };
    const dts = generateContractDts(contract, mockSqlHook, [], HASHES);
    expect(dts).toContain('readonly public:');
  });

  it('emits successfully for multiple namespaces', () => {
    const contract = {
      ...createTestContract(),
      domain: {
        namespaces: {
          auth: { models: {} },
          storage: { models: {} },
        },
      },
    };
    const dts = generateContractDts(contract, mockSqlHook, [], HASHES);
    expect(dts).toContain('readonly auth:');
    expect(dts).toContain('readonly storage:');
  });

  it('quotes a namespace id that is not a bare identifier', () => {
    const contract = {
      ...createTestContract(),
      domain: {
        namespaces: {
          'report data': { models: {} },
        },
      },
    };
    const dts = generateContractDts(contract, mockSqlHook, [], HASHES);
    expect(dts).toContain('readonly "report data":');
  });

  it("emits each namespace's same-bare-name model under its own coordinate", () => {
    // Both namespaces have a 'User' model. With the flat top-level models map
    // retired, neither model is dropped: each namespace's own `User` is emitted
    // under its own coordinate, and field types resolve per-namespace.
    const authUserModel = {
      fields: {
        emailAddress: { type: { kind: 'scalar' as const, codecId: 'pg/text@1' }, nullable: false },
      },
      relations: {},
      storage: {
        namespaceId: 'auth',
        table: 'users',
        fields: { emailAddress: { column: 'email_address' } },
      },
    };
    const publicUserModel = {
      fields: {
        roleLabel: { type: { kind: 'scalar' as const, codecId: 'pg/text@1' }, nullable: true },
      },
      relations: {},
      storage: {
        namespaceId: 'public',
        table: 'users',
        fields: { roleLabel: { column: 'role_label' } },
      },
    };
    const contract = {
      ...createTestContract(),
      domain: {
        namespaces: {
          auth: { models: { User: authUserModel } },
          public: { models: { User: publicUserModel } },
        },
      },
    };
    const dts = generateContractDts(contract, mockSqlHook, [], HASHES);
    // No flat top-level models map is emitted, so there is no `Models` export
    // and no `ContractType<…, models>` second argument to drop fields into.
    expect(dts).not.toContain('export type Models');
    const emailCount = (dts.match(/emailAddress/g) ?? []).length;
    const roleLabelCount = (dts.match(/roleLabel/g) ?? []).length;
    // emailAddress appears per-namespace only: (1) the auth domain block,
    // (2) FieldOutputTypes[auth], (3) FieldInputTypes[auth], (4) Models.auth_User.
    expect(emailCount).toBe(4);
    // roleLabel appears per-namespace only: (1) the public domain block,
    // (2) FieldOutputTypes[public], (3) FieldInputTypes[public], (4) Models.public_User.
    expect(roleLabelCount).toBe(4);
  });

  it('throws CONTRACT.NAMESPACE_INVALID when the domain has no namespaces', () => {
    const contract = {
      ...createTestContract(),
      domain: { namespaces: {} },
    };
    let thrown: unknown;
    try {
      generateContractDts(contract, mockSqlHook, [], HASHES);
    } catch (error) {
      thrown = error;
    }
    expect(isStructuredError(thrown)).toBe(true);
    expect(thrown).toMatchObject({
      code: 'CONTRACT.NAMESPACE_INVALID',
      message: 'domain has no namespaces',
    });
  });
});
