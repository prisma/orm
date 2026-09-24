/**
 * Contract completeness — the emitted `contract.json` declares every table,
 * native enum, and role the reference version of Supabase ships in `auth`
 * and `storage`. Table/enum names are hardcoded (not derived from the
 * fixture) so this test pins the reference version
 * (supabase/postgres:17.6.1.106, gotrue v2.188.1, storage-api v1.54.1,
 * captured 2026-07-12 — see `test/fixtures/supabase-reference/schema.sql`)
 * and catches accidental omissions in `contract:generate`'s output.
 */
import { describe, expect, it } from 'vitest';
import contractJson from '../src/contract/contract.json' with { type: 'json' };
import { SupabaseRole } from '../src/contract/roles';

const AUTH_TABLES = [
  'audit_log_entries',
  'custom_oauth_providers',
  'flow_state',
  'identities',
  'instances',
  'mfa_amr_claims',
  'mfa_challenges',
  'mfa_factors',
  'oauth_authorizations',
  'oauth_client_states',
  'oauth_clients',
  'oauth_consents',
  'one_time_tokens',
  'refresh_tokens',
  'saml_providers',
  'saml_relay_states',
  'schema_migrations',
  'sessions',
  'sso_domains',
  'sso_providers',
  'users',
  'webauthn_challenges',
  'webauthn_credentials',
];

const STORAGE_TABLES = [
  'buckets',
  'buckets_analytics',
  'buckets_vectors',
  'iceberg_namespaces',
  'iceberg_tables',
  'migrations',
  'objects',
  's3_multipart_uploads',
  's3_multipart_uploads_parts',
  'vector_indexes',
];

const AUTH_NATIVE_ENUMS = [
  'aal_level',
  'code_challenge_method',
  'factor_status',
  'factor_type',
  'oauth_authorization_status',
  'oauth_client_type',
  'oauth_registration_type',
  'oauth_response_type',
  'one_time_token_type',
];

const STORAGE_NATIVE_ENUMS = ['buckettype'];

const NAMED_TYPES = [
  'CreatedAt',
  'EmailChangeConfirmStatus',
  'Hash',
  'Id',
  'IpAddress',
  'IpAddress2',
  'Name',
  'Parent',
  'Payload',
];

/**
 * Every `CHECK` the reference fixture declares on an `auth` or `storage` table
 * — its 45 `CONSTRAINT … CHECK` names minus `jwt_secret_or_jwt_jwks_required`
 * (`_realtime.tenants`) and `subscription_action_filter_check`
 * (`realtime.subscription`), both in schemas this pack does not declare.
 */
const CHECK_CONSTRAINTS = [
  'custom_oauth_providers_authorization_url_https',
  'custom_oauth_providers_authorization_url_length',
  'custom_oauth_providers_client_id_length',
  'custom_oauth_providers_discovery_url_length',
  'custom_oauth_providers_identifier_format',
  'custom_oauth_providers_issuer_length',
  'custom_oauth_providers_jwks_uri_https',
  'custom_oauth_providers_jwks_uri_length',
  'custom_oauth_providers_name_length',
  'custom_oauth_providers_oauth2_requires_endpoints',
  'custom_oauth_providers_oidc_discovery_url_https',
  'custom_oauth_providers_oidc_issuer_https',
  'custom_oauth_providers_oidc_requires_issuer',
  'custom_oauth_providers_provider_type_check',
  'custom_oauth_providers_token_url_https',
  'custom_oauth_providers_token_url_length',
  'custom_oauth_providers_userinfo_url_https',
  'custom_oauth_providers_userinfo_url_length',
  'domain not empty',
  'entity_id not empty',
  'metadata_url not empty',
  'metadata_xml not empty',
  'oauth_authorizations_authorization_code_length',
  'oauth_authorizations_code_challenge_length',
  'oauth_authorizations_expires_at_future',
  'oauth_authorizations_nonce_length',
  'oauth_authorizations_redirect_uri_length',
  'oauth_authorizations_resource_length',
  'oauth_authorizations_scope_length',
  'oauth_authorizations_state_length',
  'oauth_clients_client_name_length',
  'oauth_clients_client_uri_length',
  'oauth_clients_logo_uri_length',
  'oauth_clients_token_endpoint_auth_method_check',
  'oauth_consents_revoked_after_granted',
  'oauth_consents_scopes_length',
  'oauth_consents_scopes_not_empty',
  'one_time_tokens_token_hash_check',
  'request_id not empty',
  'resource_id not empty',
  'sessions_scopes_length',
  'users_email_change_confirm_status_check',
  'webauthn_challenges_challenge_type_check',
];

