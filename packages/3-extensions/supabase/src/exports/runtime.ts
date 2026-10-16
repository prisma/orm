import { supabaseRuntimeDescriptor } from '../runtime/descriptor';

export default supabaseRuntimeDescriptor;

export type { SupabaseExtensionContract } from '../runtime/ext-contract-type';
export type {
  RoleBoundDb,
  ServiceRoleDb,
  SupabaseDb,
  SupabaseInternalDb,
  SupabaseOptions,
  SupabaseTargetId,
} from '../runtime/supabase';
export { default as supabase } from '../runtime/supabase';
export type {
  RoleSession,
  SupabaseRoleBinding,
  SupabaseRuntime,
} from '../runtime/supabase-runtime';
export { SupabaseRuntimeImpl } from '../runtime/supabase-runtime';
