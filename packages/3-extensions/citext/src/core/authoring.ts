import type { AuthoringTypeNamespace } from '@internal/framework-components/authoring';
import { CITEXT_CODEC_ID } from './constants';

export const citextAuthoringTypes = {
  citext: {
    Citext: {
      kind: 'typeConstructor',
      inferred: true,
      documentation: 'Text that PostgreSQL compares without regard to case, stored as citext.',
      output: { codecId: CITEXT_CODEC_ID },
    },
  },
} as const satisfies AuthoringTypeNamespace;
