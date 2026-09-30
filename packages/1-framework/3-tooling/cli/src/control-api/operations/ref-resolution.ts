/**
 * Client-free contract/migration reference resolution for commands, wrapping migration-tools' parsers with the CLI error mapping.
 */

import { EMPTY_CONTRACT_HASH } from '@internal/migration-tools/constants';
import type { MigrationGraph } from '@internal/migration-tools/graph';
import type { ContractRef, MigrationRef } from '@internal/migration-tools/ref-resolution';
import { parseContractRef, parseMigrationRef } from '@internal/migration-tools/ref-resolution';
import type { Refs } from '@internal/migration-tools/refs';
import { notOk, ok, type Result } from '@internal/utils/result';
import {
  type CliStructuredError,
  mapRefResolutionError,
  requireLiveDatabase,
} from '../../utils/cli-errors';

export interface RefResolutionContext {
  readonly graph: MigrationGraph;
  readonly refs: Refs;
  readonly contractHash?: string;
}

export function resolveContractRef(
  input: string,
  context: RefResolutionContext,
): Result<ContractRef, CliStructuredError> {
  const result = parseContractRef(input, context);
  return result.ok ? ok(result.value) : notOk(mapRefResolutionError(result.failure));
}

export function resolveMigrationRef(
  input: string,
  context: { readonly graph: MigrationGraph; readonly refs: Refs },
): Result<MigrationRef, CliStructuredError> {
  const result = parseMigrationRef(input, context);
  return result.ok ? ok(result.value) : notOk(mapRefResolutionError(result.failure));
}

const LIVE_MARKER_REF = '@db';

const RESERVED_CONTRACT_REFS: ReadonlySet<string> = new Set([
  '@contract',
  LIVE_MARKER_REF,
  '@empty',
]);

export function isReservedContractRef(input: string): boolean {
  return RESERVED_CONTRACT_REFS.has(input);
}

export function isLiveMarkerRef(input: string | undefined): boolean {
  return input === LIVE_MARKER_REF;
}

/** The hash `@db` names once the marker is read; an unsigned database sits at the empty contract. */
export function liveMarkerRefHash(
  marker: { readonly storageHash: string } | null | undefined,
): string {
  return marker?.storageHash ?? EMPTY_CONTRACT_HASH;
}

export function requireLiveDatabaseForLiveMarkerRef(args: {
  readonly dbConnection: unknown;
  readonly hasDriver: boolean;
  readonly command: string;
  readonly from: string | undefined;
  readonly to: string | undefined;
}): CliStructuredError | null {
  const retryCommand = [
    args.command,
    ...(args.from === undefined ? [] : [`--from ${args.from}`]),
    ...(args.to === undefined ? [] : [`--to ${args.to}`]),
    '--db $DATABASE_URL',
  ].join(' ');
  return requireLiveDatabase({
    dbConnection: args.dbConnection,
    hasDriver: args.hasDriver,
    why: `${LIVE_MARKER_REF} resolves to the live database marker and requires a --db connection`,
    retryCommand,
  });
}
