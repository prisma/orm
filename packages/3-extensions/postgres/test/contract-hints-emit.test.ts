import { readFileSync } from 'node:fs';
import { createPostgresBuiltinCodecLookup } from '@internal/adapter-postgres/control';
import type { Contract } from '@internal/contract/types';
import { emit } from '@internal/emitter';
import type { SqlStorage } from '@internal/sql-contract/types';
import { sqlEmission } from '@internal/sql-contract-emitter';
import postgresTargetDescriptor from '@internal/target-postgres/control';
import { ifDefined } from '@internal/utils/defined';
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';

const fixtureText = readFileSync(
  join(import.meta.dirname, 'fixtures', 'generated', 'contract.json'),
  'utf8',
);

const hints = {
  namespaces: {
    public: {
      tables: {
        user: { was: 'account' },
      },
    },
  },
};

const { contractSerializer } = postgresTargetDescriptor;

function loadFixture(extra: Record<string, unknown> = {}): Contract {
  return contractSerializer.deserializeContract({ ...JSON.parse(fixtureText), ...extra });
}

function emitContract(contract: Contract) {
  return emit(contract, { codecLookup: createPostgresBuiltinCodecLookup() }, sqlEmission, {
    serializeContract: (c) => contractSerializer.serializeContract(c as Contract<SqlStorage>),
    deserializeContract: (json) => contractSerializer.deserializeContract(json),
    ...ifDefined('shouldPreserveEmpty', contractSerializer.shouldPreserveEmpty),
    ...ifDefined('sortStorage', contractSerializer.sortStorage),
  });
}

function hashesOf(contractJson: string) {
  const parsed = JSON.parse(contractJson);
  return {
    storageHash: parsed.storage.storageHash,
    executionHash: parsed.execution?.executionHash,
    profileHash: parsed.profileHash,
  };
}

describe('emitting a contract with a hints section', () => {
  it('re-emits the fixture without hints byte for byte', async () => {
    const result = await emitContract(loadFixture());
    expect(result.contractJson).toBe(fixtureText);
  });

  it('writes hints between extensions and meta and changes nothing else', async () => {
    const result = await emitContract(loadFixture({ hints }));
    const emitted = JSON.parse(result.contractJson);
    const keys = Object.keys(emitted);
    expect(keys.slice(keys.indexOf('extensions'))).toEqual([
      'extensions',
      'hints',
      'meta',
      '_generated',
    ]);
    expect(emitted.hints).toEqual(hints);
    const { hints: _hints, ...withoutHints } = emitted;
    expect(JSON.stringify(withoutHints, null, 2)).toBe(fixtureText);
  });

  it('leaves the storage, execution and profile hashes unchanged', async () => {
    const withoutHints = await emitContract(loadFixture());
    const withHints = await emitContract(loadFixture({ hints }));
    expect(hashesOf(withHints.contractJson)).toEqual(hashesOf(withoutHints.contractJson));
    expect({
      storageHash: withHints.storageHash,
      executionHash: withHints.executionHash,
      profileHash: withHints.profileHash,
    }).toEqual({
      storageHash: withoutHints.storageHash,
      executionHash: withoutHints.executionHash,
      profileHash: withoutHints.profileHash,
    });
  });

  it('declares no hints member in contract.d.ts', async () => {
    const result = await emitContract(loadFixture({ hints }));
    expect(result.contractDts).not.toContain('hints');
  });
});
