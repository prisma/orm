/**
 * Canonical mapping of internal workspace packages to public publish shells
 * (ADR 242). Each internal package becomes a subpath entrypoint namespace of
 * exactly one published `@prisma/orm-*` shell: the internal root export maps
 * to `@prisma/<shell>/<entry>` and each internal subpath `./x` maps to
 * `@prisma/<shell>/<entry>/x`.
 *
 * Consumed by the shell build (`@repo/tsdown/shell-build`), by the
 * emitters' import-root resolution (`./import-roots`), and later by the
 * publish-surface lint.
 */

/**
 * How an application acquires a shell, which decides whether emitted code may
 * name it. See `directDependencyShells` in `./import-roots`.
 */
export type ShellKind =
  /** Installed directly only by a decomposed application. */
  | 'platform'
  /** The one-package install for a database; carries the platform shells. */
  | 'facade'
  /** Installed directly alongside whatever else the application uses. */
  | 'extension';

export interface ShellPackageMapping {
  /** Internal package directory, relative to the repository root. */
  readonly dir: string;
  /**
   * Internal package name, e.g. `@internal/contract`. Declared rather than
   * read from `dir/package.json` so specifier resolution works inside a
   * published bundle, where the workspace is not on disk. A test keeps the
   * two in step.
   */
  readonly name: string;
  /**
   * Entrypoint namespace inside the shell. The empty string places the
   * package directly at the shell's own namespace, so its `./x` export
   * becomes `@prisma/<shell>/x` — the shape facades and extension packs
   * use, where the shell publishes a single internal package under its
   * own name.
   */
  readonly entry: string;
  /**
   * Whether the package contributes entrypoints. Defaults to true.
   *
   * Set false for code that belongs in this shell's bundle but that nothing
   * imports by name — the shell still owns it, so a sibling depending on it
   * resolves within the shell rather than across one, but no `exports` entry
   * is published and the module is reached only through whatever already
   * pulls it in.
   */
  readonly published?: boolean;
  /**
   * The subpaths of this package the shell publishes, without the `./`
   * prefix; `'.'` names the package's root export. Omitted publishes every
   * subpath the package exports plus the package-level aggregate name.
   *
   * When listed, exactly these ship and no aggregate is synthesized. The CLI
   * package uses this to pin its published surface explicitly: the root
   * (`@prisma/orm-toolchain/cli`, where the unified `prisma` shell imports
   * the `orm` command family from) plus the handful of stable subpaths —
   * anything the package adds for workspace-internal use stays unpublished
   * unless listed here.
   */
  readonly subpaths?: readonly string[];
}

export interface ShellReexportMapping {
  /** Internal package name whose surface is forwarded, e.g. `@internal/contract`. */
  readonly package: string;
  /** Entrypoint namespace inside this shell that forwards to it. */
  readonly entry: string;
  /**
   * Whether `<entry>` itself forwards the package as a whole. Set false when
   * the shell's own code already owns that name and only the subpaths
   * `<entry>/x` should forward. Defaults to true.
   */
  readonly root?: boolean;
  /**
   * The subpaths of `package` this entry forwards, without the `./` prefix.
   * Omitted forwards every subpath the package exports.
   *
   * Forwarding a whole package costs one published entrypoint per subpath it
   * exports, which is the right price for a surface an application uses as a
   * whole. It is the wrong price for a large tooling package a facade needs a
   * corner of: listing the subpaths keeps the rest of that package off the
   * published surface, so it stays free to change.
   */
  readonly subpaths?: readonly string[];
}

