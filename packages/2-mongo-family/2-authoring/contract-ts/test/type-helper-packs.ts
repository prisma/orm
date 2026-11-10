import type { ExtensionPackRef } from '@internal/framework-components/components';

const length = { kind: 'value', dataType: 'mongo/int32', name: 'length', optional: true } as const;

/** An extension pack whose namespace holds two constructors and a type choice between them. */
export const choicePack = {
  kind: 'extension',
  id: 'choices',
  familyId: 'mongo',
  targetId: 'mongo',
  version: '0.0.1',
  authoring: {
    type: {
      choices: {
        Text: { kind: 'typeConstructor', output: { codecId: 'mongo/string@1' } },
        Embedding: {
          kind: 'typeConstructor',
          args: [length],
          output: { codecId: 'mongo/vector@1', typeParams: { length: { kind: 'arg', index: 0 } } },
        },
        Value: {
          kind: 'typeChoice',
          args: [
            {
              kind: 'option',
              name: 'as',
              values: ['text', 'vector'],
              default: 'text',
              optional: true,
            },
            length,
          ],
          choices: [
            { when: { as: 'text' }, type: 'Text' },
            { when: { as: 'vector' }, type: 'Embedding' },
          ],
        },
      },
    },
  },
} as const satisfies ExtensionPackRef<'mongo', 'mongo'>;
