import { sqlTargetTypeConstructors } from '@internal/family-sql/pack';
import type { AuthoringTypeNamespace } from '@internal/framework-components/authoring';
import { temporalTypeAliases } from '@internal/framework-components/authoring';

export const sqliteAuthoringTypes = {
  .../* @__PURE__ */ sqlTargetTypeConstructors({ sizeType: 'sqlite/real' }),
  temporal: /* @__PURE__ */ temporalTypeAliases(
    { codecId: 'sqlite/datetime@1' },
    'a JavaScript Date',
  ),
} as const satisfies AuthoringTypeNamespace;