export interface ShellDefinition {
  /** Shell directory relative to the repository root. */
  readonly dir: string;
  readonly kind: ShellKind;
  readonly packages: readonly ShellPackageMapping[];
  /**
   * Surfaces of *other* shells republished under this shell's own
   * entrypoints. Nothing is copied: each generated entry re-exports the
   * sibling shell's published entrypoint, which the shell declares as an
   * exact-pinned dependency. Facades carry the contract surfaces this way
   * so that code generated for an application that installs only the
   * facade imports nothing but a direct dependency (ADR 242).
   */
  readonly reexports?: readonly ShellReexportMapping[];
  /**
   * Sibling shells this shell requires the installer to provide, declared as
   * peer dependencies rather than pulled in as its own copy.
   *
   * Extension packs use this for the target shell they extend (ADR 242).
   * A hard dependency would let an application upgrade the facade without
   * upgrading the extension and end up with two copies of the target — the
   * codec and operation registries would silently diverge and `instanceof`
   * would stop holding. As a peer, that combination fails to install
   * instead.
   */
  readonly peerShells?: readonly ShellName[];
  /**
   * Extra dist files to copy into the shell's dist root (globs relative to
   * the repository root), e.g. templates an internal package reads next to
   * its code via `import.meta.dirname`.
   */
  readonly copy?: readonly string[];
}

export type ShellName =
  | '@prisma/orm-framework'
  | '@prisma/orm-toolchain'
  | '@prisma/orm-family-sql'
  | '@prisma/orm-family-mongo'
  | '@prisma/orm-target-postgres'
  | '@prisma/orm-target-sqlite'
  | '@prisma/orm-target-mongo'
  | '@prisma/orm-postgres'
  | '@prisma/orm-sqlite'
  | '@prisma/orm-mongo'
  | '@prisma/orm-extension-postgis'
  | '@prisma/orm-extension-pgvector'
  | '@prisma/orm-extension-paradedb'
  | '@prisma/orm-extension-supabase'
  | '@prisma/orm-extension-arktype-json'
  | '@prisma/orm-extension-middleware-cache';

/**
 * Surfaces every facade republishes regardless of family.
 *
 * An application depends on one facade and nothing else (ADR 242), so
 * everything it reaches — hand-written and generated alike — has to have a
 * name under the facade. These are the target-agnostic ones: the contract and
 * component surfaces emitted files import, the shared helpers, and the Vite
 * plugin.
 *
 * Entry names follow the name the platform shell gives the same package, so
 * one internal package reads the same way wherever it is reached from.
 *
 * A republished package brings its whole subpath surface with it unless the
 * entry lists `subpaths`, so the cost of an entry is its export count, not
 * one. Nothing goes in here that no application reaches.
 *
 * `migration-tools` is listed by subpath rather than whole. An application
 * does reach it — a project that checks its own migrations are intact, or
 * that stages an extension's pinned contract-space artifacts before `db
 * init`, reads and writes the on-disk migration format, and under a
 * facade-only install there is no other published name for it. But it is a
 * 17-subpath tooling package whose remaining surface (the graph, the
 * pathfinder, ref resolution, the ledger) is the CLI's own working material,
 * and publishing that would freeze it. The five listed here are what the
 * repository's own consumers reach.
 */
const COMMON_FACADE_REEXPORTS: readonly ShellReexportMapping[] = [
  { package: '@internal/contract', entry: 'contract' },
  { package: '@internal/framework-components', entry: 'components' },
  { package: '@internal/utils', entry: 'utils' },
  {
    package: '@internal/vite-plugin-contract-emit',
    entry: 'vite-plugin-contract-emit',
  },
  {
    package: '@internal/migration-tools',
    entry: 'migration-tools',
    subpaths: ['aggregate', 'contract-snapshot-store', 'hash', 'io', 'spaces'],
  },
];

