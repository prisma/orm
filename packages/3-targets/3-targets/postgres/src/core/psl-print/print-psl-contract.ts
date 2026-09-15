import type { Contract, ExecutionMutationDefaultPhases } from '@internal/contract/types';
import { toEnumName } from '@internal/family-sql/psl-infer';
import type {
  PslDocumentAst,
  PslExtensionBlock,
  PslModel,
  PslNamespace,
} from '@internal/framework-components/psl-ast';
import { makePslNamespace, makePslNamespaceEntries } from '@internal/framework-components/psl-ast';
import type { SqlStorage } from '@internal/sql-contract/types';
import { blindCast } from '@internal/utils/casts';
import { InternalError } from '@internal/utils/internal-error';
import type { PostgresNamespaceEntries } from '../postgres-schema';
import { buildNativeEnumBlock } from '../psl-infer/infer-enum-blocks';
import { SYNTHETIC_SPAN } from '../psl-infer/psl-literals';
import { executionDefaultKey, printModel } from './print-model-blocks';
import { relationNames } from './print-relations';
import { PG_ENUM_CODEC_ID } from './print-types';

const PRINTABLE_ENTRY_KINDS: ReadonlySet<string> = new Set(['table', 'native_enum', 'valueSet']);

/**
 * Prints a Postgres contract as the Prisma 8 PSL document that interprets
 * back to the same contract: every namespace becomes a `namespace { … }`
 * block holding its models and `native_enum` blocks. Each spelling inverts a
 * rule of the PSL interpreter; a construct with no spelling throws an
 * `InternalError` naming the model, field, and construct.
 */
export function printPostgresPslContract(contract: Contract<SqlStorage>): PslDocumentAst {
  const executionDefaults = new Map<string, ExecutionMutationDefaultPhases>();
  for (const entry of contract.execution?.mutations.defaults ?? []) {
    const { ref, ...phases } = entry;
    executionDefaults.set(executionDefaultKey(ref.namespace, ref.table, ref.column), phases);
  }
  const names = relationNames(contract);

  const namespaces: PslNamespace[] = [];
  for (const [namespaceId, domainNamespace] of Object.entries(contract.domain.namespaces)) {
    const storageNamespace = contract.storage.namespaces[namespaceId];
    if (storageNamespace === undefined) {
      throw new InternalError(`Namespace "${namespaceId}" is missing from the storage plane`);
    }
    const entries = blindCast<
      PostgresNamespaceEntries,
      'a Postgres contract namespace carries Postgres entry kinds'
    >(storageNamespace.entries);
    for (const kind of Object.keys(entries)) {
      if (!PRINTABLE_ENTRY_KINDS.has(kind)) {
        throw new InternalError(
          `Namespace "${namespaceId}": "${kind}" entries have no Prisma 8 PSL spelling in contract convert`,
        );
      }
    }
    const enumHandleByTypeName = enumHandles(namespaceId, entries);

    const models: PslModel[] = Object.entries(domainNamespace.models).map(([modelName, model]) =>
      printModel({
        contract,
        namespaceId,
        modelName,
        model,
        enumHandleByTypeName,
        relationNames: names,
        executionDefaults,
      }),
    );
    const enumBlocks: PslExtensionBlock[] = Object.values(entries.native_enum ?? {}).map(
      (nativeEnum) => {
        // Member identifiers are labels; the value travels in the quoted
        // string, so a value that is not an identifier is spelled through the
        // same sanitizer `contract infer` uses.
        const handle = enumHandleByTypeName.get(nativeEnum.typeName);
        if (handle === undefined) {
          throw new InternalError(`Enum "${nativeEnum.typeName}": no block name was resolved`);
        }
        return buildNativeEnumBlock(handle, nativeEnum.typeName, nativeEnum.members);
      },
    );
    namespaces.push(
      makePslNamespace({
        kind: 'namespace',
        name: namespaceId,
        entries: makePslNamespaceEntries(models, [], enumBlocks),
        span: SYNTHETIC_SPAN,
      }),
    );
  }

  return { kind: 'document', sourceId: '<contract>', namespaces, span: SYNTHETIC_SPAN };
}

/**
 * The `native_enum` block name for each enum type in a namespace. The block
 * name survives in the contract only as the `valueSet` entry name, which the
 * enum columns reference beside the type name; an enum no column uses is
 * matched to a value set with the same members, and failing that takes its
 * type name made an identifier (`toEnumName`, always an identifier: letters
 * and digits joined, a leading `_` for a reserved word or digit), with
 * `@@map` carrying the type name; a name another enum already holds gets a
 * numeric suffix.
 */
function enumHandles(
  namespaceId: string,
  entries: PostgresNamespaceEntries,
): ReadonlyMap<string, string> {
  const handles = new Map<string, string>();
  const bareTypeName = (typeName: string): string =>
    typeName.startsWith(`${namespaceId}.`) ? typeName.slice(namespaceId.length + 1) : typeName;
  for (const table of Object.values(entries.table ?? {})) {
    for (const column of Object.values(table.columns)) {
      const typeName = column.typeParams?.['typeName'];
      if (column.codecId !== PG_ENUM_CODEC_ID || typeof typeName !== 'string') continue;
      if (column.valueSet !== undefined && column.valueSet.namespaceId === namespaceId) {
        handles.set(bareTypeName(typeName), column.valueSet.entityName);
        handles.set(typeName, column.valueSet.entityName);
      }
    }
  }
  const claimedHandles = new Set(handles.values());
  for (const nativeEnum of Object.values(entries.native_enum ?? {})) {
    if (handles.has(nativeEnum.typeName)) continue;
    const matching = Object.entries(entries.valueSet ?? {}).filter(
      ([handle, valueSet]) =>
        !claimedHandles.has(handle) &&
        valueSet.values.length === nativeEnum.members.length &&
        valueSet.values.every((value, index) => value === nativeEnum.members[index]),
    );
    const [match] = matching;
    let handle =
      matching.length === 1 && match !== undefined
        ? match[0]
        : toEnumName(nativeEnum.typeName).name;
    for (let suffix = 2; claimedHandles.has(handle); suffix += 1) {
      handle = `${toEnumName(nativeEnum.typeName).name}${suffix}`;
    }
    claimedHandles.add(handle);
    handles.set(nativeEnum.typeName, handle);
    handles.set(`${namespaceId}.${nativeEnum.typeName}`, handle);
  }
  return handles;
}
