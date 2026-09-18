import { temporalAuthoringPresets, temporalCodecPreset } from '@internal/family-sql/control';
import type {
  AuthoringFieldNamespace,
  AuthoringTypeNamespace,
} from '@internal/framework-components/authoring';

export const sqliteAuthoringTypes = {
  BigIntNumber: {
    kind: 'typeConstructor',
    documentation:
      'A SQLite integer represented as a JavaScript number within its safe integer range.',
    output: {
      codecId: 'sqlite/bigintnumber@1',
      nativeType: 'integer',
    },
  },
} as const satisfies AuthoringTypeNamespace;

export const sqliteAuthoringFieldPresets = {
  temporal: {
    .../* @__PURE__ */ temporalAuthoringPresets({
      codecId: 'sqlite/datetime@1',
      nativeType: 'text',
    }),
    datetime: /* @__PURE__ */ temporalCodecPreset({
      codecId: 'sqlite/datetime@1',
      nativeType: 'text',
    }),
  },
} as const satisfies AuthoringFieldNamespace;