/**
 * The per-database part of a facade's republished surface.
 *
 * `family` is the family's contract package (`@internal/sql-contract` or
 * `@internal/mongo-contract`) and `familyPack` its control-plane and IR
 * pack; `target` and `adapter` carry the codec and operation types emitted
 * contracts reference; `runtime` is the family runtime an application drives
 * queries through.
 *
 * `family-contract` and `family-runtime` take a qualified name because the
 * facade's own `contract` and `runtime` are different modules. `target` and
 * `familyPack` forward subpaths only, so that a facade which publishes its own
 * `./target` or `./family` pack keeps that name for its own module; where a
 * facade publishes neither, the plain name simply stays free.
 *
 * `driver` is carried by every facade. A facade wires its own driver, so the
 * only code that names one is code driving the migration planner or runner
 * itself — which the SQL facades were assumed not to have, until the SQL
 * migration-planner harnesses turned out to need the driver's control
 * descriptor to build a control stack by hand. Two subpaths per facade.
 *
 * `targetSubpaths` limits the target forward where the target package exports
 * something the facade's own code imports but no application does.
 */
function facadeReexports(options: {
  readonly family: string;
  readonly familyPack: string;
  readonly runtime: string;
  readonly target: string;
  readonly targetSubpaths?: readonly string[];
  readonly adapter: string;
  readonly driver: string;
  readonly queryBuilders: readonly ShellReexportMapping[];
}): ShellReexportMapping[] {
  return [
    ...COMMON_FACADE_REEXPORTS,
    { package: options.family, entry: 'family-contract' },
    { package: options.familyPack, entry: 'family', root: false },
    { package: options.runtime, entry: 'family-runtime' },
    {
      package: options.target,
      entry: 'target',
      root: false,
      ...(options.targetSubpaths === undefined ? {} : { subpaths: options.targetSubpaths }),
    },
    { package: options.adapter, entry: 'adapter' },
    { package: options.driver, entry: 'driver' },
    ...options.queryBuilders,
  ];
}

/**
 * The SQL family's query surfaces, republished by both SQL facades.
 *
 * `schema-ir` carries one subpath. Code that authors a migration by hand, or
 * drives the planner itself, names `SqlSchemaIR` — it is the schema shape the
 * planner takes and returns. The package's other two subpaths are the IR's
 * construction and naming internals, which publishing would freeze.
 */
const SQL_QUERY_REEXPORTS: readonly ShellReexportMapping[] = [
  { package: '@internal/sql-orm-client', entry: 'orm-client' },
  { package: '@internal/sql-builder', entry: 'builder' },
  { package: '@internal/sql-relational-core', entry: 'relational-core' },
  { package: '@internal/sql-schema-ir', entry: 'schema-ir', subpaths: ['types'] },
];

/**
 * The Mongo family's query surfaces.
 *
 * `orm` is one subpath, and carries `DefaultModelRow` — the type an
 * application names when it writes a function over a query result. That is
 * the same surface the SQL facades carry as `orm-client`, which application
 * source in the SQLite example uses directly.
 */
const MONGO_QUERY_REEXPORTS: readonly ShellReexportMapping[] = [
  { package: '@internal/mongo-orm', entry: 'orm' },
  { package: '@internal/mongo-query-builder', entry: 'query-builder' },
  { package: '@internal/mongo-query-ast', entry: 'query-ast' },
  { package: '@internal/mongo-value', entry: 'value' },
];

export const publicShells: ReadonlyMap<ShellName, ShellDefinition> = new Map<
  ShellName,
  ShellDefinition
