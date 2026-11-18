/** How the starter contract is written: Prisma Schema Language or TypeScript. */
export type AuthoringMode = 'psl' | 'typescript';

export interface QuickReferenceInput {
  readonly mode: AuthoringMode;
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

export interface Prisma7ConfigFileInput {
  readonly schemaPath: string;
  /** The directory the contract is emitted into, which also holds `db.ts`. */
  readonly outputDir: string;
}

export interface Prisma7QuickReferenceInput {
  readonly schemaPath: string;
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

export type InitProbeResult =
  | { readonly kind: 'server-version'; readonly serverVersion: string }
  | { readonly kind: 'driver-missing'; readonly driver: string; readonly cause: string };

/**
 * What a target package tells `prisma orm init`, as the default export of its `init` entrypoint.
 * The entrypoint may import types from the framework but no framework code that runs.
 */
export interface InitContribution {
  readonly label: string;
  /** The module `prisma.config.ts` imports `defineConfig` from. */
  readonly configModule: string;
  /** Packages installed into the application with the target package. */
  readonly peerPackages: readonly string[];
  readonly authoringModes: readonly AuthoringMode[];
  readonly starterContract: (mode: AuthoringMode) => string;
  /** A short contract sample for the quick reference, as a fenced code block. */
  readonly contractSample: (mode: AuthoringMode) => string;
  /** `db.ts`, which sits beside the emitted `contract.json` and `contract.d.ts`. */
  readonly databaseFile: () => string;
  /** The body of `.env.example`, and of `.env` when the user asks for one. */
  readonly envExample: () => string;
  readonly quickReference: (input: QuickReferenceInput) => string;
  readonly readme: (input: ReadmeInput) => string;
  readonly serverRequirement?: ServerRequirement;
  /** Connects and reads the server's version; rejects when it cannot connect. */
  readonly probe?: (databaseUrl: string) => Promise<InitProbeResult>;
  /** The config for a project that keeps its Prisma 7 schema as the contract source. */
  readonly prisma7ConfigFile?: (input: Prisma7ConfigFileInput) => string;
  /** The quick reference for that project. Given exactly when `prisma7ConfigFile` is. */
  readonly prisma7QuickReference?: (input: Prisma7QuickReferenceInput) => string;
}
