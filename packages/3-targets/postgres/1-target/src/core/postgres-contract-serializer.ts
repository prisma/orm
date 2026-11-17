import type { PreserveEmptyPredicate } from '@internal/contract/hashing';
import { createPreserveEmptyPredicate, type PathPattern } from '@internal/contract/hashing-utils';
import type { Contract } from '@internal/contract/types';
import { SqlContractSerializerBase, type SqlEntityHydrationFactory } from '@internal/family-sql/ir';
import {
  type AuthoringEntityContext,
  type AuthoringEntityTypeFactoryOutput,
  type AuthoringEntityTypeNamespace,
  isAuthoringEntityTypeDescriptor,
} from '@internal/framework-components/authoring';
import { requiredSchemaKeys } from '@internal/framework-components/codec';
import {
  type AnyEntityKindDescriptor,
  type Namespace,
  UNBOUND_NAMESPACE_ID,
} from '@internal/framework-components/ir';
import { sqlContractCanonicalizationHooks } from '@internal/sql-contract/canonicalization-hooks';
import type { SqlNamespaceInput, SqlStorage } from '@internal/sql-contract/types';
import { blindCast } from '@internal/utils/casts';
import { InternalError } from '@internal/utils/internal-error';
import type { JsonObject } from '@internal/utils/json';
import type { Type } from 'arktype';
import { postgresAuthoringEntityTypes } from './authoring';
import { PG_INT_CODEC_ID, PG_TEXT_CODEC_ID } from './codec-ids';
import { createPostgresBuiltinCodecLookup } from './codec-registry';
import { createPostgresBuiltinDataTypeLookup, postgresTextDataTypes } from './data-types';
import {
  extensionEntityKind,
  nativeEnumEntityKind,
  policyEntityKind,
  rlsEnablementEntityKind,
  roleEntityKind,
} from './entity-kinds';
import { postgresError } from './errors';
import { assertFullTextIndexes } from './full-text-index-definition';
import { postgresCodecTraitsOf } from './postgres-codec-traits';
import { PostgresSchema } from './postgres-schema';

const POSTGRES_CODEC_LOOKUP = createPostgresBuiltinCodecLookup();

/** The context entity hydration runs in. Hydration reads stored contract JSON and never a written value, so its data types carry no authoring entries, which keeps the PSL readers out of the runtime. */
const POSTGRES_AUTHORING_CTX: AuthoringEntityContext = {
  family: 'sql',
  target: 'postgres',
  codecLookup: POSTGRES_CODEC_LOOKUP,
  dataTypes: {
    entries: {},
    lookup: createPostgresBuiltinDataTypeLookup(),
    dataTypeOfCodec: (codecId) => POSTGRES_CODEC_LOOKUP.descriptorFor(codecId)?.dataType,
    textDataTypes: postgresTextDataTypes,
  },
  enumInferenceCodecs: { text: PG_TEXT_CODEC_ID, int: PG_INT_CODEC_ID },
};

function isAuthoringEntityTypeFactoryOutput(
  output: unknown,
): output is AuthoringEntityTypeFactoryOutput<unknown, unknown> {
  return (
    typeof output === 'object' &&
    output !== null &&
    'factory' in output &&
    typeof output.factory === 'function'
  );
}

/**
 * Walks a pack's entity-type namespace tree and emits hydration factories
 * keyed by the descriptor's `discriminator`. Used for `storage.types`
 * (codec-triple hydration). Namespace entries hydration dispatches by
 * entries key, not discriminator — handled by `hydrateNamespaceEntities`.
 */
function collectStorageTypesHydrators(
  namespace: AuthoringEntityTypeNamespace,
): ReadonlyMap<string, SqlEntityHydrationFactory> {
  const registry = new Map<string, SqlEntityHydrationFactory>();
  const walk = (node: AuthoringEntityTypeNamespace): void => {
    for (const value of Object.values(node)) {
      if (isAuthoringEntityTypeDescriptor(value)) {
        if (isAuthoringEntityTypeFactoryOutput(value.output)) {
          const { factory } = value.output;
          registry.set(value.discriminator, (raw) => factory(raw, POSTGRES_AUTHORING_CTX));
        }
        continue;
      }
      if (typeof value === 'object' && value !== null) {
        walk(value);
      }
    }
  };
  walk(namespace);
  return registry;
}

/**
 * The canonicalization walk drops a field whose value equals its type's
 * default, which for a required field of an entity kind means the emitted
 * contract fails that kind's own schema on the next read (a RESTRICTIVE
 * policy's `permissive: false` is the live case). The set of fields that must
 * survive is therefore the required keys of the registered entity kinds —
 * read off the schemas rather than listed by hand, so a kind that gains a
 * required field is covered the day it gains one.
 */
function requiredEntityFieldsSurviveDefaults(
  kinds: readonly AnyEntityKindDescriptor[],
): PreserveEmptyPredicate {
  return createPreserveEmptyPredicate(
    kinds.flatMap((kind) =>
      requiredKeysOf(kind.schema).map(
        (key): PathPattern => ['storage', 'namespaces', '*', 'entries', kind.kind, '*', key],
      ),
    ),
  );
}

