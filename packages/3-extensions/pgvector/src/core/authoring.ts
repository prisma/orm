import type { AuthoringTypeNamespace } from '@internal/framework-components/authoring';
import { VECTOR_MAX_DIM } from './constants';

export const pgvectorAuthoringTypes = {
  pgvector: {
    Vector: {
      kind: 'typeConstructor',
      args: [
        {
          kind: 'number',
          name: 'length',
          optional: true,
          integer: true,
          minimum: 1,
          maximum: VECTOR_MAX_DIM,
        },
      ],
      output: {
        codecId: 'pg/vector@1',
        nativeType: 'vector',
        typeParams: {
          length: { kind: 'arg', index: 0 },
        },
      },
    },
  },
} as const satisfies AuthoringTypeNamespace;
