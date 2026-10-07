import type {
  AuthoringFieldNamespace,
  AuthoringTypeNamespace,
} from '@internal/framework-components/authoring';
import {
  temporalAuthoringPresets,
  temporalCodecPreset,
} from '@internal/framework-components/authoring';
export const sqliteAuthoringTypes = {
  BigIntNumber: {
    kind: 'typeConstructor',
    documentation:
      'A SQLite integer represented as a JavaScript number within its safe integer range.',
    output: {
      codecId: 'sqlite/bigintnumber@1',
    },
  },
} as const satisfies AuthoringTypeNamespace;

export const sqliteAuthoringFieldPresets = {
  temporal: {
    .../* @__PURE__ */ temporalAuthoringPresets({
      codecId: 'sqlite/datetime@1',
    }),
    datetime: /* @__PURE__ */ temporalCodecPreset({
      codecId: 'sqlite/datetime@1',
    }),
  },
} as const satisfies AuthoringFieldNamespace;