function requiredKeysOf(schema: Type<unknown>): readonly string[] {
  const keys = requiredSchemaKeys(schema);
  if (keys === undefined) {
    throw new InternalError(
      'entity-kind schema does not expose arktype object props; the required-field preserve set cannot be derived',
    );
  }
  return keys;
}

export class PostgresContractSerializer extends SqlContractSerializerBase<Contract<SqlStorage>> {
  override shouldPreserveEmpty: PreserveEmptyPredicate;

  constructor(extraPackEntityKinds: readonly AnyEntityKindDescriptor[] = []) {
    const storageTypesHydrators = collectStorageTypesHydrators(postgresAuthoringEntityTypes);
    const entityKinds = [
      policyEntityKind,
      roleEntityKind,
      rlsEnablementEntityKind,
      nativeEnumEntityKind,
      extensionEntityKind,
      ...extraPackEntityKinds,
    ];
    super(storageTypesHydrators, entityKinds);
    const preserveRequired = requiredEntityFieldsSurviveDefaults(entityKinds);
    this.shouldPreserveEmpty = (path) =>
      preserveRequired(path) || sqlContractCanonicalizationHooks.shouldPreserveEmpty(path);
  }

  protected override hydrateSqlNamespaceEntry(
    nsId: string,
    raw: Record<string, unknown>,
  ): Namespace | SqlNamespaceInput {
    const hydrated = blindCast<
      SqlNamespaceInput,
      'raw is always plain JSON, so super.hydrateSqlNamespaceEntry returns SqlNamespaceInput'
    >(super.hydrateSqlNamespaceEntry(nsId, raw));
    const { id, entries } = hydrated;

    const allSlotsEmpty = Object.values(entries).every(
      (slot) => slot === undefined || Object.keys(slot).length === 0,
    );
    if (id === UNBOUND_NAMESPACE_ID && allSlotsEmpty) {
      return PostgresSchema.unbound;
    }
    const valueSetSlot = entries['valueSet'];
    const hasValueSets = valueSetSlot !== undefined && Object.keys(valueSetSlot).length > 0;
    const schema = new PostgresSchema({
      id,
      entries: {
        ...entries,
        table: entries['table'] ?? {},
        ...(hasValueSets ? { valueSet: valueSetSlot } : {}),
      },
    });
    for (const table of Object.values(schema.table)) {
      assertFullTextIndexes(table, postgresCodecTraitsOf);
    }
    return schema;
  }

  protected override hydrateSqlStorage(validated: Contract<SqlStorage>): Contract<SqlStorage> {
    const hydrated = super.hydrateSqlStorage(validated);
    assertExtensionsInOneNamespace(hydrated.storage);
    return hydrated;
  }

  override serializeContract(contract: Contract<SqlStorage>): JsonObject {
    const { storage, ...rest } = contract;
    const namespacesJson: Record<string, JsonObject> = {};
    // Each namespace serializes to its id, its schema-kind tag, and the
    // base's generic entries walk — every enumerable kind on
    // `PostgresSchema.entries`, including `native_enum`.
    for (const [nsId, ns] of Object.entries(storage.namespaces)) {
      const isUnboundSlot = ns.id === UNBOUND_NAMESPACE_ID;
      namespacesJson[nsId] = {
        id: ns.id,
        kind: isUnboundSlot ? 'postgres-unbound-schema' : 'postgres-schema',
        entries: this.serializeNamespaceEntries(ns.entries),
      };
    }
    const storageOut: Record<string, unknown> = {
      storageHash: String(storage.storageHash),
      namespaces: namespacesJson,
    };
    if (storage.types !== undefined) {
      const typesOut: Record<string, JsonObject> = {};
      for (const [name, entry] of Object.entries(storage.types)) {
        typesOut[name] = this.serializeJsonObject(entry);
      }
      storageOut['types'] = typesOut;
    }
    return blindCast<
      JsonObject,
      'contract minus storage plus a JSON-shaped storageOut is a JsonObject'
    >({
      ...rest,
      storage: storageOut,
    });
  }
}

function assertExtensionsInOneNamespace(storage: SqlStorage): void {
  const namespacesByExtension = new Map<string, string[]>();
  for (const namespace of Object.values(storage.namespaces)) {
    if (!(namespace instanceof PostgresSchema)) continue;
    for (const name of Object.keys(namespace.extension)) {
      namespacesByExtension.set(name, [...(namespacesByExtension.get(name) ?? []), namespace.id]);
    }
  }
  for (const [name, namespaceIds] of namespacesByExtension) {
    if (namespaceIds.length < 2) continue;
    const namespaces = [...namespaceIds].sort();
    throw postgresError(
      'CONTRACT.NAME_DUPLICATE',
      `Extension "${name}" is declared in namespaces ${namespaces.map((id) => `"${id}"`).join(' and ')}. An extension's name is unique in the database, so a contract declares it in one namespace only.`,
      {
        fix: 'Re-emit the contract from its source, which refuses one extension declared in two namespaces.',
        meta: { kind: 'extension', name, namespaces },
      },
    );
  }
}
