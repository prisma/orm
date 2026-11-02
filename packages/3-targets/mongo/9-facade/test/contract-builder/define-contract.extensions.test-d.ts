import type { ExtensionPackRef } from '@internal/framework-components/components';
import { expectTypeOf, test } from 'vitest';
import { defineContract } from '../../src/exports/contract-builder';
import { shoutPack } from '../fixtures/shout-extension';

declare const sqlPack: ExtensionPackRef<'sql', 'postgres'>;

test('the contract carries the extension packs it is given', () => {
  const definition = defineContract({ extensions: { shout: shoutPack } });
  expectTypeOf(definition.extensions).toEqualTypeOf<{ readonly shout: typeof shoutPack }>();

  const factory = defineContract({ extensions: { shout: shoutPack } }, () => ({}));
  expectTypeOf(factory.extensions).toEqualTypeOf<{ readonly shout: typeof shoutPack }>();
});

test('a SQL extension pack is refused', () => {
  // @ts-expect-error a SQL extension pack is not a MongoDB one
  defineContract({ extensions: { pgvector: sqlPack } });
  // @ts-expect-error a SQL extension pack is not a MongoDB one
  defineContract({ extensions: { pgvector: sqlPack } }, () => ({}));
});