>([
  [
    '@prisma/orm-framework',
    {
      dir: 'packages/9-public/@prisma/orm-framework',
      kind: 'platform',
      packages: [
        {
          dir: 'packages/1-framework/0-foundation/contract',
          name: '@internal/contract',
          entry: 'contract',
        },
        {
          dir: 'packages/1-framework/0-foundation/utils',
          name: '@internal/utils',
          entry: 'utils',
        },
        { dir: 'packages/1-framework/1-core/config', name: '@internal/config', entry: 'config' },
        { dir: 'packages/1-framework/1-core/errors', name: '@internal/errors', entry: 'errors' },
        {
          dir: 'packages/1-framework/1-core/framework-components',
          name: '@internal/framework-components',
          entry: 'components',
        },
        {
          dir: 'packages/1-framework/1-core/operations',
          name: '@internal/operations',
          entry: 'operations',
        },
        {
          dir: 'packages/1-framework/1-core/ts-render',
          name: '@internal/ts-render',
          entry: 'ts-render',
        },
        {
          dir: 'packages/1-framework/2-authoring/contract',
          name: '@internal/contract-authoring',
          entry: 'contract-authoring',
        },
        { dir: 'packages/1-framework/2-authoring/ids', name: '@internal/ids', entry: 'ids' },
        {
          dir: 'packages/1-framework/2-authoring/psl-parser',
          name: '@internal/psl-parser',
          entry: 'psl-parser',
        },
        {
          dir: 'packages/1-framework/2-authoring/psl-printer',
          name: '@internal/psl-printer',
          entry: 'psl-printer',
        },
      ],
    },
  ],
  [
    '@prisma/orm-toolchain',
    {
      dir: 'packages/9-public/@prisma/orm-toolchain',
      kind: 'platform',
      packages: [
        {
          dir: 'packages/1-framework/3-tooling/cli',
          name: '@internal/cli',
          entry: 'cli',
          // After the S5 cutover the root export — the engine-mounted `orm`
          // command family, imported by the unified `prisma` shell as
          // `@prisma/orm-toolchain/cli` — is the published CLI surface. The
          // commander-era `./cli/commands/*` factories are gone, and the
          // workspace-local standalone bin is not published.
          subpaths: [
            '.',
            'migration-cli',
            'control-api',
            'control-api/testing',
            'config-types',
            'init-output',
          ],
        },
        {
          dir: 'packages/1-framework/3-tooling/cli-telemetry',
          name: '@internal/cli-telemetry',
          entry: 'cli-telemetry',
        },
        {
          dir: 'packages/1-framework/3-tooling/config-loader',
          name: '@internal/config-loader',
          entry: 'config-loader',
        },
        {
          dir: 'packages/1-framework/3-tooling/emitter',
          name: '@internal/emitter',
          entry: 'emitter',
        },
        // Bundled, not published. Editors reach the language server by
        // spawning the CLI's `lsp` command and talking to it over stdio,
        // never by importing it, so a module entrypoint would be surface
        // with no importer. The CLI depends on it, so the shell still
        // carries the code — it just does not name it.
        {
          dir: 'packages/1-framework/3-tooling/language-server',
          name: '@internal/language-server',
          entry: 'language-server',
          published: false,
        },
        {
          dir: 'packages/1-framework/3-tooling/migration',
          name: '@internal/migration-tools',
          entry: 'migration-tools',
        },
        {
          dir: 'packages/1-framework/3-tooling/vite-plugin-contract-emit',
          name: '@internal/vite-plugin-contract-emit',
          entry: 'vite-plugin-contract-emit',
        },
        // This table itself. Emission resolves generated import specifiers
        // through it at run time, so the toolchain carries it rather than
        // duplicating a copy of the mapping wherever a resolver is built.
        {
          dir: 'packages/0-shared/publish-surface',
          name: '@internal/publish-surface',
          entry: 'publish-surface',
        },
      ],
      copy: ['packages/1-framework/3-tooling/cli/dist/*.md'],
    },
  ],
  [
    '@prisma/orm-family-sql',
    {
      dir: 'packages/9-public/@prisma/orm-family-sql',
      kind: 'platform',
      packages: [
        {
          dir: 'packages/2-sql/1-core/contract',
          name: '@internal/sql-contract',
          entry: 'contract',
        },
        { dir: 'packages/2-sql/1-core/errors', name: '@internal/sql-errors', entry: 'errors' },
        {
          dir: 'packages/2-sql/1-core/operations',
          name: '@internal/sql-operations',
          entry: 'operations',
        },
        {
          dir: 'packages/2-sql/1-core/schema-ir',
          name: '@internal/sql-schema-ir',
          entry: 'schema-ir',
        },
        {
          dir: 'packages/2-sql/2-authoring/contract-prisma7',
          name: '@internal/sql-contract-prisma7',
          entry: 'contract-prisma7',
          subpaths: ['provider'],
        },
        {
          dir: 'packages/2-sql/2-authoring/contract-psl',
          name: '@internal/sql-contract-psl',
          entry: 'contract-psl',
          subpaths: ['.', 'attribute-specs', 'default-table-name', 'provider'],
        },
        {
          dir: 'packages/2-sql/2-authoring/contract-ts',
          name: '@internal/sql-contract-ts',
          entry: 'contract-ts',
        },
        {
          dir: 'packages/2-sql/3-tooling/emitter',
          name: '@internal/sql-contract-emitter',
          entry: 'contract-emitter',
        },
        {
          dir: 'packages/2-sql/4-lanes/relational-core',
          name: '@internal/sql-relational-core',
          entry: 'relational-core',
        },
        {
          dir: 'packages/2-sql/4-lanes/sql-builder',
          name: '@internal/sql-builder',
          entry: 'builder',
        },
        { dir: 'packages/2-sql/5-runtime', name: '@internal/sql-runtime', entry: 'runtime' },
        { dir: 'packages/2-sql/9-family', name: '@internal/family-sql', entry: 'family' },
        // Platform code despite its `3-extensions/` directory: both SQL
        // facades depend on it, and one module may live in only one
        // published package, so it cannot be duplicated into each facade.
        {
          dir: 'packages/3-extensions/sql-orm-client',
          name: '@internal/sql-orm-client',
          entry: 'orm-client',
        },
      ],
    },
  ],
  [
    '@prisma/orm-family-mongo',
    {
      dir: 'packages/9-public/@prisma/orm-family-mongo',
      kind: 'platform',
      packages: [
        {
          dir: 'packages/2-mongo-family/1-foundation/mongo-codec',
          name: '@internal/mongo-codec',
          entry: 'codec',
        },
        {
          dir: 'packages/2-mongo-family/1-foundation/mongo-contract',
          name: '@internal/mongo-contract',
          entry: 'contract',
        },
        {
          dir: 'packages/2-mongo-family/1-foundation/mongo-value',
          name: '@internal/mongo-value',
          entry: 'value',
        },
        {
          dir: 'packages/2-mongo-family/2-authoring/contract-psl',
          name: '@internal/mongo-contract-psl',
          entry: 'contract-psl',
        },
        {
          dir: 'packages/2-mongo-family/2-authoring/contract-ts',
          name: '@internal/mongo-contract-ts',
          entry: 'contract-ts',
        },
        {
          dir: 'packages/2-mongo-family/3-tooling/emitter',
          name: '@internal/mongo-emitter',
          entry: 'emitter',
        },
        {
          dir: 'packages/2-mongo-family/3-tooling/mongo-schema-ir',
          name: '@internal/mongo-schema-ir',
          entry: 'schema-ir',
        },
        {
          dir: 'packages/2-mongo-family/4-query/query-ast',
          name: '@internal/mongo-query-ast',
          entry: 'query-ast',
        },
        {
          dir: 'packages/2-mongo-family/5-query-builders/orm',
          name: '@internal/mongo-orm',
          entry: 'orm',
        },
        {
          dir: 'packages/2-mongo-family/5-query-builders/query-builder',
          name: '@internal/mongo-query-builder',
          entry: 'query-builder',
        },
        {
          dir: 'packages/2-mongo-family/6-transport/mongo-lowering',
          name: '@internal/mongo-lowering',
          entry: 'lowering',
        },
        {
          dir: 'packages/2-mongo-family/6-transport/mongo-wire',
          name: '@internal/mongo-wire',
          entry: 'wire',
        },
        {
          dir: 'packages/2-mongo-family/7-runtime',
          name: '@internal/mongo-runtime',
          entry: 'runtime',
        },
        {
          dir: 'packages/2-mongo-family/9-family',
          name: '@internal/family-mongo',
          entry: 'family',
        },
      ],
    },
  ],
  [
    '@prisma/orm-target-postgres',
    {
      dir: 'packages/9-public/@prisma/orm-target-postgres',
      kind: 'platform',
      packages: [
        {
          dir: 'packages/3-targets/3-targets/postgres',
          name: '@internal/target-postgres',
          entry: 'target',
        },
        {
          dir: 'packages/3-targets/6-adapters/postgres',
          name: '@internal/adapter-postgres',
          entry: 'adapter',
        },
        {
          dir: 'packages/3-targets/7-drivers/postgres',
          name: '@internal/driver-postgres',
          entry: 'driver',
        },
      ],
    },
  ],
  [
    '@prisma/orm-target-sqlite',
    {
      dir: 'packages/9-public/@prisma/orm-target-sqlite',
      kind: 'platform',
      packages: [
        {
          dir: 'packages/3-targets/3-targets/sqlite',
          name: '@internal/target-sqlite',
          entry: 'target',
        },
        {
          dir: 'packages/3-targets/6-adapters/sqlite',
          name: '@internal/adapter-sqlite',
          entry: 'adapter',
        },
        {
          dir: 'packages/3-targets/7-drivers/sqlite',
          name: '@internal/driver-sqlite',
          entry: 'driver',
        },
      ],
    },
  ],
  [
    '@prisma/orm-target-mongo',
    {
      dir: 'packages/9-public/@prisma/orm-target-mongo',
      kind: 'platform',
      packages: [
        {
          dir: 'packages/3-mongo-target/1-mongo-target',
          name: '@internal/target-mongo',
          entry: 'target',
        },
        {
          dir: 'packages/3-mongo-target/2-mongo-adapter',
          name: '@internal/adapter-mongo',
          entry: 'adapter',
        },
        {
          dir: 'packages/3-mongo-target/3-mongo-driver',
          name: '@internal/driver-mongo',
          entry: 'driver',
        },
      ],
    },
  ],
  [
    '@prisma/orm-postgres',
    {
      dir: 'packages/9-public/@prisma/orm-postgres',
      kind: 'facade',
      packages: [{ dir: 'packages/3-extensions/postgres', name: '@internal/postgres', entry: '' }],
      reexports: facadeReexports({
        family: '@internal/sql-contract',
        familyPack: '@internal/family-sql',
        runtime: '@internal/sql-runtime',
        target: '@internal/target-postgres',
        // Every target subpath except `prisma7-binding`, which only the
        // facade's `prisma7Schema` imports. A test fails when a target export
        // is missing here.
        targetSubpaths: [
          'aggregates',
          'codec-descriptor',
          'codec-ids',
          'codec-types',
          'codecs',
          'contract-free',
          'control',
          'data-transform',
          'ddl',
          'default-normalizer',
          'diff-database-schema',
          'errors',
          'issue-planner',
          'migration',
          'native-type-normalizer',
          'op-factory-call',
          'pack',
          'planner',
          'planner-ddl-builders',
          'planner-identity-values',
          'planner-produced-postgres-migration',
          'planner-schema-lookup',
          'planner-sql-checks',
          'planner-target-details',
          'render-ops',
          'render-typescript',
          'rls-canonicalize',
          'runtime',
          'schema-ir-annotations',
          'sql-utils',
          'types',
        ],
        adapter: '@internal/adapter-postgres',
        driver: '@internal/driver-postgres',
        queryBuilders: SQL_QUERY_REEXPORTS,
      }),
    },
  ],
  [
    '@prisma/orm-sqlite',
    {
      dir: 'packages/9-public/@prisma/orm-sqlite',
      kind: 'facade',
      packages: [{ dir: 'packages/3-extensions/sqlite', name: '@internal/sqlite', entry: '' }],
      reexports: facadeReexports({
        family: '@internal/sql-contract',
        familyPack: '@internal/family-sql',
        runtime: '@internal/sql-runtime',
        target: '@internal/target-sqlite',
        adapter: '@internal/adapter-sqlite',
        driver: '@internal/driver-sqlite',
        queryBuilders: SQL_QUERY_REEXPORTS,
      }),
    },
  ],
  [
    '@prisma/orm-mongo',
    {
      dir: 'packages/9-public/@prisma/orm-mongo',
      kind: 'facade',
      packages: [{ dir: 'packages/3-extensions/mongo', name: '@internal/mongo', entry: '' }],
      reexports: facadeReexports({
        family: '@internal/mongo-contract',
        familyPack: '@internal/family-mongo',
        runtime: '@internal/mongo-runtime',
        target: '@internal/target-mongo',
        adapter: '@internal/adapter-mongo',
        driver: '@internal/driver-mongo',
        queryBuilders: MONGO_QUERY_REEXPORTS,
      }),
    },
  ],
  [
    '@prisma/orm-extension-postgis',
    {
      dir: 'packages/9-public/@prisma/orm-extension-postgis',
      kind: 'extension',
      packages: [
        { dir: 'packages/3-extensions/postgis', name: '@internal/extension-postgis', entry: '' },
      ],
      peerShells: ['@prisma/orm-target-postgres'],
    },
  ],
  [
    '@prisma/orm-extension-pgvector',
    {
      dir: 'packages/9-public/@prisma/orm-extension-pgvector',
      kind: 'extension',
      packages: [
        {
          dir: 'packages/3-extensions/pgvector',
          name: '@internal/extension-pgvector',
          entry: '',
        },
      ],
      peerShells: ['@prisma/orm-target-postgres'],
    },
  ],
  [
    '@prisma/orm-extension-paradedb',
    {
      dir: 'packages/9-public/@prisma/orm-extension-paradedb',
      kind: 'extension',
      packages: [
        {
          dir: 'packages/3-extensions/paradedb',
          name: '@internal/extension-paradedb',
          entry: '',
        },
      ],
      // ParadeDB registers its index type against the SQL family rather than
      // reaching the target at run time, so unlike its siblings it has no
      // shared registry to keep single-instance. It declares the peer anyway:
      // every Postgres extension pack states the same install requirement, and
      // a pack that quietly did not would read as a pack that works without
      // Postgres.
      peerShells: ['@prisma/orm-target-postgres'],
    },
  ],
  [
    '@prisma/orm-extension-supabase',
    {
      dir: 'packages/9-public/@prisma/orm-extension-supabase',
      kind: 'extension',
      packages: [
        {
          dir: 'packages/3-extensions/supabase',
          name: '@internal/extension-supabase',
          entry: '',
        },
      ],
      peerShells: ['@prisma/orm-target-postgres'],
    },
  ],
  [
    '@prisma/orm-extension-arktype-json',
    {
      dir: 'packages/9-public/@prisma/orm-extension-arktype-json',
      kind: 'extension',
      packages: [
        {
          dir: 'packages/3-extensions/arktype-json',
          name: '@internal/extension-arktype-json',
          entry: '',
        },
      ],
      peerShells: ['@prisma/orm-target-postgres'],
    },
  ],
  [
    '@prisma/orm-extension-middleware-cache',
    {
      dir: 'packages/9-public/@prisma/orm-extension-middleware-cache',
      kind: 'extension',
      packages: [
        {
          dir: 'packages/3-extensions/middleware-cache',
          name: '@internal/middleware-cache',
          entry: '',
        },
      ],
    },
  ],
]);

/** Export subpaths that never ship in a shell (test-only surfaces). */
export const excludedSubpaths: readonly RegExp[] = [/^\.\/test(\/|$)/];
