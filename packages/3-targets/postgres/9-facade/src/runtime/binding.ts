import {
  createPgPool,
  type PostgresBinding as DriverPostgresBinding,
  suppressIdleConnectionErrors,
} from '@internal/driver-postgres/runtime';
import postgresTarget from '@internal/target-postgres/runtime';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { InternalError } from '@internal/utils/internal-error';
import type { Client, Pool } from 'pg';
import { postgresError } from '../errors';
import { DEFAULT_CONNECT_TIMEOUT_MILLIS, type PostgresPoolOptions } from './postgres-options';

export const isPgPool = (pg: Pool | Client): pg is Pool =>
  'totalCount' in pg && 'idleCount' in pg && 'waitingCount' in pg;

export const isPgClient = (pg: Pool | Client): pg is Client =>
  'escapeIdentifier' in pg && 'escapeLiteral' in pg;

export type PostgresBinding =
  | { readonly kind: 'url'; readonly url: string }
  | { readonly kind: 'pgPool'; readonly pool: Pool }
  | { readonly kind: 'pgClient'; readonly client: Client };

export type PostgresBindingInput =
  | {
      readonly binding: PostgresBinding;
      readonly url?: never;
      readonly pg?: never;
    }
  | {
      readonly url: string;
      readonly binding?: never;
      readonly pg?: never;
    }
  | {
      readonly pg: Pool | Client;
      readonly binding?: never;
      readonly url?: never;
    };

type PostgresBindingFields = {
  readonly binding?: PostgresBinding;
  readonly url?: string;
  readonly pg?: Pool | Client;
};

export function validatePostgresUrl(url: string, extension = 'postgres'): string {
  const trimmed = url.trim();
  if (trimmed.length === 0) {
    throw postgresError('RUNTIME.BINDING_INVALID', 'Postgres URL must be a non-empty string', {
      meta: { extension, reason: 'empty url' },
    });
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw postgresError('RUNTIME.BINDING_INVALID', 'Postgres URL must be a valid URL', {
      meta: { extension, reason: 'unparseable url' },
    });
  }

  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    const hasScheme = trimmed.toLowerCase().startsWith(`${parsed.protocol}//`);
    throw postgresError(
      'RUNTIME.BINDING_INVALID',
      'Postgres URL must use postgres:// or postgresql://',
      {
        meta: {
          extension,
          reason: 'wrong scheme',
          ...ifDefined('received', hasScheme ? parsed.protocol : undefined),
        },
      },
    );
  }

  return trimmed;
}

function typeOfInput(value: unknown): string {
  return value === null ? 'null' : typeof value;
}

function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null;
}

type BindingKind = PostgresBinding['kind'];

/** The binding kinds a client accepts, and the extension its errors name. A binding of another kind fails with `RUNTIME.BINDING_INVALID`. */
export interface PostgresBindingRules {
  readonly extension: string;
  readonly kinds: Readonly<Partial<Record<BindingKind, true>>>;
}

const postgresBindingKinds: Readonly<Record<PostgresBinding['kind'], true>> = {
  url: true,
  pgPool: true,
  pgClient: true,
};

export const postgresBindingRules: PostgresBindingRules = {
  extension: 'postgres',
  kinds: postgresBindingKinds,
};

const bindingForms: Record<BindingKind, string> = {
  url: "{ kind: 'url', url }",
  pgPool: "{ kind: 'pgPool', pool }",
  pgClient: "{ kind: 'pgClient', client }",
};

function isBindingKind(kind: unknown): kind is BindingKind {
  return typeof kind === 'string' && Object.hasOwn(bindingForms, kind);
}

const pgObjectNames: Partial<Record<BindingKind, string>> = {
  pgPool: 'pg.Pool',
  pgClient: 'pg.Client',
};

function orList(items: readonly string[]): string {
  return items.length < 2
    ? items.join('')
    : `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`;
}

interface BindingWording {
  readonly extension: string;
  readonly kinds: string;
  readonly forms: string;
  readonly pgForms: string;
  readonly pgObjects: string;
  readonly pgObjectsEach: string;
}

function wordingOf(rules: PostgresBindingRules): BindingWording {
  const kinds = Object.keys(bindingForms)
    .filter(isBindingKind)
    .filter((kind) => rules.kinds[kind] === true);
  const pgKinds = kinds.filter((kind) => pgObjectNames[kind] !== undefined);
  const pgNames = pgKinds.flatMap((kind) => pgObjectNames[kind] ?? []);
  return {
    extension: rules.extension,
    kinds: orList(kinds.map((kind) => `'${kind}'`)),
    forms: orList(kinds.map((kind) => bindingForms[kind])),
    pgForms: orList(pgKinds.map((kind) => `binding: ${bindingForms[kind]}`)),
    pgObjects: orList(pgNames),
    pgObjectsEach: orList(pgNames.map((name) => `a ${name}`)),
  };
}

