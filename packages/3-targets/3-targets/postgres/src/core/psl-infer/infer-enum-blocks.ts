import { toEnumName } from '@internal/family-sql/psl-infer';
import type { PslExtensionBlock } from '@internal/framework-components/psl-ast';
import { buildNativeEnumBlock } from '../psl-ast/native-enum-block';
import { createUniqueFieldName } from '../psl-ast/unique-name';
import { buildTopLevelNameMap, type TopLevelNameResult } from './infer-names';

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
