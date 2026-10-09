import type { AuthoringTypeNamespace } from '@internal/framework-components/authoring';

export const pgvectorAuthoringTypes = {
  pgvector: {
    Vector: {
      kind: 'typeConstructor',
      inferred: true,
      args: [{ kind: 'number', name: 'length', optional: true, integer: true }],
      output: {
        codecId: 'pg/vector@1',
        typeParams: {
          length: { kind: 'arg', index: 0 },
        },
      },
    },
  },
} as const satisfies AuthoringTypeNamespace;