function invalidInput(
  wording: BindingWording,
  input: {
    readonly name: string;
    readonly value: unknown;
    readonly expected: string;
    readonly reason: string;
  },
  message: string,
  fix: string,
): Error {
  const receivedType = typeOfInput(input.value);
  return postgresError('RUNTIME.BINDING_INVALID', message, {
    why: `The ${input.name} is ${receivedType === 'null' ? 'null' : `a ${receivedType}`}, and it must be ${input.expected}.`,
    fix,
    meta: { extension: wording.extension, reason: input.reason, receivedType },
  });
}

const echoableKind = /^[A-Za-z_][A-Za-z0-9_]{0,31}$/;

function describeUnknownKind(kind: unknown): {
  readonly why: string;
  readonly received: { readonly receivedKind: string } | { readonly receivedType: string };
} {
  if (kind === undefined) {
    return {
      why: 'The binding option has no kind, so it names no database.',
      received: { receivedKind: 'undefined' },
    };
  }
  if (typeof kind === 'string' && echoableKind.test(kind)) {
    return {
      why: `The binding option has kind '${kind}', which is not a binding kind this client takes.`,
      received: { receivedKind: kind },
    };
  }
  const receivedType = typeOfInput(kind);
  return {
    why:
      typeof kind === 'string'
        ? 'The binding option has a kind that is a string not in the list of binding kinds.'
        : `The binding option has kind of type ${receivedType}, which is not a binding kind.`,
    received: typeof kind === 'string' ? { receivedType } : { receivedKind: receivedType },
  };
}

function unknownKindError(wording: BindingWording, kind: unknown): Error {
  const { why, received } = describeUnknownKind(kind);
  return postgresError(
    'RUNTIME.BINDING_INVALID',
    `The binding option must have kind ${wording.kinds}`,
    {
      why,
      fix: `Pass binding: ${wording.forms}.`,
      meta: { extension: wording.extension, reason: 'unknown binding kind', ...received },
    },
  );
}

function checkInputTypes(
  options: PostgresBindingFields,
  rules: PostgresBindingRules,
  wording: BindingWording,
): void {
  const binding: unknown = options.binding;
  const url: unknown = options.url;
  const pg: unknown = options.pg;
  if (binding !== undefined && !isObject(binding)) {
    throw invalidInput(
      wording,
      {
        name: 'binding option',
        value: binding,
        expected: 'an object with a kind',
        reason: 'invalid binding input',
      },
      'The binding option must be an object with a kind',
      `Pass binding: ${wording.forms}.`,
    );
  }
  if (url !== undefined && typeof url !== 'string') {
    throw invalidInput(
      wording,
      {
        name: 'url option',
        value: url,
        expected: 'a connection string',
        reason: 'invalid url input',
      },
      'The url option must be a string',
      'Pass a postgres:// or postgresql:// connection string as url, and check that the variable it comes from is set.',
    );
  }
  if (pg !== undefined && !isObject(pg)) {
    throw invalidInput(
      wording,
      {
        name: 'pg option',
        value: pg,
        expected: `a ${wording.pgObjects} object`,
        reason: 'invalid pg input',
      },
      `The pg option must be ${wording.pgObjectsEach}`,
      `Pass a ${wording.pgObjects} as pg, or pass a connection string as url.`,
    );
  }
  if (binding !== undefined) {
    const kind: unknown = 'kind' in binding ? binding.kind : undefined;
    if (!isBindingKind(kind) || rules.kinds[kind] !== true) throw unknownKindError(wording, kind);
  }
}

function checkBindingContents(binding: PostgresBinding, wording: BindingWording): PostgresBinding {
  if (binding.kind === 'url') {
    const url: unknown = binding.url;
    if (typeof url !== 'string') {
      throw invalidInput(
        wording,
        {
          name: 'url in the binding option',
          value: url,
          expected: 'a connection string',
          reason: 'invalid binding url',
        },
        'The url in the binding option must be a string',
        "Pass binding: { kind: 'url', url } with a postgres:// or postgresql:// connection string, and check that the variable it comes from is set.",
      );
    }
    return { kind: 'url', url: validatePostgresUrl(url, wording.extension) };
  }
  const [name, value]: readonly [string, unknown] =
    binding.kind === 'pgPool' ? ['pool', binding.pool] : ['client', binding.client];
  if (!isObject(value)) {
    const objectName = binding.kind === 'pgPool' ? 'pg.Pool' : 'pg.Client';
    throw invalidInput(
      wording,
      {
        name: `${name} in the binding option`,
        value,
        expected: `a ${objectName}`,
        reason: `invalid binding ${name}`,
      },
      `The ${name} in the binding option must be a ${objectName}`,
      `Pass binding: ${bindingForms[binding.kind]} with a ${objectName}.`,
    );
  }
  return binding;
}

