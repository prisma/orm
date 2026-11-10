type LooseArgument = string | number | boolean | null | object | ((row: Loose, fns: Loose) => unknown);
type Loose = { readonly [key: string]: Loose } & ((...args: readonly LooseArgument[]) => Loose);

interface ClientOptions<C> {
  readonly contract: C;
  readonly url?: string | undefined;
  readonly path?: string;
  readonly cursor?: { readonly batchSize: number };
}

declare module '@prisma/orm-postgres/static' {
  export function contractFromJson<C>(json: unknown): C;
}

declare module '@prisma/orm-sqlite/static' {
  export function contractFromJson<C>(json: unknown): C;
}

declare module '@prisma/orm-mongo/static' {
  export function contractFromJson<C>(json: unknown): C;
  export default function mongoStatic<C>(options: ClientOptions<C>): { readonly enums: Loose };
}

declare module '@prisma/orm-postgres/runtime' {
  export default function postgres<C>(options: ClientOptions<C>): { readonly sql: Loose };
}

declare module '@prisma/orm-sqlite/runtime' {
  export default function sqlite<C>(options: ClientOptions<C>): { readonly sql: Loose };
}

declare module '@prisma/orm-postgres/serverless' {
  export default function postgresServerless<C>(options: ClientOptions<C>): {
    connect(options: { readonly url: string }): Promise<AsyncDisposable & { readonly orm: Loose }>;
  };
}

declare module '@prisma/orm-mongo/query-builder' {
  export function mongoQuery<C>(options: ClientOptions<C>): Loose;
}

declare module '@prisma/orm-postgres/family-runtime' {
  export type SqlMiddleware = Loose;
}

declare module '@prisma/orm-extension-supabase/runtime' {
  export type SupabaseDb<C> = { readonly contract: C };
  export function supabase<C>(
    options: ClientOptions<C> & { readonly jwtSecret: string; readonly middleware: readonly Loose[] },
  ): Promise<SupabaseDb<C>>;
}

declare module '@prisma/orm-postgres/migration' {
  export abstract class Migration<Start, End> {
    readonly endContractJson: unknown;
    get operations(): readonly unknown[];
    addColumn(options: object): unknown;
    dataTransform(
      contract: unknown,
      name: string,
      options: { readonly check: () => unknown; readonly run: () => unknown },
    ): unknown;
  }
  export const MigrationCLI: { run(url: string, migration: unknown): void };
  export function col(name: string, type: string, options: object): object;
}

declare module 'dotenv/config' {}
