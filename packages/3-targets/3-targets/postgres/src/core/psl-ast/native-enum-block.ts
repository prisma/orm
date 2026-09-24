import { toEnumMemberName } from '@internal/family-sql/psl-ast';
import type {
  PslExtensionBlock,
  PslExtensionBlockParamValue,
} from '@internal/framework-components/psl-ast';
import { escapePslString } from '@internal/sql-relational-core/ast';
import { SYNTHETIC_SPAN } from './psl-literals';
import { createUniqueFieldName } from './unique-name';

/** One `native_enum <name> { … }` block, with `@@map` when the type name differs from the block name. */
export function buildNativeEnumBlock(
  name: string,
  typeName: string,
  values: readonly string[],
): PslExtensionBlock {
  const usedMemberNames = new Set<string>();
  const parameters: Record<string, PslExtensionBlockParamValue> = {};
  for (const value of values) {
    const memberName = createUniqueFieldName(toEnumMemberName(value), usedMemberNames);
    usedMemberNames.add(memberName);
    parameters[memberName] = { kind: 'value', raw: JSON.stringify(value), span: SYNTHETIC_SPAN };
  }

  return {
    kind: 'native_enum',
    keyword: 'native_enum',
    name,
    parameters,
    blockAttributes:
      name === typeName
        ? []
        : [
            {
              name: 'map',
              args: [
                {
                  kind: 'positional',
                  value: `"${escapePslString(typeName)}"`,
                  span: SYNTHETIC_SPAN,
                },
              ],
              span: SYNTHETIC_SPAN,
            },
          ],
    attributes:
      name === typeName ? {} : { map: { args: { name: typeName }, span: SYNTHETIC_SPAN } },
    span: SYNTHETIC_SPAN,
  };
}
