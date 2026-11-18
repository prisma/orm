import { test } from 'vitest';
import {
  type CodecLookup,
  type CodecLookupWithDescriptors,
  codecForRef,
  emptyCodecLookup,
} from '../src/exports/codec';

test('codecForRef takes only a lookup that resolves codec descriptors', () => {
  const withoutDescriptors: CodecLookup = emptyCodecLookup;
  // @ts-expect-error a column's codec is built from its descriptor, so the lookup must have descriptorFor
  codecForRef(withoutDescriptors, { codecId: 'demo/int4@1' });
  codecForRef(
    { ...withoutDescriptors, descriptorFor: () => undefined },
    { codecId: 'demo/int4@1' },
  );
});

test('a stub that adds codecs to the empty lookup must say how it resolves their descriptors', () => {
  // @ts-expect-error the empty lookup has no descriptorFor that would answer nothing while get answers
  const stub: CodecLookupWithDescriptors = { ...emptyCodecLookup, get: () => undefined };
  void stub;
});
