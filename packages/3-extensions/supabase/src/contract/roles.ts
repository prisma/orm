import { role } from '@internal/postgres/contract-builder';
import { enumType, member } from '@internal/sql-contract-ts/contract-builder';

/**
 * Supabase's three standard Postgres roles as a Prisma 8 enum — the
 * single source of truth for the role vocabulary. Runtime-only: the shipped
 * contract declares the roles via PSL `role` blocks inside an explicit
 * `namespace unbound { }` block, not through this handle. The runtime
 * (`supabase-runtime.ts`, `supabase.ts`) derives its role type from
 * `SupabaseRole.values` and reads member values through `SupabaseRole.members`
 * instead of raw string literals.
 */
export const SupabaseRole = enumType(
  'SupabaseRole',
  { codecId: 'pg/text@1', nativeType: 'text' },
  member('Anon', 'anon'),
  member('Authenticated', 'authenticated'),
  member('ServiceRole', 'service_role'),
);

export type SupabaseRole = (typeof SupabaseRole)['values'][number];

/** The JWT claim key Supabase stores the Postgres role under. */
export const SUPABASE_JWT_ROLE_CLAIM = 'role';

export function isSupabaseRole(value: string): value is SupabaseRole {
  return SupabaseRole.values.some((role) => role === value);
}

/**
 * Supabase's runtime request roles as `role()` reference handles, for use in
 * a policy's `roles:` list (e.g. `policySelect(Profile, { roles: [anon], … })`).
 * These reference the same role identities `SupabaseRole` declares — Supabase
 * provisions them on every project; referencing one lowers to its bare name,
 * matching PSL's bare-identifier pass-through.
 */
export const anon = role('anon');
export const authenticated = role('authenticated');
