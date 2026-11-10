import { describe, expect, it } from 'vitest';
import attributes from './_fixture-attributes/generated/contract.json' with { type: 'json' };
import presets from './_fixture-now/generated/contract.json' with { type: 'json' };

describe('date and time columns written with @onCreate(now()) @onUpdate(now())', () => {
  it('emit the same storage and execution hashes as the temporal presets they replace', () => {
    expect({
      storageHash: attributes.storage.storageHash,
      executionHash: attributes.execution?.executionHash,
    }).toEqual({
      storageHash: presets.storage.storageHash,
      executionHash: presets.execution?.executionHash,
    });
  });
});
