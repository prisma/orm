import type { Contract } from '@internal/contract/types';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { contractError } from './contract-errors';
import type { SqlStorage } from './types';
import type { sqlContractHintsSchema } from './validators';

export type SqlContractHints = typeof sqlContractHintsSchema.infer;

export type SqlNamespaceHints = SqlContractHints['namespaces'][string];

export type SqlTableHints = SqlNamespaceHints['tables'][string];

export function sqlContractHints(contract: Contract<SqlStorage>): SqlContractHints | undefined {
  return blindCast<
    SqlContractHints | undefined,
    'a Contract<SqlStorage> exists only after the SQL contract schema has validated its hints section against the SqlContractHints shape'
  >(contract.hints);
}

type HintSubject = (name: string) => string;

const tableSubject: HintSubject = (name) => `table "${name}"`;

interface HintLocation {
  readonly namespaceId: string;
  readonly table: string;
}

function hintInvalid(message: string, location: HintLocation, was?: string): never {
  throw contractError('CONTRACT.HINT_INVALID', `Contract hints: ${message}.`, {
    meta: { ...location, ...ifDefined('was', was) },
  });
}

function compareCodePoints(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function sortedEntries<T>(record: Readonly<Record<string, T>>): [string, T][] {
  return Object.entries(record).sort(([a], [b]) => compareCodePoints(a, b));
}

class OldNameClaims {
  private readonly claimants = new Map<string, string>();

  constructor(
    private readonly subject: HintSubject,
    private readonly declaredNames: Readonly<Record<string, unknown>>,
  ) {}

  claim(name: string, was: string, location: HintLocation): void {
    if (Object.hasOwn(this.declaredNames, was)) {
      hintInvalid(
        `${this.subject(name)} claims it was "${was}", which the contract also declares`,
        location,
        was,
      );
    }
    const other = this.claimants.get(was);
    if (other !== undefined) {
      hintInvalid(
        `${this.subject(other)} and "${name}" both claim they were "${was}"`,
        location,
        was,
      );
    }
    this.claimants.set(was, name);
  }
}

function assertNamespaceHintsConsistent(
  namespaceId: string,
  hints: SqlNamespaceHints,
  declaredTables: Readonly<Record<string, unknown>>,
): void {
  const claims = new OldNameClaims(tableSubject, declaredTables);
  for (const [table, entry] of sortedEntries(hints.tables)) {
    const location = { namespaceId, table };
    if (!Object.hasOwn(declaredTables, table)) {
      hintInvalid(
        `${tableSubject(table)} carries a hint but the contract does not declare it`,
        location,
      );
    }
    claims.claim(table, entry.was, location);
  }
}

export function assertContractHintsConsistent(contract: Contract<SqlStorage>): void {
  const hints = sqlContractHints(contract);
  if (hints === undefined) {
    return;
  }
  for (const [namespaceId, namespaceHints] of sortedEntries(hints.namespaces)) {
    const namespace = contract.storage.namespaces[namespaceId];
    if (namespace === undefined) {
      for (const [table] of sortedEntries(namespaceHints.tables)) {
        hintInvalid(
          `${tableSubject(table)} names namespace "${namespaceId}", which the contract does not declare`,
          { namespaceId, table },
        );
      }
      continue;
    }
    assertNamespaceHintsConsistent(namespaceId, namespaceHints, namespace.entries.table ?? {});
  }
}
