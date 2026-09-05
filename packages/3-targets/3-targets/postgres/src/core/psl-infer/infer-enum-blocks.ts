import { toEnumMemberName, toEnumName } from '@internal/family-sql/psl-infer';
import { collectScalarTypeConstructors } from '@internal/framework-components/authoring';
import type {
  PslExtensionBlock,
  PslExtensionBlockParamValue,
} from '@internal/framework-components/psl-ast';
import { postgresAuthoringTypes } from '../authoring';
import {
  buildTopLevelNameMap,
  createUniqueFieldName,
  type TopLevelNameResult,
} from './infer-names';
import { POSTGRES_PSL_TYPE_NAMES } from './postgres-type-map';
import { escapePslString, SYNTHETIC_SPAN } from './psl-literals';

const FRAMEWORK_SCALAR_TYPE_NAMES = [
  'String',
  'Boolean',
  'Int',
  'BigInt',
  'Float',
  'Decimal',
  'DateTime',
  'Json',
  'Bytes',
] as const;

/**
 * Every name that resolves as a type in column position of inferred output:
 * the framework scalars, every PSL name the Postgres type map can emit
 * (`Uuid`, `VarChar`, `Timestamptz`, …), and the target pack's own zero-arg
 * type constructors (`BigIntNumber`, `UnboundedInt`). An inferred enum block
 * claiming one of these names would silently retype every column of that
 * type, so enum naming treats the whole set as reserved.
 */
export const PSL_SCALAR_TYPE_NAMES: ReadonlySet<string> = new Set([
  ...FRAMEWORK_SCALAR_TYPE_NAMES,
  ...POSTGRES_PSL_TYPE_NAMES,
  ...collectScalarTypeConstructors(postgresAuthoringTypes).keys(),
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

/**
 * Builds the family `enum` extension-block AST node for a recovered domain
 * enum. Members print as `<sanitizedName> = "<value>"` pairs (names
 * deduplicated within the block, values JSON-encoded verbatim) and the block
 * carries `@@type("<codecId>")`. The caller owns name allocation — recovered
 * names uniquify against the whole top-level scope before this is called.
 */
export function buildRecoveredEnumBlock(
  name: string,
  memberValues: readonly string[],
  codecId: string,
): PslExtensionBlock {
  const usedMemberNames = new Set<string>();
  const parameters: Record<string, PslExtensionBlockParamValue> = {};
  for (const value of memberValues) {
    const memberName = createUniqueFieldName(toEnumMemberName(value), usedMemberNames);
    usedMemberNames.add(memberName);
    parameters[memberName] = { kind: 'value', raw: JSON.stringify(value), span: SYNTHETIC_SPAN };
  }

  return {
    kind: 'enum',
    keyword: 'enum',
    name,
    parameters,
    blockAttributes: [
      {
        name: 'type',
        args: [
          {
            kind: 'positional',
            value: `"${escapePslString(codecId)}"`,
            span: SYNTHETIC_SPAN,
          },
        ],
        span: SYNTHETIC_SPAN,
      },
    ],
    span: SYNTHETIC_SPAN,
  };
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
    span: SYNTHETIC_SPAN,
  };
}