function resolveBinding(
  options: PostgresBindingInput,
  rules: PostgresBindingRules,
): PostgresBinding {
  const wording = wordingOf(rules);
  checkInputTypes(options, rules, wording);
  const binding = resolveInput(options, rules, wording);
  if (rules.kinds[binding.kind] !== true) {
    throw refusedInputError(wording, options.url !== undefined ? 'url' : 'pg', binding.kind);
  }
  return binding;
}

const inputDescriptions: Record<BindingKind, string> = {
  url: 'a connection string',
  pgPool: 'a pg.Pool',
  pgClient: 'a pg.Client',
};

function refusedInputError(
  wording: BindingWording,
  option: 'url' | 'pg',
  kind: BindingKind,
): Error {
  const pgFix = wording.pgObjectsEach === '' ? '' : `${wording.pgObjectsEach} as pg, or `;
  return postgresError(
    'RUNTIME.BINDING_INVALID',
    `The ${option} option is ${inputDescriptions[kind]}, which this client does not take`,
    {
      fix: `Pass ${pgFix}binding: ${wording.forms}.`,
      meta: { extension: wording.extension, reason: `refused ${option} input`, receivedKind: kind },
    },
  );
}

function resolveInput(
  options: PostgresBindingInput,
  rules: PostgresBindingRules,
  wording: BindingWording,
): PostgresBinding {
  const providedCount =
    Number(options.binding !== undefined) +
    Number(options.url !== undefined) +
    Number(options.pg !== undefined);

  if (providedCount !== 1) {
    throw postgresError(
      'RUNTIME.BINDING_INVALID',
      'Provide one binding input: binding, url, or pg',
      {
        fix: 'Pass exactly one of `binding`, `url`, or `pg`.',
        meta: { extension: rules.extension, reason: 'zero or multiple binding inputs' },
      },
    );
  }

  if (options.binding !== undefined) {
    return checkBindingContents(options.binding, wording);
  }

  if (options.url !== undefined) {
    return { kind: 'url', url: validatePostgresUrl(options.url, rules.extension) };
  }

  const pgBinding = options.pg;
  if (pgBinding === undefined) {
    throw new InternalError('Invariant violation: expected pg binding after validation');
  }

  if (isPgPool(pgBinding)) {
    return { kind: 'pgPool', pool: pgBinding };
  }

  if (isPgClient(pgBinding)) {
    return { kind: 'pgClient', client: pgBinding };
  }

  throw postgresError(
    'RUNTIME.BINDING_INVALID',
    'Unable to determine pg binding type from pg input; use binding with explicit kind',
    {
      fix: `Pass ${wording.pgForms} instead of pg.`,
      meta: { extension: rules.extension, reason: 'unrecognizable pg object' },
    },
  );
}

export function resolvePostgresBinding(options: PostgresBindingInput): PostgresBinding {
  return resolveBinding(options, postgresBindingRules);
}

export function resolveOptionalPostgresBinding(
  options: PostgresBindingFields,
  rules: PostgresBindingRules,
): PostgresBinding | undefined {
  const providedCount =
    Number(options.binding !== undefined) +
    Number(options.url !== undefined) +
    Number(options.pg !== undefined);

  if (providedCount === 0) {
    return undefined;
  }

  return resolveBinding(
    blindCast<
      PostgresBindingInput,
      'provided-count validation narrows optional binding fields to one binding input'
    >(options),
    rules,
  );
}

type ConnectedBinding = Exclude<DriverPostgresBinding, { readonly kind: 'url' }>;

function toRuntimeBinding(
  binding: PostgresBinding,
  options: { readonly poolOptions?: PostgresPoolOptions | undefined },
): ConnectedBinding {
  if (binding.kind !== 'url') {
    return { ...binding, ownedByDriver: false };
  }

  return {
    kind: 'pgPool',
    ownedByDriver: true,
    pool: suppressIdleConnectionErrors(
      createPgPool(
        {
          connectionString: binding.url,
          connectionTimeoutMillis:
            options.poolOptions?.connectionTimeoutMillis ?? DEFAULT_CONNECT_TIMEOUT_MILLIS,
          idleTimeoutMillis: options.poolOptions?.idleTimeoutMillis ?? 30_000,
        },
        postgresTarget.sessionSettings ?? {},
      ),
    ),
  } as const;
}

/** Connects `driver` to `binding`, and ends the pool created for a url binding when the connection fails. */
export async function connectWithBinding(
  driver: { connect(binding: DriverPostgresBinding): Promise<void> },
  binding: PostgresBinding,
  options: { readonly poolOptions?: PostgresPoolOptions | undefined },
): Promise<void> {
  const runtimeBinding = toRuntimeBinding(binding, options);
  try {
    await driver.connect(runtimeBinding);
  } catch (error) {
    if (runtimeBinding.kind === 'pgPool' && runtimeBinding.ownedByDriver) {
      await runtimeBinding.pool.end().catch(() => undefined);
    }
    throw error;
  }
}
