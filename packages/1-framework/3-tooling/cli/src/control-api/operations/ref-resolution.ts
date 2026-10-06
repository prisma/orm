/**
 * Client-free contract/migration reference resolution for commands, wrapping migration-tools' parsers with the CLI error mapping.
 */

import type { MigrationGraph } from '@internal/migration-tools/graph';
import type { ContractRef, MigrationRef } from '@internal/migration-tools/ref-resolution';
import {
  isLiveMarkerRef,
  LIVE_MARKER_REF,
  parseContractRef,
  parseMigrationRef,
} from '@internal/migration-tools/ref-resolution';
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

export interface LiveMarkerUse {
  readonly liveOrigin: boolean;
  readonly liveTarget: boolean;
  readonly needsDatabase: boolean;
}

/** Where `--from`/`--to` read the live marker: an omitted or `@db` origin, and an `@db` target. */
export function liveMarkerUse(flags: {
  readonly from: string | undefined;
  readonly to: string | undefined;
}): LiveMarkerUse {
  const liveOrigin = flags.from === undefined || isLiveMarkerRef(flags.from);
  const liveTarget = isLiveMarkerRef(flags.to);
  return { liveOrigin, liveTarget, needsDatabase: liveOrigin || liveTarget };
}

/** The command a missing-connection error suggests: the user's flags as given, plus what the retry needs to run. */
export function retryCommandFor(args: {
  readonly commandName: string;
  readonly from?: string | undefined;
  readonly to: string | undefined;
  readonly advanceRef?: string | undefined;
  /** The command runs without a database when `--from` names a contract. */
  readonly offline: boolean;
}): string {
  const namesLiveMarker = isLiveMarkerRef(args.from) || isLiveMarkerRef(args.to);
  const suggestsOffline = args.offline && args.from === undefined && !namesLiveMarker;
  const needsConnection = !args.offline || namesLiveMarker;
  return [
    `{bin} ${args.commandName}`,
    ...(args.from === undefined ? [] : [`--from ${args.from}`]),
    ...(suggestsOffline ? ['--from <contract>'] : []),
    ...(args.to === undefined ? [] : [`--to ${args.to}`]),
    ...(args.advanceRef === undefined ? [] : [`--advance-ref ${args.advanceRef}`]),
    ...(needsConnection ? ['--db $DATABASE_URL'] : []),
  ].join(' ');
}

/** The missing-connection error for a command whose `--from`/`--to` read the live marker, or `null`. */
export function requireDatabaseForLiveMarkerUse(args: {
  readonly from: string | undefined;
  readonly to: string | undefined;
  readonly dbConnection: unknown;
  readonly hasDriver: boolean;
  readonly commandName: string;
}): CliStructuredError | null {
  if (!liveMarkerUse(args).needsDatabase) {
    return null;
  }
  return requireLiveDatabase({
    dbConnection: args.dbConnection,
    hasDriver: args.hasDriver,
    why:
      isLiveMarkerRef(args.from) || isLiveMarkerRef(args.to)
        ? `${LIVE_MARKER_REF} resolves to the live database marker and requires a --db connection`
        : `${args.commandName} needs a database connection to read the live marker (or pass --from <contract> to run offline)`,
    commandName: args.commandName,
    retryCommand: retryCommandFor({
      commandName: args.commandName,
      from: args.from,
      to: args.to,
      offline: true,
    }),
  });
}
