import {
  asNamespaceId,
  type ContractField,
  type ContractModel,
  type EntityCoordinate,
  valueObjectsWithCoordinates,
} from '@internal/contract/types';
import type { ModelCoordinate } from '@internal/framework-components/control';
import {
  collectionOfModel,
  embeddingModelOf,
  isEmbedRelation,
  type MongoContract,
  type MongoModelStorage,
  modelKey,
  mongoModelsOf,
  ownEmbedStoredNamesOf,
  ownStoredNamesOf,
  recursiveGroupsOf,
  type SelectedVariant,
  selectedVariantOf,
  valueObjectKey,
  valueObjectStoredNamesOf,
} from '@internal/mongo-contract';
import { notOk, ok, type Result } from '@internal/utils/result';
import type { JsonPathStep } from './stored-key-path';

export type ValueObjectRef = EntityCoordinate<'storage', 'valueObject'>;

/** A type whose objects documents hold below their top level: a value object, or an embedded model. */
export type StoredType =
  | { readonly kind: 'valueObject'; readonly valueObject: ValueObjectRef }
  | { readonly kind: 'embeddedModel'; readonly model: ModelCoordinate };

/** A place documents hold objects of a type: a root field of a collection, and the steps from its value to each object. */
export interface StoredPlace {
  readonly collection: string;
  /** The stored name of the root field. */
  readonly field: string;
  readonly steps: readonly JsonPathStep[];
  /** The root model or variant whose documents hold the field. */
  readonly model: ModelCoordinate;
  /** The variant whose documents hold the field; `undefined` for a root model's documents. */
  readonly variant: SelectedVariant | undefined;
}

/** Why the plan cannot list the paths from a root field to a type's objects. */
export type UnlistedReach =
  | { readonly kind: 'containsItself'; readonly type: string }
  | { readonly kind: 'union' | 'dictionary' };

/** A root field whose objects of a type the plan cannot list, and why. */
export interface UnlistedPlace {
  readonly collection: string;
  readonly model: ModelCoordinate;
  /** The stored name of the root field. */
  readonly field: string;
  readonly reach: UnlistedReach;
}

/** A field of an object, by its stored name: a value object, or a union or dictionary of them, or an embed relation. */
interface Member {
  readonly storedName: string;
  readonly many: boolean;
  /** The type it holds; `undefined` for a scalar. */
  readonly holds: string | undefined;
  /** The types a union or a dictionary holds, which the plan lists no paths through. */
  readonly unlisted:
    | { readonly kind: 'union' | 'dictionary'; readonly types: readonly string[] }
    | undefined;
}

/** A type a document holds below its top level: its name, and its members. */
interface Node {
  readonly name: string;
  readonly members: readonly Member[];
}

function isMany(many: ContractField['many']): boolean {
  return many !== undefined && many !== false;
}

function fieldMember(storedName: string, field: ContractField): Member {
  const { type } = field;
  if (type.kind === 'union') {
    const types = type.members.flatMap((member) =>
      member.kind === 'valueObject' ? [valueObjectKey(member)] : [],
    );
    return {
      storedName,
      many: isMany(field.many),
      holds: undefined,
      unlisted: { kind: 'union', types },
    };
  }
  if (type.kind !== 'valueObject') {
    return { storedName, many: false, holds: undefined, unlisted: undefined };
  }
  if (field.dict === true) {
    return {
      storedName,
      many: false,
      holds: undefined,
      unlisted: { kind: 'dictionary', types: [valueObjectKey(type)] },
    };
  }
  return { storedName, many: isMany(field.many), holds: valueObjectKey(type), unlisted: undefined };
}

function membersOf(
  fields: Readonly<Record<string, ContractField>>,
  storedNames: Readonly<Record<string, string>>,
): readonly Member[] {
  return Object.entries(fields).flatMap(([name, field]) => {
    const storedName = storedNames[name];
    return storedName === undefined ? [] : [fieldMember(storedName, field)];
  });
}

function modelMembers(model: ContractModel<MongoModelStorage>): readonly Member[] {
  const embedStoredNames = ownEmbedStoredNamesOf(model);
  return [
    ...membersOf(model.fields, ownStoredNamesOf(model)),
    ...Object.entries(model.relations).flatMap(([name, relation]): Member[] => {
      const storedName = embedStoredNames[name];
      return isEmbedRelation(relation) && storedName !== undefined
        ? [
            {
              storedName,
              many: relation.cardinality === '1:N',
              holds: modelKey(relation.to.model),
              unlisted: undefined,
            },
          ]
        : [];
    }),
  ];
}

type Paths = Result<readonly (readonly JsonPathStep[])[], UnlistedReach>;

/** The walk over one namespace's models and the value objects their documents hold. */
class PlaceWalk {
  readonly #nodes = new Map<string, Node>();
  readonly #groups: ReadonlyMap<string, number>;
  readonly #target: string;

