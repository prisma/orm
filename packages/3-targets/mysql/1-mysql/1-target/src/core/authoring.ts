import { sqlTargetTypeConstructors } from '@internal/family-sql/pack';
import type { AuthoringTypeNamespace } from '@internal/framework-components/authoring';
import { temporalTypeAliases } from '@internal/framework-components/authoring';
import { MYSQL_DATETIME_CODEC_ID } from './codec-ids';

/** The type constructors whose arguments are sizes, which take values of `mysql/int`, and the created-at and updated-at aliases on the type a bare `DateTime` becomes: a `datetime(3)` column read as a JavaScript `Date`. */
export const mysqlAuthoringTypes = {
  .../* @__PURE__ */ sqlTargetTypeConstructors({ sizeType: 'mysql/int' }),
  temporal: /* @__PURE__ */ temporalTypeAliases(
    { codecId: MYSQL_DATETIME_CODEC_ID, typeParams: { precision: 3 } },
    'a JavaScript Date',
  ),
} as const satisfies AuthoringTypeNamespace;
