import { describe, expect, it } from 'vitest';
import generated from './_fixture/generated/contract.json' with { type: 'json' };
import aliases from './_fixture-aliases/generated/contract.json' with { type: 'json' };

describe('Mongo date fields typed by type aliases', () => {
  it('emit the same storage and execution hashes as @onCreate(now()) and @onUpdate(now())', () => {
    expect({
      storageHash: aliases.storage.storageHash,
      executionHash: aliases.execution?.executionHash,
    }).toEqual({
      storageHash: generated.storage.storageHash,
      executionHash: generated.execution?.executionHash,
    });
  });
});
