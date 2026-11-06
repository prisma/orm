import {
  type ContractField,
  type EntityCoordinate,
  type StorageBase,
  valueObjectsWithCoordinates,
} from '@internal/contract/types';
import type { ValidatorModel } from './derive-json-schema';
import { isEmbedRelation } from './relation-fields';

export function modelKey(name: string): string {
  return `model:${name}`;
}

/** The key of a value object, by its storage coordinate, so value objects of one name in two namespaces stay apart. */
export function valueObjectKey(reference: EntityCoordinate<'storage', 'valueObject'>): string {
  return `valueObject:${JSON.stringify([reference.namespaceId, reference.entityName])}`;
}

function referencesOf(fields: Record<string, ContractField>): string[] {
  return Object.values(fields).flatMap((field) =>
    field.type.kind === 'valueObject' ? [valueObjectKey(field.type)] : [],
  );
}

/**
 * The recursive groups of value objects and embedded models: each set of types that can reach each other through value-object fields and embed relations (a strongly connected component of that graph), and each type that refers to itself. Maps the {@link valueObjectKey} or {@link modelKey} of every type in such a group to the group's number; a type in no recursive group is absent.
 */
export function recursiveGroupsOf(
  storage: Pick<StorageBase, 'namespaces'>,
  models: Record<string, Pick<ValidatorModel, 'fields' | 'relations'>>,
): ReadonlyMap<string, number> {
  const edges = new Map<string, readonly string[]>();
  for (const { coordinate, valueObject } of valueObjectsWithCoordinates(storage)) {
    edges.set(valueObjectKey(coordinate), referencesOf(valueObject.fields));
  }
  for (const [name, model] of Object.entries(models)) {
    const embeds = Object.values(model.relations).flatMap((relation) =>
      isEmbedRelation(relation) ? [modelKey(relation.to.model)] : [],
    );
    edges.set(modelKey(name), [...referencesOf(model.fields), ...embeds]);
  }

  const groups = new Map<string, number>();
  const index = new Map<string, number>();
  const lowLink = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  let nextIndex = 0;
  let nextGroup = 0;

  const visit = (node: string): void => {
    index.set(node, nextIndex);
    lowLink.set(node, nextIndex);
    nextIndex++;
    stack.push(node);
    onStack.add(node);

    for (const target of edges.get(node) ?? []) {
      if (!edges.has(target)) continue;
      if (!index.has(target)) {
        visit(target);
        lowLink.set(node, Math.min(lowLink.get(node) ?? 0, lowLink.get(target) ?? 0));
      } else if (onStack.has(target)) {
        lowLink.set(node, Math.min(lowLink.get(node) ?? 0, index.get(target) ?? 0));
      }
    }

    if (lowLink.get(node) !== index.get(node)) return;
    const members: string[] = [];
    let member: string | undefined;
    do {
      member = stack.pop();
      if (member === undefined) break;
      onStack.delete(member);
      members.push(member);
    } while (member !== node);

    const refersToItself = (edges.get(node) ?? []).includes(node);
    if (members.length > 1 || refersToItself) {
      for (const each of members) groups.set(each, nextGroup);
      nextGroup++;
    }
  };

  for (const node of edges.keys()) {
    if (!index.has(node)) visit(node);
  }
  return groups;
}
