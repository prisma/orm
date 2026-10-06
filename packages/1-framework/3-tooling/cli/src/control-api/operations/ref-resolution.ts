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
export function liveMarkerUse(refs: {
  readonly from: string | undefined;
  readonly to: string | undefined;
}): LiveMarkerUse {
  const liveOrigin = refs.from === undefined || isLiveMarkerRef(refs.from);
  const liveTarget = isLiveMarkerRef(refs.to);
  return { liveOrigin, liveTarget, needsDatabase: liveOrigin || liveTarget };
}

export function requireDatabaseForLiveMarkerUse(args: {
  readonly use: LiveMarkerUse;
  readonly dbConnection: unknown;
  readonly hasDriver: boolean;
  readonly commandName: string;
  readonly from: string | undefined;
  readonly to: string | undefined;
}): CliStructuredError | null {
  if (!args.use.needsDatabase) {
    return null;
  }
  const namesLiveMarker = isLiveMarkerRef(args.from) || isLiveMarkerRef(args.to);
  if (!namesLiveMarker) {
    return requireLiveDatabase({
      dbConnection: args.dbConnection,
      hasDriver: args.hasDriver,
      why: `${args.commandName} needs a database connection to read the live marker (or pass --from <contract> for an offline preview)`,
      commandName: args.commandName,
      retryCommand: `{bin} ${args.commandName} --from <contract>`,
    });
  }
  const retryCommand = [
    `{bin} ${args.commandName}`,
    ...(args.from === undefined ? [] : [`--from ${args.from}`]),
    ...(args.to === undefined ? [] : [`--to ${args.to}`]),
    '--db $DATABASE_URL',
  ].join(' ');
  return requireLiveDatabase({
    dbConnection: args.dbConnection,
    hasDriver: args.hasDriver,
    why: `${LIVE_MARKER_REF} resolves to the live database marker and requires a --db connection`,
    commandName: args.commandName,
    retryCommand,
  });
}
