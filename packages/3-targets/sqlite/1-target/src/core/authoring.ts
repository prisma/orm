import { sqlTargetTypeConstructors } from '@internal/family-sql/pack';
import type { AuthoringTypeNamespace } from '@internal/framework-components/authoring';
import { temporalTypeAliases } from '@internal/framework-components/authoring';

export const sqliteAuthoringTypes = {
  .../* @__PURE__ */ sqlTargetTypeConstructors({ sizeType: 'sqlite/real' }),
  BigIntNumber: {
    kind: 'typeConstructor',
    documentation:
      'A SQLite integer represented as a JavaScript number within its safe integer range.',
    output: {
      codecId: 'sqlite/bigintnumber@1',
    },
  },
  temporal: /* @__PURE__ */ temporalTypeAliases(
    { codecId: 'sqlite/datetime@1' },
    'a JavaScript Date',
  ),
} as const satisfies AuthoringTypeNamespace;
