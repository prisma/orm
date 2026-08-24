import { describe, expect, it } from 'vitest';
import { codecDescriptors } from '../src/core/codecs';
import { postgresCodecDescriptorRegistry, postgresCodecRegistry } from '../src/core/registry';

describe('PostgreSQL built-in codec descriptors', () => {
  it('builds typed and generic registries over the same ordered descriptors', () => {
    expect(Object.isFrozen(postgresCodecDescriptorRegistry)).toBe(true);
    expect([...postgresCodecDescriptorRegistry.values()]).toEqual(codecDescriptors);

    for (const descriptor of codecDescriptors) {
      expect(postgresCodecDescriptorRegistry.descriptorFor(descriptor.codecId)).toBe(descriptor);
      expect(postgresCodecRegistry.descriptorFor(descriptor.codecId)).toBe(descriptor);
    }
  });
});
