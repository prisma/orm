export interface CommanderOptionShape {
  /** Commander's option attribute name, e.g. `dryRun` for `--dry-run`. */
  readonly attributeName: string;
  /** Commander's long, user-facing flag spelling, e.g. `--dry-run` or `--no-install`. */
  readonly longName: string | null;
  /** Commander's value source for this option. Only `cli` is user-supplied. */
  readonly source: string | null;
}

/**
 * Input shape: a thin projection of commander's parsed-result surface.
 * The parent extracts the command path, positional args, and per-option
 * metadata from the leaf command. The sanitiser never consumes raw
 * argv, never reads `process.argv`, and never sees flag values.
 */
export interface CommanderResultShape {
  /**
   * The full command path from the root program to the leaf, including
   * the root program name as the first element (the sanitiser drops it).
   * Example: `['prisma', 'migration', 'new']`.
   */
  readonly commandPath: readonly string[];
  /**
   * Positional arguments commander parsed for the leaf command.
   * **Intentionally never read.** Accepted so the call site doesn't have
   * to think about whether to pass it; the sanitiser's contract is that
   * positionals never leave the parent process.
   */
  readonly positionalArgs: readonly string[];
  /**
   * Per-option Commander metadata. The sanitiser emits only options whose
   * source is `cli`, and uses `longName` so telemetry sees user-facing
   * names (`dry-run`, `connection-string`, `no-install`) rather than
   * Commander's internal camelCase attribute names or defaulted options.
   */
  readonly options: readonly CommanderOptionShape[];
}

/**
 * Output shape: the sanitised projection that flows into the telemetry
 * payload. Two fields only — command name (space-delimited subcommand
 * path) and flag names (in commander's option declaration order).
 */
export interface SanitisedCommand {
  readonly command: string;
  readonly flags: readonly string[];
}

function flagNameFromLongName(longName: string | null): string | null {
  if (longName === null || !longName.startsWith('--')) return null;
  const withoutPrefix = longName.slice(2);
  return withoutPrefix.length > 0 ? withoutPrefix : null;
}

/**
 * Project commander's parsed result into the wire-shape command and
 * flag-name list. Pure; the only allowed inputs are the fields of
 * `CommanderResultShape`.
 *
 * Sanitiser contract — no flag values, no positionals, no raw argv:
 *   - Drop the root program name (`commandPath[0]`); the wire ships
 *     `migration new`, not `prisma migration new`.
 *   - Emit only options whose Commander source is `cli`.
 *   - Emit the long user-facing flag spelling without the `--` prefix;
 *     never emit Commander's camelCase attribute names.
 *   - `positionalArgs` is accepted but never consumed; the field exists
 *     in the input type to make it obvious at the call site that
 *     positionals were deliberately excluded.
 */
export function sanitizeCommanderResult(input: CommanderResultShape): SanitisedCommand {
  const command = input.commandPath.slice(1).join(' ');
  const flags = input.options.flatMap((option) => {
    if (option.source !== 'cli') return [];
    const flagName = flagNameFromLongName(option.longName);
    return flagName === null ? [] : [flagName];
  });
  return { command, flags };
}
