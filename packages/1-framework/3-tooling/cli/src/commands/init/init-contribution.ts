import type { ContractSourceFormat } from '@internal/config/config-types';

export interface QuickReferenceInput {
  readonly mode: ContractSourceFormat;
  readonly schemaPath: string;
  /** The command that runs the project's Prisma CLI, such as `pnpm prisma`. */
  readonly cliCommand: string;
  /** The rendered "Requirements" section, or an empty string when the package states none. */
  readonly requirements: string;
}

export interface ReadmeInput {
  readonly projectName: string;
  readonly contractPath: string;
  /** The command that runs a `package.json` script with the project's package manager. */
  readonly runScript: (script: string) => string;
}

export interface Prisma7QuickReferenceInput {
  readonly schemaPath: string;
  /** The directory the contract is emitted into, which also holds `db.ts`. */
  readonly outputDir: string;
  readonly cliCommand: string;
  readonly requirements: string;
  /** The Prisma 7 config's file name once init is done; `undefined` when the project has none. */
  readonly prisma7Config: string | undefined;
}

export interface ServerRequirement {
  readonly minVersion: string;
  /** A query the user can run against the server to read its version. */
  readonly checkCommand: string;
}

/**
 * What a probe found. It rejects only when it cannot connect; once connected, a query that fails
 * or an answer with no readable version is `version-unreadable`.
 */
export type InitProbeResult =
  | { readonly kind: 'server-version'; readonly serverVersion: string }
  /** It connected, but the version query failed or its answer held no version the probe can read. */
  | { readonly kind: 'version-unreadable'; readonly detail: string }
  /** The driver is not installed where the target package can load it. */
  | { readonly kind: 'driver-missing'; readonly driver: string; readonly cause: string }
  /** The driver is installed but failed to load. */
  | { readonly kind: 'driver-failed'; readonly driver: string; readonly cause: string };

/**
 * What a target package tells `prisma orm init`, as the default export of its `init` entrypoint.
 * The entrypoint may import types from the framework but no framework code that runs.
 *
 * A package takes a Prisma 7 schema as its contract source when its `configModule` exports
 * `prisma7Schema`; `init` then writes the config itself and needs `prisma7QuickReference`.
 */
export interface InitContribution {
  readonly label: string;
  /** The module `prisma.config.ts` imports `defineConfig` from. */
  readonly configModule: string;
  /** Packages installed into the application with the target package. */
  readonly peerPackages: readonly string[];
  readonly authoringModes: readonly ContractSourceFormat[];
  readonly starterContract: (mode: ContractSourceFormat) => string;
  /** A short contract sample for the quick reference, as a fenced code block. */
  readonly contractSample: (mode: ContractSourceFormat) => string;
  /**
   * `db.ts`, which sits beside the emitted `contract.json` and `contract.d.ts`. The connection
   * string is in `DATABASE_URL`, and `dotenv` is installed, so it may import `dotenv/config`.
   */
  readonly databaseFile: () => string;
  /**
   * The body of `.env.example`, and of `.env` when the user asks for one. It sets `DATABASE_URL`,
   * the variable `prisma.config.ts`, `db.ts` and `--probe-db` read; `dotenv` loads it.
   */
  readonly envExample: () => string;
  readonly quickReference: (input: QuickReferenceInput) => string;
  /** The README for a project that already has `src/index.ts`; no README is written without it. */
  readonly readme?: (input: ReadmeInput) => string;
  readonly serverRequirement?: ServerRequirement;
  /**
   * Connects and reads the server's version; rejects when it cannot connect. `init` waits 60 seconds
   * for it and then reports the probe as not finished, so a probe should bound its own connect and
   * query with its driver's timeouts, well inside that.
   */
  readonly probe?: (databaseUrl: string) => Promise<InitProbeResult>;
  /** The quick reference for a project that keeps its Prisma 7 schema as the contract source. */
  readonly prisma7QuickReference?: (input: Prisma7QuickReferenceInput) => string;
}
