import type { ContractEnum } from '@internal/contract/types';
import type {
  PslExtensionBlock,
  PslExtensionBlockParamValue,
} from '@internal/framework-components/psl-ast';
import type { StorageColumn } from '@internal/sql-contract/types';
import { escapePslString } from '@internal/sql-relational-core/ast';
import type { PostgresNativeEnum } from '../postgres-native-enum';
import { buildNativeEnumBlock } from '../psl-ast/native-enum-block';
import { SYNTHETIC_SPAN } from '../psl-ast/psl-literals';
import {
  refuseNativeEnumControl,
  refuseNativeEnumWithoutValueSet,
  refuseUnwritableName,
} from './refusals';

/**
 * One `enum <name> { … }` block per domain enum, each member written as
 * `Name = <value>` under `@@type`. The PSL source reads a member value as JSON,
 * so the value is written as JSON text.
 */
export function buildDomainEnumBlocks(
  enums: Readonly<Record<string, ContractEnum>>,
): readonly PslExtensionBlock[] {
  return Object.entries(enums).map(([name, domainEnum]): PslExtensionBlock => {
    refuseUnwritableName('enum', name);
    const parameters = Object.fromEntries(
      domainEnum.members.map((member): [string, PslExtensionBlockParamValue] => {
        refuseUnwritableName('enum member', member.name);
        return [
          member.name,
          { kind: 'value', raw: JSON.stringify(member.value), span: SYNTHETIC_SPAN },
        ];
      }),
    );
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
              value: `"${escapePslString(domainEnum.codecId)}"`,
              span: SYNTHETIC_SPAN,
            },
          ],
          span: SYNTHETIC_SPAN,
        },
      ],
      attributes: { type: { args: { codec: domainEnum.codecId }, span: SYNTHETIC_SPAN } },
      span: SYNTHETIC_SPAN,
    };
  });
}

export interface NativeEnumEmission {
  readonly blocks: readonly PslExtensionBlock[];
  /** Native type name, bare and schema-qualified, → the `native_enum` block that declares it. */
  readonly blockNamesByTypeName: ReadonlyMap<string, string>;
  /** Block name → the members of the value set the PSL source derives from that block. */
  readonly derivedValueSets: ReadonlyMap<string, readonly string[]>;
}

function sameValues(left: readonly unknown[], right: readonly unknown[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/**
 * Builds one `native_enum` block per enum type a namespace declares.
 *
 * A contract keys a native enum by its type name and keys the value set it
 * derives by the name the schema gave the enum, and the PSL source derives
 * that value set from the block, named after the block. So the block is named
 * after the enum's value set: the value set a column typed by the enum names;
 * else, for an enum no column refers to, the unclaimed value set with the
 * enum's own name that holds exactly its members, or else the first unclaimed
 * one that does. An enum with no such value set is refused. `@@map` carries
 * the type name whenever it differs from the block name.
 */
export function buildNativeEnumBlocksForNamespace(input: {
  readonly namespaceId: string;
  readonly nativeEnums: ReadonlyMap<string, PostgresNativeEnum>;
  readonly valueSets: ReadonlyMap<string, readonly unknown[]>;
  readonly columns: readonly StorageColumn[];
}): NativeEnumEmission {
  const valueSetNamesByTypeName = new Map<string, string>();
  for (const column of input.columns) {
    const valueSetName = column.valueSet?.entityName;
    if (valueSetName === undefined) continue;
    valueSetNamesByTypeName.set(column.nativeType, valueSetName);
  }
  const claimed = new Set(valueSetNamesByTypeName.values());

  const unreferenced: { entryName: string; nativeEnum: PostgresNativeEnum }[] = [];
  const nameByEntry = new Map<string, string>();
  for (const [entryName, nativeEnum] of input.nativeEnums) {
    refuseNativeEnumControl(input.namespaceId, nativeEnum);
    const { typeName } = nativeEnum;
    const fromColumn =
      valueSetNamesByTypeName.get(typeName) ??
      valueSetNamesByTypeName.get(`${input.namespaceId}.${typeName}`);
    if (fromColumn === undefined) {
      unreferenced.push({ entryName, nativeEnum });
      continue;
    }
    nameByEntry.set(entryName, fromColumn);
  }

  for (const { entryName, nativeEnum } of unreferenced) {
    const candidates = [...input.valueSets]
      .filter(([name, values]) => !claimed.has(name) && sameValues(values, nativeEnum.members))
      .map(([name]) => name);
    const chosen = candidates.find((name) => name === entryName) ?? candidates[0];
    if (chosen === undefined) refuseNativeEnumWithoutValueSet(input.namespaceId, nativeEnum);
    claimed.add(chosen);
    nameByEntry.set(entryName, chosen);
  }

  const blocks: PslExtensionBlock[] = [];
  const blockNamesByTypeName = new Map<string, string>();
  const derivedValueSets = new Map<string, readonly string[]>();
  for (const [entryName, nativeEnum] of input.nativeEnums) {
    const { typeName } = nativeEnum;
    const blockName = nameByEntry.get(entryName) ?? typeName;
    refuseUnwritableName('native enum', blockName);
    blocks.push(buildNativeEnumBlock(blockName, typeName, nativeEnum.members));
    blockNamesByTypeName.set(typeName, blockName);
    blockNamesByTypeName.set(`${input.namespaceId}.${typeName}`, blockName);
    derivedValueSets.set(blockName, nativeEnum.members);
  }
  return { blocks, blockNamesByTypeName, derivedValueSets };
}
