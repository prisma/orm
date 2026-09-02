import { ContractValidationError } from '@internal/contract/contract-validation-error';
import { isPlainRecord } from '@internal/contract/is-plain-record';
import type { Contract } from '@internal/contract/types';
import type { ContractSerializer } from '@internal/framework-components/control';
import {
  type AnyEntityKindDescriptor,
  hydrateNamespaceEntities,
  type Namespace,
} from '@internal/framework-components/ir';
import { sqlContractCanonicalizationHooks } from '@internal/sql-contract/canonicalization-hooks';
import { composeSqlEntityKinds } from '@internal/sql-contract/entity-kinds';
import {
  isMaterializedSqlNamespace,
  type SqlNamespaceInput,
  SqlStorage,
  type SqlStorageInput,
  type SqlStorageTypeEntry,
} from '@internal/sql-contract/types';
import {
  createSqlContractSchema,
  validateSqlContractFully,
} from '@internal/sql-contract/validators';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import type { JsonObject, JsonValue } from '@internal/utils/json';
import { type Type, type } from 'arktype';
import { sqlFamilyError } from '../errors';

const NamespaceRawSchema = type({
  id: 'string',
  'kind?': 'string',
  entries: type({
    '+': 'ignore',
  }),
});

export type SqlEntityHydrationFactory = (entry: unknown) => unknown;

/**
 * SQL family `ContractSerializer` abstract base. Carries the SQL-shared
 * deserialization pipeline:
 *
 * 1. `parseSqlContractStructure` validates the on-disk JSON envelope
 *    against the SQL contract arktype schema (`validateSqlContractFully`)
 *    and returns the validated flat-data shape.
 * 2. `hydrateSqlStorage` walks the validated `storage` subtree and
 *    constructs the family-shared SQL Contract IR class hierarchy
 *    (`SqlStorage` -> `StorageTable` -> `StorageColumn` / `PrimaryKey`
 *    / …). The rest of the contract envelope is JSON-clean primitive
 *    data and passes through unchanged.
 * 3. `constructTargetContract` is the target-specific extension hook;
 *    defaults to identity. Targets that need to attach target-only
 *    fields (e.g. target-specific derived storage fields) override it.
 *
 * Default `serializeContract` is identity over the contract — concrete
 * SQL targets ship JSON-clean class instances, so the contract value
 * can be stringified directly. The non-enumerable family-level `kind`
 * discriminator on `SqlNode` instances stays out of the persisted
 * envelope automatically. Targets that need to canonicalize on the way
 * out (key ordering, dropping computed-only fields) override
 * `serializeContract` directly.
 */
