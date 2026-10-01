import { type CodecLookup, emptyCodecLookup } from '@internal/framework-components/codec';
import type { FamilyPackRef, TargetPackRef } from '@internal/framework-components/components';
import { test } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { defineContract } from '../src/contract-builder';

const family: FamilyPackRef<'sql'> = {
  kind: 'family',
  id: 'sql',
  familyId: 'sql',
  version: '0.0.1',
};

const target: TargetPackRef<'sql', 'postgres'> = {
  kind: 'target',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  defaultNamespaceId: 'public',
};

test('the codecLookup option takes only a lookup that resolves codec descriptors', () => {
  const withoutDescriptors: CodecLookup = emptyCodecLookup;
  defineContract({
    family,
    target,
    createNamespace: createTestSqlNamespace,
    // @ts-expect-error a column's codec is built from its descriptor, so the lookup must have descriptorFor
    codecLookup: withoutDescriptors,
  });
  defineContract({
    family,
    target,
    createNamespace: createTestSqlNamespace,
    codecLookup: { ...withoutDescriptors, descriptorFor: () => undefined },
  });
});
