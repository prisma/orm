import { toEnumMemberName, toEnumName } from '@internal/family-sql/psl-infer';
import type {
  PslExtensionBlock,
  PslExtensionBlockParamValue,
} from '@internal/framework-components/psl-ast';
import {
  buildTopLevelNameMap,
  createUniqueFieldName,
  type TopLevelNameResult,
} from './infer-names';
import { escapePslString, SYNTHETIC_SPAN } from './psl-literals';

export const PSL_SCALAR_TYPE_NAMES = new Set([
  'String',
  'Boolean',
  'Int',
  'BigInt',
  'Float',
  'Decimal',
  'DateTime',
  'Json',
  'Bytes',
]);

type NativeEnumBlockResult = {
  /** Native enum type name → PSL block name, for `pg.enum(<Name>)` field refs. */
  readonly enumNameMap: ReadonlyMap<string, string>;
  readonly enumBlocks: readonly PslExtensionBlock[];
};

/**
 * Builds one `native_enum` extension-block AST node per introspected enum
 * definition. Block names go through the shared top-level transform
 * (`toEnumName`, intra-enum collisions throw like model collisions) and are
 * then reserved against the model names — an enum whose PSL name a model
 * already claims gets a numeric suffix, with `@@map` carrying the real type
 * name. Members print as explicit `member = "value"` pairs: the member name
 * is the sanitized value (deduplicated within the block), the JSON-encoded
 * value carries the truth verbatim.
 */
export function buildNativeEnumBlocks(
  definitions: ReadonlyMap<string, readonly string[]>,
  modelNames: ReadonlyMap<string, TopLevelNameResult>,
): NativeEnumBlockResult {
  const enumNames = buildTopLevelNameMap(
    [...definitions.keys()].sort(),
    toEnumName,
    'enum',
    'enum type',
  );

  const usedTopLevelNames = new Set<string>(PSL_SCALAR_TYPE_NAMES);
  for (const result of modelNames.values()) {
    usedTopLevelNames.add(result.name);
  }

  const enumNameMap = new Map<string, string>();
  const enumBlocks: PslExtensionBlock[] = [];
  for (const [typeName, result] of enumNames) {
    const name = createUniqueFieldName(result.name, usedTopLevelNames);
    usedTopLevelNames.add(name);
    enumNameMap.set(typeName, name);
    enumBlocks.push(buildNativeEnumBlock(name, typeName, definitions.get(typeName) ?? []));
  }

  return { enumNameMap, enumBlocks };
}

function buildNativeEnumBlock(
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
