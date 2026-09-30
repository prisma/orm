import { test } from 'vitest';
import { type CodecLookup, codecForRef, emptyCodecLookup } from '../src/exports/codec';

test('codecForRef takes only a lookup that resolves codec descriptors', () => {
  const withoutDescriptors: CodecLookup = emptyCodecLookup;
  // @ts-expect-error a column's codec is built from its descriptor, so the lookup must have descriptorFor
  codecForRef(withoutDescriptors, { codecId: 'demo/int4@1' });
  codecForRef(
    { ...withoutDescriptors, descriptorFor: () => undefined },
    { codecId: 'demo/int4@1' },
  );
});