/** Every native-enum column whose live default is a cast, read as the member. */
const ENUM_LITERAL_DEFAULTS: Readonly<Record<string, string>> = {
  'auth.oauth_authorizations.response_type': 'code',
  'auth.oauth_authorizations.status': 'pending',
  'auth.oauth_clients.client_type': 'confidential',
  'storage.buckets.type': 'STANDARD',
  'storage.buckets_analytics.type': 'ANALYTICS',
  'storage.buckets_vectors.type': 'VECTOR',
};

/** Every list column that waives the derived element-not-null check. */
const ELEMENT_NOT_NULL_WAIVERS = [
  'auth.custom_oauth_providers.acceptable_client_ids',
  'auth.custom_oauth_providers.scopes',
  'storage.buckets.allowed_mime_types',
  'storage.objects.path_tokens',
];

type ContractJsonColumn = {
  codecId: string;
  default?: { kind: string; value?: unknown };
  noCheck?: readonly string[];
};

type ContractJsonTable = {
  checks?: readonly { name: string }[];
  columns: Record<string, ContractJsonColumn>;
};

type ContractJsonNamespace = {
  entries: {
    table?: Record<string, ContractJsonTable>;
    native_enum?: Record<string, unknown>;
    role?: Record<string, { control: string }>;
  };
};

type ContractJsonStorage = {
  namespaces: Record<string, ContractJsonNamespace>;
  types?: Record<string, unknown>;
};

describe('contract completeness — auth/storage table, native enum, and role sets', () => {
  const storage = contractJson.storage as unknown as ContractJsonStorage;
  const auth = storage.namespaces['auth'];
  const storageNs = storage.namespaces['storage'];
  const unboundNs = storage.namespaces['__unbound__'];

  it('declares all 23 auth tables', () => {
    expect(Object.keys(auth?.entries.table ?? {}).sort()).toEqual([...AUTH_TABLES].sort());
  });

  it('declares all 10 storage tables', () => {
    expect(Object.keys(storageNs?.entries.table ?? {}).sort()).toEqual([...STORAGE_TABLES].sort());
  });

  it('declares all 9 auth native enums', () => {
    expect(Object.keys(auth?.entries.native_enum ?? {}).sort()).toEqual(
      [...AUTH_NATIVE_ENUMS].sort(),
    );
  });

  it('declares the 1 storage native enum', () => {
    expect(Object.keys(storageNs?.entries.native_enum ?? {}).sort()).toEqual(
      [...STORAGE_NATIVE_ENUMS].sort(),
    );
  });

  it('declares the nine curated named types', () => {
    expect(Object.keys(storage.types ?? {}).sort()).toEqual([...NAMED_TYPES].sort());
  });

  const declaredColumns = (['auth', 'storage'] as const).flatMap((namespaceId) =>
    Object.entries(storage.namespaces[namespaceId]?.entries.table ?? {}).flatMap(
      ([tableName, table]) =>
        Object.entries(table.columns).map(([columnName, column]) => ({
          path: `${namespaceId}.${tableName}.${columnName}`,
          column,
        })),
    ),
  );

  it('declares every auth/storage check constraint', () => {
    const names = [auth, storageNs].flatMap((namespace) =>
      Object.values(namespace?.entries.table ?? {}).flatMap((table) =>
        (table.checks ?? []).map((check) => check.name),
      ),
    );
    expect(names.sort()).toEqual([...CHECK_CONSTRAINTS].sort());
  });

  it('reads every native-enum column default as a member literal', () => {
    const declared = Object.fromEntries(
      declaredColumns
        .filter(({ column }) => column.codecId === 'pg/enum@1' && column.default !== undefined)
        .map(({ path, column }) => [path, column.default]),
    );
    expect(declared).toEqual(
      Object.fromEntries(
        Object.entries(ENUM_LITERAL_DEFAULTS).map(([path, value]) => [
          path,
          { kind: 'literal', value },
        ]),
      ),
    );
  });

  it('waives the derived element-not-null check on every list column', () => {
    const declared = Object.fromEntries(
      declaredColumns
        .filter(({ column }) => column.noCheck !== undefined)
        .map(({ path, column }) => [path, column.noCheck]),
    );
    expect(declared).toEqual(
      Object.fromEntries(ELEMENT_NOT_NULL_WAIVERS.map((path) => [path, ['elementNotNull']])),
    );
  });

  it('declares the three platform roles under external control', () => {
    const roles = unboundNs?.entries.role ?? {};
    expect(Object.keys(roles).sort()).toEqual([...SupabaseRole.values].sort());
    for (const roleName of SupabaseRole.values) {
      expect(roles[roleName]?.control).toBe('external');
    }
  });
});
