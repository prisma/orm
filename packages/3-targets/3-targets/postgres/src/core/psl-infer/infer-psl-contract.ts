import type { SqlDescribedContractSpace } from '@internal/family-sql/control';
import type { EnumInfo, PslPrinterOptions } from '@internal/family-sql/psl-infer';
import {
  inferRelations,
  parseRawDefault,
  toEnumName,
  toModelName,
} from '@internal/family-sql/psl-infer';
import { coordinateKey } from '@internal/framework-components/ir';
import type {
  PslDocumentAst,
  PslExtensionBlock,
  PslModel,
  PslNamespace,
} from '@internal/framework-components/psl-ast';
import {
  makePslNamespace,
  makePslNamespaceEntries,
  UNSPECIFIED_PSL_NAMESPACE_ID,
} from '@internal/framework-components/psl-ast';
import { SqlSchemaIR, SqlTableIR } from '@internal/sql-schema-ir/types';
import { postgresError } from '../errors';
import type { PostgresDatabaseSchemaNode } from '../schema-ir/postgres-database-schema-node';
import type { PostgresPolicySchemaNode } from '../schema-ir/postgres-policy-schema-node';
import {
  buildNativeEnumBlocks,
  buildRecoveredEnumBlock,
  PSL_SCALAR_TYPE_NAMES,
} from './infer-enum-blocks';
import {
  describedContractOwners,
  type ForeignKeyResolution,
  resolveForeignKeys,
} from './infer-foreign-keys';
import type { RecoveredEnumField } from './infer-model-blocks';
import { buildModel } from './infer-model-blocks';
import {
  buildFieldNamesByTable,
  buildTopLevelNameMap,
  createUniqueFieldName,
  topologicalSort,
} from './infer-names';
import { buildPolicyBlocks } from './infer-policy-blocks';
import { createPostgresDefaultMapping } from './postgres-default-mapping';
import { createPostgresTypeMap } from './postgres-type-map';
import { SYNTHETIC_SPAN } from './psl-literals';
import { recoverDomainEnumColumns } from './recover-domain-enums';

/**
 * Infers a PSL AST (for `printPsl`) from an introspected Postgres schema tree.
 *
 * Target-owned inference: it walks the `PostgresDatabaseSchemaNode` tree and
 * owns the Postgres dialect knowledge — the native type map and default map.
 * Relation inference, name transforms, generic default mapping, and raw-default
 * parsing are shape-neutral utilities imported from the SQL family.
 *
 * The tree's tables (across its namespaces — `contract infer` introspects a
 * single live namespace) are gathered into the model set and emitted in one
 * bucket, alongside native-enum and RLS policy blocks. That bucket is named
 * after the introspected schema when the content needs a `namespace { … }`
 * wrap, and is the flat `UNSPECIFIED_PSL_NAMESPACE_ID` bucket otherwise. This
 * entry point emits nothing else, so its output is always exactly one bucket
 * and byte-identical to the prior flat inference. {@link buildPslDocumentAst}
 * can emit a second, always-flat bucket for content that must stay top-level
 * even under a wrap; no caller asks for one yet.
 *
 * `describedContracts` — the stack's extension packs' already-assembled
 * contracts, each paired with its space id — is consulted while gathering
 * tables: a table whose coordinate `(schemaName, 'table', tableName)` one of
 * those contracts already declares is omitted, before the duplicate-name
 * check below and before relation inference, so it cannot spuriously
 * collide with an app table and never contributes a bare relation field. A
 * surviving table's foreign key into an omitted, pack-owned table is not
 * dropped: {@link resolveForeignKeys} rewrites it into a relation qualified
 * with the pack's space id (`<spaceId>:<namespaceId>.<Model>`) instead.
 */
