// The decisions of the audit. `build-audit.mjs` joins them with the import census and writes ../audit.md.
// Each rule is [pattern, decision, reason]; the first rule whose pattern matches a path decides it.

export const gaPackages = [
  '@prisma/orm-postgres',
  '@prisma/orm-framework',
  '@prisma/orm-family-sql',
  '@prisma/orm-target-postgres',
  '@prisma/orm-toolchain',
  '@prisma/orm-extension-pgvector',
  '@prisma/orm-extension-postgis',
  '@prisma/orm-extension-arktype-json',
  '@prisma/orm-postgres-contrib',
  '@prisma/orm-extension-middleware-cache',
  '@prisma/orm-better-auth',
];

const own = 'the facade’s own code';
const stored = 'files that earlier releases wrote into users’ repositories import it';

/** Rules for every facade. Written for `@prisma/orm-postgres`; the same list of forwarded platform paths applies to the others. */
export const facadeRules = [
  [
    /^internal\//,
    'remove',
    'named "internal"; the parts the Supabase extension uses get Early Access names on `runtime` and `static`',
  ],
  [
    /^(config|contract-builder|control|runtime|serverless|static)$/,
    'keep',
    `${own}: what an application imports to configure, define a contract, connect and query`,
  ],
  [/^contract-types$/, 'keep', `${own}: the one module a generated \`contract.d.ts\` imports`],
  [/^migration$/, 'keep', `${own}: the module a generated migration file imports`],
  [/^init$/, 'keep', `${own}: \`prisma orm init\` loads it by name`],
  [/^(family|target)$/, 'keep', `${own}: the pack a TypeScript contract names`],
  [/^utils(\/|$)/, 'remove', 'general helpers; no application needs Prisma for them'],
  [/^family-runtime\/internal\//, 'remove', 'named "internal"; no application imports it'],
  [/^contract\/types$/, 'keep', stored],
  [/^family-contract\/types$/, 'keep', stored],
  [/^target\/(codec-types|operation-types)$/, 'keep', stored],
  [/^target\/migration$/, 'keep', stored],
  [
    /^(target\/planner-target-details|family\/control)$/,
    'keep',
    'a generated migration file of a contract space imports it',
  ],
  [/^adapter\/column-types$/, 'keep', 'a TypeScript contract imports its column types; documented'],
  [/^target\/full-text$/, 'keep', 'full-text search in queries; documented'],
  [
    /^target\/codec-ids$/,
    'keep',
    'an application names a codec id when it passes a typed raw parameter; documented',
  ],
  [
    /^target\/runtime$/,
    'keep',
    'an application that loads its contract in the browser or a worker uses the contract serializer',
  ],
  [
    /^orm-client$/,
    'keep',
    'the types an application names for collections and query results; documented',
  ],
  [
    /^family-runtime$/,
    'keep',
    'middleware, transactions and execution types an application names; documented',
  ],
  [/^builder\/(types|runtime)$/, 'keep', 'the SQL builder’s types and entry; documented'],
  [
    /^components\/runtime$/,
    'keep',
    'the types an application names when it writes middleware; documented',
  ],
  [/^vite-plugin-contract-emit$/, 'keep', 'the Vite plugin; documented'],
  [
    /^migration-tools\/(aggregate|hash|io|spaces)$/,
    'keep',
    'an application that checks its own migrations or stages an extension’s migrations reads the on-disk format (the decision record on the published packages)',
  ],
  [
    /^(adapter|driver|target)\/control$/,
    'remove',
    'parts of a control stack built by hand; `control` gives the assembled client',
  ],
  [
    /./,
    'remove',
    'no application, generator or document uses it; an extension author imports the platform package',
  ],
];

/** Per-package overrides for the platform and extension packages, applied before the evidence-based default. */
export const overrides = {
  '@prisma/orm-family-sql': [
    [
      /^runtime\/internal\/prepared-query$/,
      'rename',
      'named "internal"; the Supabase extension needs it, so its exports move to `runtime` with the Early Access prefix',
    ],
  ],
  '@prisma/orm-framework': [
    [
      /^utils\/internal-error$/,
      'rename',
      'named "internal"; the path and its `InternalError` class get a name without the word',
    ],
  ],
  '@prisma/orm-target-postgres': [
    [
      /^target\/prisma7-binding$/,
      'keep',
      'the PostgreSQL facade’s Prisma 7 config imports it across the package boundary',
    ],
  ],
};
