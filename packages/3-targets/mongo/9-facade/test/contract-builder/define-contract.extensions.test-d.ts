import type { ExtensionPackRef } from '@internal/framework-components/components';
import { expectTypeOf, test } from 'vitest';
import { defineContract } from '../../src/exports/contract-builder';
import mongo from '../../src/runtime/mongo';
import { shoutPack, shoutRuntime } from '../fixtures/shout-extension';

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

test("an extension's codec types reach the client's row types", () => {
  const contract = defineContract({ extensions: { shout: shoutPack } }, ({ field, model }) => ({
    models: {
      Greeting: model('Greeting', {
        collection: 'greetings',
        fields: { _id: field.objectId(), text: field.scalar('shout/text@1') },
      }),
    },
    roots: { greetings: 'Greeting' },
  }));
  const db = mongo({ contract, url: 'mongodb://localhost/db', extensions: [shoutRuntime] });
  type Row = NonNullable<Awaited<ReturnType<typeof db.orm.greetings.first>>>;
  expectTypeOf<Row['text']>().toEqualTypeOf<string>();
});

declare const shoutWithGenerator: typeof shoutPack & {
  readonly generatorFunctions: readonly [
    {
      readonly name: 'shout';
      readonly signature: { readonly documentation: 'Writes a shout.' };
      readonly bindings: readonly [];
    },
  ];
};

test("an extension's authoring helpers reach the contract factory", () => {
  defineContract({ extensions: { shout: shoutWithGenerator } }, ({ gen }) => {
    expectTypeOf<keyof typeof gen>().toEqualTypeOf<'now' | 'shout'>();
    return {};
  });
});