export function inferPostgresPslContract(
  tree: PostgresDatabaseSchemaNode,
  describedContracts?: readonly SqlDescribedContractSpace[],
): PslDocumentAst {
  const namespaces = Object.values(tree.namespaces);
  const owners = describedContractOwners(describedContracts ?? []);

  // Native enum adoption: each namespace's introspected `enums` nodes become
  // `native_enum` blocks + `pg.enum(<Name>)` columns, minus the types a
  // described pack contract already declares (resolved through the same
  // `owners` / `describedContractOwners` coordinate map as table subtraction —
  // `elementCoordinates` keys `entries.native_enum` by physical type name, no
  // enum-specific index). An inferred block carries no explicit `control` and
  // inherits the contract's `defaultControl`; under `defaultControl: 'managed'`
  // the planner owns the type's create/drop lifecycle and `db verify` reports
  // member drift (#949). A suffix-appended member plans `ALTER TYPE ... ADD
  // VALUE`; any other member change (rename, removal, reorder) is refused
  // with a named diagnostic — see `docs/reference/postgres-native-enums.md`.
  const enumDefinitions = new Map<string, readonly string[]>();
  const packOwnedEnumTypesByNamespace = new Map<string, Map<string, string>>();
  const enumNamespaceNames = new Set<string>();
  for (const namespace of namespaces) {
    for (const { typeName, members } of namespace.nativeEnums) {
      const owner = owners.get(
        coordinateKey({
          namespaceId: namespace.schemaName,
          entityKind: 'native_enum',
          entityName: typeName,
        }),
      );
      if (owner !== undefined) {
        const owned = packOwnedEnumTypesByNamespace.get(namespace.schemaName) ?? new Map();
        // Columns reference the type either bare or schema-qualified —
        // `format_type` qualifies a type outside the connection's
        // search_path — so both spellings are owned.
        owned.set(typeName, owner.spaceId);
        owned.set(`${namespace.schemaName}.${typeName}`, owner.spaceId);
        packOwnedEnumTypesByNamespace.set(namespace.schemaName, owned);
        continue;
      }
      enumDefinitions.set(typeName, members);
      enumNamespaceNames.add(namespace.schemaName);
    }
  }

  // Stopgap (TML-2958): flatten the schema-IR *tree* into the single `{ tables }`
  // map the PSL writer expects. The writer still walks a flat table map, so this
  // is a read-only projection — it does not reintroduce a stored flat schema.
  // The real fix is to extend the PSL writer to walk the namespace tree and emit
  // per-namespace `namespace { … }` blocks; until then `contract infer` handles a
  // single introspected namespace, and a same-named table in two schemas has no
  // unambiguous single-bucket model, so we throw rather than silently drop one.
  const tables: Record<string, SqlTableIR> = {};
  const tableNamespaceNames = new Set<string>();
  const rlsEnabledTables = new Set<string>();
  const policiesByTable = new Map<string, readonly PostgresPolicySchemaNode[]>();
  for (const namespace of namespaces) {
    const ownedEnumTypes = packOwnedEnumTypesByNamespace.get(namespace.schemaName);
    for (const [tableName, table] of Object.entries(namespace.tables)) {
      if (
        owners.has(
          coordinateKey({
            namespaceId: namespace.schemaName,
            entityKind: 'table',
            entityName: tableName,
          }),
        )
      ) {
        continue;
      }
      if (tables[tableName] !== undefined) {
        throw postgresError(
          'CONTRACT.INFER_UNSUPPORTED',
          `contract infer: duplicate table name "${tableName}" across schemas is not yet supported ` +
            '(single-namespace PSL inference emits one flat bucket; multi-namespace `namespace { … }` ' +
            'output is a later slice).',
          { meta: { tableName } },
        );
      }
      if (ownedEnumTypes !== undefined) {
        for (const column of Object.values(table.columns)) {
          const owningSpaceId = ownedEnumTypes.get(column.nativeType);
          if (owningSpaceId !== undefined) {
            throw postgresError(
              'CONTRACT.INFER_UNSUPPORTED',
              `contract infer: column "${tableName}"."${column.name}" is typed by native enum ` +
                `type "${column.nativeType}", which extension pack space "${owningSpaceId}" ` +
                'already describes. A cross-space enum-typed column has no authorable PSL form ' +
                "yet; describe the table in that pack's contract or retype the column before " +
                're-running contract infer.',
              { meta: { tableName, columnName: column.name } },
            );
          }
        }
      }
      tables[tableName] = new SqlTableIR(table);
      tableNamespaceNames.add(namespace.schemaName);
      if (table.rlsEnabled) {
        rlsEnabledTables.add(tableName);
      }
      if (table.policies.length > 0) {
        policiesByTable.set(tableName, table.policies);
      }
    }
  }

  // Namespace wrap (pinned during shaping): a `native_enum` block only lowers
  // inside an explicit `namespace { … }` block — the interpreter skips
  // extension entities in the unspecified top-level bucket — so enum-bearing
  // output wraps everything in the introspected schema's name; policy blocks
  // wrap for the same reason. Block-free output stays flat and byte-identical
  // to the prior inference.
  let wrapNamespaceName: string | undefined;
  if (enumDefinitions.size > 0 || policiesByTable.size > 0) {
    const contentNamespaces = new Set([...enumNamespaceNames, ...tableNamespaceNames]);
    if (contentNamespaces.size > 1) {
      // Hard failure is the stated choice for BOTH triggers (enums and RLS
      // policies): namespaced content requires the namespace wrap, and a
      // partial emit (policies silently dropped) would under-describe the
      // database — the property this inference exists to guarantee.
      throw postgresError(
        'CONTRACT.INFER_UNSUPPORTED',
        'contract infer: adopting native enums or RLS policies with content across multiple ' +
          'schemas is not yet supported (single-namespace PSL inference emits one ' +
          '`namespace { … }` block; multi-namespace output is a later slice). Schemas: ' +
          `${[...contentNamespaces].sort().join(', ')}.`,
        { meta: { schemas: [...contentNamespaces].sort() } },
      );
    }
    wrapNamespaceName = [...contentNamespaces][0];
  }

  const {
    tables: resolvedTables,
    extraRelationsByTable,
    crossSpaceFieldNamesByTable,
    danglingForeignKeysByTable,
  } = resolveForeignKeys(tables, owners);
  const schemaIR = new SqlSchemaIR({ tables: resolvedTables });

  // Live introspection reports an enum column's nativeType schema-qualified
  // whenever the type sits outside the connection's search_path (`format_type`
  // semantics; e.g. `auth.aal_level`), while `pg_type.typname` — the
  // definitions key — is always bare. Register the qualified spelling as an
  // alias so those columns resolve; block emission stays keyed on the bare
  // name (one block per type).
  const enumTypeNames = new Set(enumDefinitions.keys());
  if (wrapNamespaceName !== undefined) {
    for (const typeName of enumDefinitions.keys()) {
      enumTypeNames.add(`${wrapNamespaceName}.${typeName}`);
    }
  }
  const enumInfo: EnumInfo = {
    typeNames: enumTypeNames,
    definitions: enumDefinitions,
  };
  const options: PslPrinterOptions = {
    typeMap: createPostgresTypeMap(enumInfo.typeNames),
    defaultMapping: createPostgresDefaultMapping(),
    parseRawDefault,
    ...(enumDefinitions.size > 0 ? { enumInfo } : {}),
  };

  return buildPslDocumentAst(
    schemaIR,
    options,
    {
      extraRelationsByTable,
      crossSpaceFieldNamesByTable,
      danglingForeignKeysByTable,
    },
    wrapNamespaceName,
    { rlsEnabledTables, policiesByTable },
  );
}

