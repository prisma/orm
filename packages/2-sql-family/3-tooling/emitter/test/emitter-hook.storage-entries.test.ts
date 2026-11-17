import { generateContractDts } from '@internal/emitter';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { describe, expect, it } from 'vitest';
import { sqlEmission } from '../src/index';
import { createEmitterTestContract as createContract } from './create-emitter-test-contract';
import { identityCodecLookup } from './value-set-codec-lookups';

const testHashes = { storageHash: 'test-core-hash', profileHash: 'test-profile-hash' };

function contractWithEntries() {
  return createContract({
    domain: {
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: { models: {} },
      },
    },
    storage: {
      namespaces: {
        auth: {
          id: 'auth',
          entries: {
            table: {
              sessions: {
                columns: {
                  id: { dataType: 'pg/uuid', codecId: 'pg/uuid@1', nullable: false },
                },
                uniques: [],
                indexes: [],
                foreignKeys: [],
              },
            },
            valueSet: {
              AalLevel: { kind: 'valueSet', values: ['aal1', 'aal2', 'aal3'] },
            },
            native_enum: {
              AalLevel: {
                kind: 'postgres-enum',
                typeName: 'aal_level',
                members: [
                  { name: 'aal1', value: 'aal1' },
                  { name: 'aal2', value: 'aal2' },
                  { name: 'aal3', value: 'aal3' },
                ],
              },
            },
            role: {
              app_user: { kind: 'postgres-role', name: 'app_user', namespaceId: 'auth' },
            },
          },
        },
      },
    },
  });
}

describe('storage namespace entries type emission', () => {
  it('emits the valueSet slot literally — the only non-table entries slot with a type-level consumer', () => {
    const dts = generateContractDts(
      contractWithEntries(),
      sqlEmission,
      [],
      testHashes,
      undefined,
      identityCodecLookup,
    );

    expect(dts).toContain(
      'readonly valueSet: { readonly AalLevel: { readonly kind: "valueSet"; readonly values: readonly ["aal1", "aal2", "aal3"] } }',
    );
  });

  it('does not emit pack-contributed slots (native_enum, role, policy) — nothing types off them', () => {
    const dts = generateContractDts(
      contractWithEntries(),
      sqlEmission,
      [],
      testHashes,
      undefined,
      identityCodecLookup,
    );

    expect(dts).not.toContain('native_enum');
    expect(dts).not.toContain('readonly role:');
    expect(dts).not.toContain('postgres-role');
  });

  it('omits an empty valueSet slot', () => {
    const contract = createContract({
      domain: { namespaces: { [UNBOUND_NAMESPACE_ID]: { models: {} } } },
      storage: {
        namespaces: {
          auth: {
            id: 'auth',
            entries: {
              table: {},
              valueSet: {},
            },
          },
        },
      },
    });

    const dts = generateContractDts(
      contract,
      sqlEmission,
      [],
      testHashes,
      undefined,
      identityCodecLookup,
    );

    expect(dts).not.toContain('valueSet');
  });
});
