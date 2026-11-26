import type { ContractSourceFormat } from '@internal/config/config-types';
import type { ImportRequirement } from '@internal/ts-render';

/** What the config's `contract:` entry points at: a contract file `init` wrote, or the project's Prisma 7 schema. */
export type ContractEntryInput =
  | { readonly kind: 'contract'; readonly mode: ContractSourceFormat; readonly path: string }
  | { readonly kind: 'prisma7-schema'; readonly path: string };

/** A TypeScript expression for `prisma.config.ts`, with the imports it needs. */
export interface ConfigExpression {
  renderTypeScript(): string;
  importRequirements(): readonly ImportRequirement[];
}

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
   * Connects to the `DATABASE_URL` of the shell environment that ran `init` (not `.env`) and
   * reads the server's version; rejects when it cannot connect. `init` waits 60 seconds for it,
   * then aborts `signal` and reports the probe as not finished. A probe should close its client when
   * `signal` aborts, and bound its own connect and query with its driver's timeouts, well inside
   * the 60 seconds.
   */
  readonly probe?: (databaseUrl: string, signal: AbortSignal) => Promise<InitProbeResult>;
  /** The quick reference for a project that keeps its Prisma 7 schema as the contract source. */
  readonly prisma7QuickReference?: (input: Prisma7QuickReferenceInput) => string;
  /**
   * The value of the config's `contract:` entry. A plain object with the two methods, not a class
   * instance. Without it, `init` writes the path as a string, or `prisma7Schema(<path>)` imported
   * from `configModule`.
   */
  readonly contractEntry?: (input: ContractEntryInput) => ConfigExpression;
}