/** Per-table RLS emission inputs collected from the Postgres schema tree. */
export interface RlsEmissionExtras {
  readonly rlsEnabledTables: ReadonlySet<string>;
  readonly policiesByTable: ReadonlyMap<string, readonly PostgresPolicySchemaNode[]>;
}

/**
 * Builds the PSL document for one introspected schema.
 *
 * `namespaceName` wraps the output in `namespace <name> { … }`; omit it for
 * flat output. `topLevelExtensionBlocks` are declarations that must stay
 * top-level even when a wrap applies, such as a recovered domain enum — a
 * family `enum` inside a namespace is a hard diagnostic. They land in their
 * own always-flat bucket when a wrap applies, and in the single flat bucket
 * when none does; either way they print unwrapped.
 *
 * Their names are reserved before the policy blocks are built, so a policy
 * renames itself out of the way. Against the rest of the top-level scope — the
 * models, the native enums, PSL's scalar type names, and the other blocks in
 * the list — a clash throws instead: a block's name is its contract key
 * (`entries.valueSet[name]`, with no `@@map` escape), so it cannot be rewritten
 * here.
 */
export function buildPslDocumentAst(
  schemaIR: SqlSchemaIR,
  options: PslPrinterOptions,
  foreignKeyExtras: Pick<
    ForeignKeyResolution,
    'extraRelationsByTable' | 'crossSpaceFieldNamesByTable' | 'danglingForeignKeysByTable'
  >,
  namespaceName?: string,
  rlsExtras?: RlsEmissionExtras,
  topLevelExtensionBlocks: readonly PslExtensionBlock[] = [],
): PslDocumentAst {
  const { typeMap, defaultMapping, parseRawDefault: rawDefaultParser } = options;
  const { extraRelationsByTable, crossSpaceFieldNamesByTable, danglingForeignKeysByTable } =
    foreignKeyExtras;

  const modelNames = buildTopLevelNameMap(
    Object.keys(schemaIR.tables),
    toModelName,
    'model',
    'table',
  );

  const modelNameMap = new Map(
    [...modelNames].map(([tableName, result]) => [tableName, result.name]),
  );

  const { enumNameMap: bareEnumNameMap, enumBlocks } = buildNativeEnumBlocks(
    options.enumInfo?.definitions ?? new Map(),
    modelNames,
  );

  // Columns reference an enum type bare or schema-qualified (`format_type`
  // qualifies types outside the search_path); alias the qualified spelling
  // onto the same PSL name. Blocks stay keyed on the bare name.
  const enumNameMap = new Map(bareEnumNameMap);
  if (namespaceName !== undefined) {
    for (const [typeName, pslName] of bareEnumNameMap) {
      enumNameMap.set(`${namespaceName}.${typeName}`, pslName);
    }
  }

  // Cross-space entries are seeded first so a real local table of the same
  // bare name (an existing single-namespace-flat-bucket limitation, not new
  // here) always wins the merge, matching `resolveForeignKeys`'s own
  // precedence: a surviving local table is never treated as cross-space.
  const fieldNamesByTable = new Map([
    ...crossSpaceFieldNamesByTable,
    ...buildFieldNamesByTable(schemaIR.tables),
  ]);
  const { relationsByTable } = inferRelations(schemaIR.tables, modelNameMap);

  // A caller's block shares one top-level name scope with the models, the
  // native enums, PSL's scalar type names, and the caller's other blocks. A
  // clash costs differently depending on the partner: against a scalar name
  // the enum wins the type lookup and retypes every field of that type
  // (`psl-column-resolution` consults enums before scalars), while against a
  // model it is two declarations claiming one top-level name, which does not
  // parse back. Either way the block cannot be renamed here, so it is refused.
  // Policies are absent from this set on purpose — they are handed these
  // names below and rename themselves out of the way.
  const claimedTopLevelNames = new Set([
    ...PSL_SCALAR_TYPE_NAMES,
    ...modelNameMap.values(),
    ...bareEnumNameMap.values(),
  ]);
  for (const block of topLevelExtensionBlocks) {
    if (claimedTopLevelNames.has(block.name)) {
      throw postgresError(
        'CONTRACT.NAME_DUPLICATE',
        `contract infer: recovered ${block.keyword} "${block.name}" collides with a model, a ` +
          'native enum, a PSL scalar type, or another recovered declaration of the same name. ' +
          'Rename the recovered declaration, or exclude it.',
        { meta: { kind: block.keyword, name: block.name } },
      );
    }
    claimedTopLevelNames.add(block.name);
  }

  // Path A domain-enum recovery. Names are allocated against the fully
  // claimed top-level scope with the numeric-suffix disambiguator, so a
  // recovered block can never trip the collision throw above (which stays
  // for external callers of `topLevelExtensionBlocks`).
  const recoveredColumnsByTable = recoverDomainEnumColumns(schemaIR.tables);
  const recoveredEnumBlocks: PslExtensionBlock[] = [];
  const recoveredEnumsByTable = new Map<string, ReadonlyMap<string, RecoveredEnumField>>();
  for (const table of Object.values(schemaIR.tables)) {
    const recoveredColumns = recoveredColumnsByTable.get(table.name);
    if (recoveredColumns === undefined) continue;
    const byColumn = new Map<string, RecoveredEnumField>();
    for (const column of Object.values(table.columns)) {
      const entry = recoveredColumns.get(column.name);
      if (entry === undefined) continue;
      const pslName = createUniqueFieldName(
        toEnumName(`${table.name}_${column.name}`).name,
        claimedTopLevelNames,
      );
      claimedTopLevelNames.add(pslName);
      recoveredEnumBlocks.push(buildRecoveredEnumBlock(pslName, entry.memberValues, entry.codecId));
      byColumn.set(column.name, { pslName, memberValues: entry.memberValues });
    }
    recoveredEnumsByTable.set(table.name, byColumn);
  }
  const allTopLevelBlocks = [...topLevelExtensionBlocks, ...recoveredEnumBlocks];

  const policyEmission = buildPolicyBlocks(
    rlsExtras?.policiesByTable ?? new Map(),
    modelNameMap,
    new Set([
      ...modelNameMap.values(),
      ...bareEnumNameMap.values(),
      ...allTopLevelBlocks.map((block) => block.name),
    ]),
  );

  const models: PslModel[] = [];
  for (const table of Object.values(schemaIR.tables)) {
    models.push(
      buildModel(
        table,
        typeMap,
        enumNameMap,
        fieldNamesByTable,
        defaultMapping,
        rawDefaultParser,
        [
          ...(relationsByTable.get(table.name) ?? []),
          ...(extraRelationsByTable.get(table.name) ?? []),
        ],
        danglingForeignKeysByTable.get(table.name) ?? [],
        rlsExtras?.rlsEnabledTables.has(table.name) ?? false,
        policyEmission.skipNotesByTable.get(table.name) ?? [],
        recoveredEnumsByTable.get(table.name),
      ),
    );
  }

  const sortedModels = topologicalSort(models, schemaIR.tables, modelNameMap);

  // The named bucket below carries models, native-enum blocks, and policy
  // blocks exactly as before: named `namespaceName` when the introspected
  // content needs a schema wrap (native enums or RLS policies), otherwise the
  // synthesised `__unspecified__` bucket, which the framework printer emits
  // flat with no `namespace { … }` wrapper.
  //
  // A second, always-`__unspecified__` bucket carries schema-less top-level
  // content — the printer sorts it before any named namespace and never wraps
  // it either. The bucket is only pushed when non-empty. Printed output would
  // be the same either way, because the printer drops a section with no
  // content; the reason is the AST, which callers index by position and
  // assert the length of.
  //
  // The two buckets must not share a name, so the split needs a wrap name
  // that is a real schema. Both `undefined` and `__unspecified__` mean "no
  // wrap" downstream, and a live schema can be called `__unspecified__` even
  // though PSL reserves that name in source — so both are excluded and the
  // top-level blocks join the single flat bucket instead.
  //
  // Within one bucket the printer emits models before blocks, so in the
  // merged case a top-level block prints after the models rather than above
  // them. It is still a top-level declaration, which is what the wrap would
  // have broken; only its position in the file differs from the split case.
  const separateTopLevelBucket =
    namespaceName !== undefined &&
    namespaceName !== UNSPECIFIED_PSL_NAMESPACE_ID &&
    allTopLevelBlocks.length > 0;

  const namespaces: PslNamespace[] = [];
  if (separateTopLevelBucket) {
    namespaces.push(
      makePslNamespace({
        kind: 'namespace',
        name: UNSPECIFIED_PSL_NAMESPACE_ID,
        entries: makePslNamespaceEntries([], [], allTopLevelBlocks),
        span: SYNTHETIC_SPAN,
      }),
    );
  }
  namespaces.push(
    makePslNamespace({
      kind: 'namespace',
      name: namespaceName ?? UNSPECIFIED_PSL_NAMESPACE_ID,
      entries: makePslNamespaceEntries(
        sortedModels,
        [],
        [
          ...(separateTopLevelBucket ? [] : allTopLevelBlocks),
          ...enumBlocks,
          ...policyEmission.blocks,
        ],
      ),
      span: SYNTHETIC_SPAN,
    }),
  );

  const ast: PslDocumentAst = {
    kind: 'document',
    sourceId: '<sql-schema-ir>',
    namespaces,
    span: SYNTHETIC_SPAN,
  };

  return ast;
}
