import { describe, expect, it } from 'vitest';
import generated from './_fixture/generated/contract.json' with { type: 'json' };
import attributes from './_fixture-attributes/generated/contract.json' with { type: 'json' };

describe('Mongo date fields written with @onCreate(now()) and @onUpdate(now())', () => {
  it('emit the same storage and execution hashes as the shared fixture', () => {
    expect({
      storageHash: attributes.storage.storageHash,
      executionHash: attributes.execution?.executionHash,
    }).toEqual({
      storageHash: generated.storage.storageHash,
      executionHash: generated.execution?.executionHash,
    });
  });
});
