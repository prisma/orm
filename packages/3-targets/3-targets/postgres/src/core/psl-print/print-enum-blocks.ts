import { toEnumName } from '@internal/family-sql/psl-infer';
import type { PslExtensionBlock } from '@internal/framework-components/psl-ast';
import type { StorageColumn } from '@internal/sql-contract/types';
import type { PostgresNativeEnum } from '../postgres-native-enum';
import { buildNativeEnumBlock } from '../psl-infer/infer-enum-blocks';
import { createUniqueFieldName } from '../psl-infer/infer-names';

export interface NativeEnumEmission {
  readonly blocks: readonly PslExtensionBlock[];
  /** Native type name, bare and schema-qualified, → the `native_enum` block that declares it. */
  readonly blockNamesByTypeName: ReadonlyMap<string, string>;
}

function sameValues(left: readonly unknown[], right: readonly unknown[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/**
 * Builds one `native_enum` block per enum type a namespace declares.
 *
 * The block's name is the name of the value set the enum derives, never the
 * physical type name: a contract keys a native enum by its type name and keys
 * the value set it derives by the name the schema gave the enum, so the value
 * set is the only place the authored name survives. A column typed by the enum
 * names its value set directly. An enum no column refers to is matched to the
 * one unclaimed value set that holds exactly its members, in order; if no value
 * set matches, or more than one does, the block name is derived from the
 * physical type name the way `contract infer` derives one, and kept apart from
 * every other block name in the namespace. `@@map` carries the physical type
 * name whenever the two differ.
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
  const blockNamesByTypeName = new Map<string, string>();
  const nameByEntry = new Map<string, string>();
  for (const [entryName, nativeEnum] of input.nativeEnums) {
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

  const unmatched: { entryName: string; nativeEnum: PostgresNativeEnum }[] = [];
  for (const { entryName, nativeEnum } of unreferenced) {
    const candidates = [...input.valueSets]
      .filter(([name, values]) => !claimed.has(name) && sameValues(values, nativeEnum.members))
      .map(([name]) => name);
    const exact = candidates.find((name) => name === entryName);
    const chosen = exact ?? (candidates.length === 1 ? candidates[0] : undefined);
    if (chosen === undefined) {
      unmatched.push({ entryName, nativeEnum });
      continue;
    }
    claimed.add(chosen);
    nameByEntry.set(entryName, chosen);
  }

  const blockNames = new Set(nameByEntry.values());
  for (const { entryName, nativeEnum } of unmatched) {
    const derived = createUniqueFieldName(toEnumName(nativeEnum.typeName).name, blockNames);
    blockNames.add(derived);
    nameByEntry.set(entryName, derived);
  }

  const blocks: PslExtensionBlock[] = [];
  for (const [entryName, nativeEnum] of input.nativeEnums) {
    const { typeName } = nativeEnum;
    const blockName = nameByEntry.get(entryName) ?? typeName;
    blocks.push(buildNativeEnumBlock(blockName, typeName, nativeEnum.members));
    blockNamesByTypeName.set(typeName, blockName);
    blockNamesByTypeName.set(`${input.namespaceId}.${typeName}`, blockName);
  }
  return { blocks, blockNamesByTypeName };
}