  constructor(
    contract: MongoContract,
    models: Readonly<Record<string, ContractModel<MongoModelStorage>>>,
    target: string,
  ) {
    this.#target = target;
    this.#groups = recursiveGroupsOf(contract.storage, models);
    for (const { coordinate, valueObject } of valueObjectsWithCoordinates(contract.storage)) {
      this.#nodes.set(valueObjectKey(coordinate), {
        name: coordinate.entityName,
        members: membersOf(valueObject.fields, valueObjectStoredNamesOf(valueObject)),
      });
    }
    for (const [name, model] of Object.entries(models)) {
      this.#nodes.set(modelKey(name), { name, members: modelMembers(model) });
    }
  }

  /** Whether an object of type `key` is, or holds at any depth, an object of the target type. */
  #reaches(key: string): boolean {
    const seen = new Set<string>();
    const pending = [key];
    for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
      if (next === this.#target) return true;
      if (seen.has(next)) continue;
      seen.add(next);
      for (const member of this.#nodes.get(next)?.members ?? []) {
        if (member.holds !== undefined) pending.push(member.holds);
        pending.push(...(member.unlisted?.types ?? []));
      }
    }
    return false;
  }

  /** The paths from an object with `members`, reached by `steps`, to each object of the target type below it. */
  #pathsBelow(members: readonly Member[], steps: readonly JsonPathStep[]): Paths {
    const paths: (readonly JsonPathStep[])[] = [];
    for (const member of members) {
      const found = this.#pathsOfMember(member, steps);
      if (!found.ok) return found;
      paths.push(...found.value);
    }
    return ok(paths);
  }

  #pathsOfMember(member: Member, steps: readonly JsonPathStep[]): Paths {
    if (member.unlisted !== undefined) {
      return member.unlisted.types.some((type) => this.#reaches(type))
        ? notOk({ kind: member.unlisted.kind })
        : ok([]);
    }
    const { holds } = member;
    if (holds === undefined) return ok([]);
    if (this.#groups.has(holds)) {
      return this.#reaches(holds)
        ? notOk({ kind: 'containsItself', type: this.#nodes.get(holds)?.name ?? holds })
        : ok([]);
    }
    const memberSteps: readonly JsonPathStep[] = [
      ...steps,
      { kind: 'member', name: member.storedName },
      ...(member.many ? [{ kind: 'wildcard' } as const] : []),
    ];
    const own = holds === this.#target ? [memberSteps] : [];
    const nested = this.#pathsBelow(this.#nodes.get(holds)?.members ?? [], memberSteps);
    return nested.ok ? ok([...own, ...nested.value]) : nested;
  }

  /** The places the documents of a root model or variant hold objects of the target type in its own fields and embed relations. */
  placesOf(
    model: ContractModel<MongoModelStorage>,
    root: Pick<StoredPlace, 'collection' | 'model' | 'variant'>,
  ): Result<readonly StoredPlace[], UnlistedPlace> {
    const places: StoredPlace[] = [];
    for (const member of modelMembers(model)) {
      const found = this.#pathsOfMember(member, []);
      if (!found.ok) return notOk({ ...root, field: member.storedName, reach: found.failure });
      places.push(
        ...found.value.map((steps) => ({
          ...root,
          field: member.storedName,
          steps: steps.slice(1),
        })),
      );
    }
    return ok(places);
  }
}

function targetKey(type: StoredType): string {
  return type.kind === 'valueObject'
    ? valueObjectKey(type.valueObject)
    : modelKey(type.model.model);
}

/**
 * Finds every place a contract's documents hold objects of a value object or an embedded model: for each root field of a root model or variant, the steps from the field's value to each object, through value object fields, embed relations (a list step for a list) and variants, at any depth. Steps use stored names. A root field that holds the type through a value object or embedded model that contains itself, a union or a dictionary has no list of paths, and is the failure.
 */
export function storedPlacesOf(
  contract: MongoContract,
): (type: StoredType) => Result<readonly StoredPlace[], UnlistedPlace> {
  return (type) => {
    const target = targetKey(type);
    const places: StoredPlace[] = [];
    for (const namespaceId of Object.keys(contract.domain.namespaces)) {
      const models = mongoModelsOf(contract.domain, namespaceId);
      const walk = new PlaceWalk(contract, models, target);
      for (const [name, model] of Object.entries(models)) {
        const coordinate = { namespaceId: asNamespaceId(namespaceId), model: name };
        if (embeddingModelOf(contract.domain, coordinate) !== undefined) continue;
        const collection = collectionOfModel(contract.domain, coordinate);
        if (collection === undefined) continue;
        const found = walk.placesOf(model, {
          collection,
          model: coordinate,
          variant: selectedVariantOf(contract.domain, coordinate),
        });
        if (!found.ok) return found;
        places.push(...found.value);
      }
    }
    return ok(places);
  };
}