export abstract class SqlContractSerializerBase<TContract extends Contract<SqlStorage>>
  implements ContractSerializer<TContract>
{
  private readonly contractSchema: Type<unknown> | undefined;
  private readonly entryKinds: ReadonlyMap<string, AnyEntityKindDescriptor>;

  constructor(
    protected readonly entityHydrationRegistry: ReadonlyMap<
      string,
      SqlEntityHydrationFactory
    > = new Map(),
    packEntityKinds: readonly AnyEntityKindDescriptor[] = [],
  ) {
    this.entryKinds = composeSqlEntityKinds(packEntityKinds);
    this.contractSchema =
      packEntityKinds.length > 0 ? createSqlContractSchema(this.entryKinds) : undefined;
  }

  deserializeContract<T extends TContract = TContract>(json: unknown): T {
    const validated = this.parseSqlContractStructure(json);
    const hydrated = this.hydrateSqlStorage(validated);
    return this.constructTargetContract(hydrated) as T;
  }

  serializeContract(contract: TContract): JsonObject {
    return contract as unknown as JsonObject;
  }

  shouldPreserveEmpty = sqlContractCanonicalizationHooks.shouldPreserveEmpty;

  sortStorage = sqlContractCanonicalizationHooks.sortStorage;

  hashCanonicalizationHooks = sqlContractCanonicalizationHooks;

  protected parseSqlContractStructure(json: unknown): Contract<SqlStorage> {
    return validateSqlContractFully<Contract<SqlStorage>>(
      json,
      this.contractSchema !== undefined ? { contractSchema: this.contractSchema } : undefined,
    );
  }

  protected hydrateSqlStorage(validated: Contract<SqlStorage>): Contract<SqlStorage> {
    const types = validated.storage.types;
    const hydratedTypes =
      types !== undefined
        ? Object.fromEntries(
            Object.entries(types).map(([name, entry]) => [
              name,
              this.hydrateStorageTypeEntry(entry),
            ]),
          )
        : undefined;

    const rawNamespaces = validated.storage.namespaces;
    if (rawNamespaces === undefined) {
      throw new ContractValidationError(
        'Contract storage.namespaces is required after structural validation',
        'structural',
      );
    }
    const hydratedNamespaces = this.hydrateSqlNamespaceMap(
      blindCast<
        Readonly<Record<string, Record<string, unknown>>>,
        'parseSqlContractStructure validated raw JSON; namespace entries are plain objects, not SqlNamespace instances.'
      >(rawNamespaces),
    );

    return {
      ...validated,
      storage: new SqlStorage({
        storageHash: validated.storage.storageHash,
        ...ifDefined('types', hydratedTypes),
        namespaces: blindCast<
          SqlStorageInput['namespaces'],
          'hydrateSqlNamespaceMap builds each namespace through the target serializer override, so every value is a SqlNamespace; the framework return type only promises the base Namespace.'
        >(hydratedNamespaces),
      }),
    };
  }

  protected hydrateSqlNamespaceMap(
    namespaces: Readonly<Record<string, Record<string, unknown>>>,
  ): Readonly<Record<string, Namespace>> {
    return Object.fromEntries(
      Object.entries(namespaces).map(([nsId, namespaceEntryRaw]) => {
        const namespaceHydrated = this.hydrateSqlNamespaceEntry(nsId, namespaceEntryRaw);
        if (!isMaterializedSqlNamespace(namespaceHydrated)) {
          throw sqlFamilyError(
            'CONTRACT.PACK_CONTRIBUTION_INVALID',
            `Target serializer bug: hydrateSqlNamespaceEntry for namespace "${nsId}" returned a non-NamespaceBase value. Override hydrateSqlNamespaceEntry to produce a target namespace concretion.`,
            {
              why: 'The target contract serializer hydrated a namespace into a value that is not a materialized namespace concretion.',
              fix: 'Fix the target package: its hydrateSqlNamespaceEntry override must return a target namespace concretion.',
              meta: { namespaceId: nsId },
            },
          );
        }
        return [nsId, namespaceHydrated];
      }),
    );
  }

  protected hydrateSqlNamespaceEntry(
    nsId: string,
    raw: Record<string, unknown>,
  ): Namespace | SqlNamespaceInput {
    const id = typeof raw['id'] === 'string' ? raw['id'] : nsId;
    const parsed = NamespaceRawSchema({ ...raw, id });
    if (parsed instanceof type.errors) {
      const messages = parsed.map((p: { message: string }) => p.message).join('; ');
      throw new ContractValidationError(`Namespace hydration failed: ${messages}`, 'structural');
    }
    const entriesRaw = parsed.entries;
    const rawEntriesMap = isPlainRecord(entriesRaw) ? entriesRaw : {};

    const entriesInput: Record<string, Readonly<Record<string, unknown>>> = {};
    for (const [key, innerMap] of Object.entries(rawEntriesMap)) {
      entriesInput[key] = isPlainRecord(innerMap) ? innerMap : Object.freeze({});
    }

    const entriesOutput = hydrateNamespaceEntities(entriesInput, this.entryKinds, 'fail', id);

    // Always ensure a 'table' key is present (may be empty).
    if (!Object.hasOwn(entriesOutput, 'table')) {
      entriesOutput['table'] = {};
    }

    return blindCast<
      SqlNamespaceInput,
      'entriesOutput holds the hydrated SQL entity-kind maps (table always present); this wraps them as the SqlNamespaceInput the target createNamespace consumes.'
    >({
      id,
      entries: entriesOutput,
    });
  }

  protected hydrateStorageTypeEntry(entry: SqlStorageTypeEntry): SqlStorageTypeEntry {
    if (typeof entry !== 'object' || entry === null) {
      return entry;
    }
    const kind = (entry as { kind?: unknown }).kind;
    if (typeof kind !== 'string') {
      return entry;
    }
    const factory = this.entityHydrationRegistry.get(kind);
    if (factory === undefined) {
      return entry;
    }
    return blindCast<
      SqlStorageTypeEntry,
      'entity registry factory returns SqlStorageTypeEntry for storage.types entries'
    >(factory(entry));
  }

  protected constructTargetContract(hydrated: Contract<SqlStorage>): TContract {
    return hydrated as TContract;
  }

  /**
   * Serializes a namespace's `entries` dict by walking every enumerable
   * kind — no kind is named here, mirroring the generic hydrate walk in
   * `hydrateSqlNamespaceEntry` above. `table` is the SQL family's one
   * universal base kind (every namespace carries it), so it is always
   * emitted, even when empty; every other kind — target- or
   * pack-contributed — is emitted only when it holds at least one entry.
   * A kind carried non-enumerable on `entries` is excluded here for free,
   * since `Object.entries` honors enumerability.
   */
  protected serializeNamespaceEntries(
    entries: Readonly<Record<string, Readonly<Record<string, unknown>>>>,
  ): Record<string, Record<string, JsonObject>> {
    const out: Record<string, Record<string, JsonObject>> = {
      table: this.serializeEntries(entries['table'] ?? {}),
    };
    for (const [kind, record] of Object.entries(entries)) {
      if (kind === 'table' || record == null || Object.keys(record).length === 0) {
        continue;
      }
      out[kind] = this.serializeEntries(record);
    }
    return out;
  }

  private serializeEntries(entries: Readonly<Record<string, unknown>>): Record<string, JsonObject> {
    const out: Record<string, JsonObject> = {};
    for (const [name, entry] of Object.entries(entries)) {
      out[name] = this.serializeJsonObject(entry);
    }
    return out;
  }

  protected serializeJsonObject(value: unknown): JsonObject {
    return blindCast<
      JsonObject,
      'serializeJsonValue round-trips an IR node through JSON, yielding a JsonObject'
    >(this.serializeJsonValue(value));
  }

  private serializeJsonValue(value: unknown): JsonValue {
    return blindCast<JsonValue, 'JSON.parse(JSON.stringify(x)) yields a JsonValue'>(
      JSON.parse(JSON.stringify(value)),
    );
  }
}
