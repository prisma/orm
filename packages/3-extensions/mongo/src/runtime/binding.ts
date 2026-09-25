import { InternalError } from '@internal/utils/internal-error';
import type { MongoClient as MongoDriverClient } from 'mongodb';
import { ConnectionString } from 'mongodb-connection-string-url';
import { mongoError } from './mongo-errors';

export type MongoBinding =
  | { readonly kind: 'url'; readonly url: string; readonly dbName: string }
  | {
      readonly kind: 'mongoClient';
      readonly client: MongoDriverClient;
      readonly dbName: string;
    };

export type MongoBindingInput =
  | {
      readonly binding: MongoBinding;
      readonly url?: never;
      readonly uri?: never;
      readonly dbName?: never;
      readonly mongoClient?: never;
    }
  | {
      readonly url: string;
      readonly dbName?: string;
      readonly binding?: never;
      readonly uri?: never;
      readonly mongoClient?: never;
    }
  | {
      readonly uri: string;
      readonly dbName: string;
      readonly binding?: never;
      readonly url?: never;
      readonly mongoClient?: never;
    }
  | {
      readonly mongoClient: MongoDriverClient;
      readonly dbName: string;
      readonly binding?: never;
      readonly url?: never;
      readonly uri?: never;
    };

type MongoBindingFields = {
  readonly binding?: MongoBinding;
  readonly url?: string;
  readonly uri?: string;
  readonly dbName?: string;
  readonly mongoClient?: MongoDriverClient;
};

const URL_SCHEME_PATTERN = /^([a-z][a-z\d+.-]*):\/\//i;
const MONGO_SCHEMES = new Set(['mongodb', 'mongodb+srv']);

function validateMongoUrl(url: string): ConnectionString {
  const trimmed = url.trim();
  if (trimmed.length === 0) {
    throw mongoError('RUNTIME.BINDING_INVALID', 'Mongo URL must be a non-empty string');
  }

  const scheme = URL_SCHEME_PATTERN.exec(trimmed)?.[1];
  if (scheme === undefined) {
    throw mongoError('RUNTIME.BINDING_INVALID', 'Mongo URL must be a valid URL');
  }
  if (!MONGO_SCHEMES.has(scheme)) {
    throw mongoError('RUNTIME.BINDING_INVALID', 'Mongo URL must use mongodb:// or mongodb+srv://');
  }

  try {
    return new ConnectionString(trimmed);
  } catch {
    throw mongoError('RUNTIME.BINDING_INVALID', 'Mongo URL must be a valid URL');
  }
}

function extractDbNameFromUrl(parsed: ConnectionString): string | undefined {
  // pathname is "/dbname" or "/". Anything past a second slash is invalid
  // for our purposes (auth-source style paths).
  const [encodedDbName = ''] = parsed.pathname.slice(1).split('/');
  if (encodedDbName.length === 0) {
    return undefined;
  }
  // The driver decodes the path too; the control plane uses the name it produces.
  try {
    return decodeURIComponent(encodedDbName);
  } catch {
    throw mongoError('RUNTIME.BINDING_INVALID', 'Mongo URL must be a valid URL');
  }
}

export function resolveMongoBinding(options: MongoBindingInput): MongoBinding {
  const providedCount =
    Number(options.binding !== undefined) +
    Number(options.url !== undefined) +
    Number(options.uri !== undefined) +
    Number(options.mongoClient !== undefined);

  if (providedCount !== 1) {
    throw mongoError(
      'RUNTIME.BINDING_INVALID',
      'Provide one binding input: binding, url, uri+dbName, or mongoClient+dbName',
      { meta: { received: providedCount } },
    );
  }

  if (options.binding !== undefined) {
    return options.binding;
  }

  if (options.url !== undefined) {
    const parsed = validateMongoUrl(options.url);
    // An explicit, whitespace-only `dbName` is a user-error we'd rather
    // surface loudly: silently falling back to the URL path would mask
    // a typo or empty-template-string bug. Treat it the same as the
    // `{ uri, dbName }` and `{ mongoClient, dbName }` paths, where an
    // empty trimmed dbName is already a fast failure.
    if (options.dbName !== undefined && options.dbName.trim().length === 0) {
      throw mongoError(
        'RUNTIME.BINDING_INVALID',
        'Mongo binding via { url, dbName } requires a non-empty dbName',
      );
    }
    const explicitDbName = options.dbName?.trim();
    const dbName =
      explicitDbName !== undefined && explicitDbName.length > 0
        ? explicitDbName
        : extractDbNameFromUrl(parsed);
    if (dbName === undefined || dbName.length === 0) {
      throw mongoError(
        'RUNTIME.BINDING_INVALID',
        'Mongo URL must include a database name in its path (e.g. mongodb://host:27017/mydb), or pass dbName explicitly',
      );
    }
    return { kind: 'url', url: options.url.trim(), dbName };
  }

  if (options.uri !== undefined) {
    validateMongoUrl(options.uri);
    const dbName = options.dbName?.trim();
    if (dbName === undefined || dbName.length === 0) {
      throw mongoError(
        'RUNTIME.BINDING_INVALID',
        'Mongo binding via { uri, dbName } requires a non-empty dbName',
      );
    }
    return { kind: 'url', url: options.uri.trim(), dbName };
  }

  const mongoClient = options.mongoClient;
  if (mongoClient === undefined) {
    throw new InternalError('Invariant violation: expected mongo binding after validation');
  }
  const dbName = options.dbName?.trim();
  if (dbName === undefined || dbName.length === 0) {
    throw mongoError(
      'RUNTIME.BINDING_INVALID',
      'Mongo binding via { mongoClient, dbName } requires a non-empty dbName',
    );
  }
  return { kind: 'mongoClient', client: mongoClient, dbName };
}

export function resolveOptionalMongoBinding(options: MongoBindingFields): MongoBinding | undefined {
  const providedCount =
    Number(options.binding !== undefined) +
    Number(options.url !== undefined) +
    Number(options.uri !== undefined) +
    Number(options.mongoClient !== undefined);

  if (providedCount === 0) {
    return undefined;
  }
  // Defer the "exactly one" enforcement to `resolveMongoBinding`. We call it
  // through a single branch per input field so the matching union member of
  // `MongoBindingInput` is constructed explicitly — the previous
  // `options as MongoBindingInput` cast hid drift between `MongoBindingFields`
  // (any combination of optional inputs) and `MongoBindingInput` (exactly one).
  if (providedCount !== 1) {
    throw mongoError(
      'RUNTIME.BINDING_INVALID',
      'Provide one binding input: binding, url, uri+dbName, or mongoClient+dbName',
      { meta: { received: providedCount } },
    );
  }
  if (options.binding !== undefined) {
    return resolveMongoBinding({ binding: options.binding });
  }
  if (options.url !== undefined) {
    return resolveMongoBinding(
      options.dbName !== undefined
        ? { url: options.url, dbName: options.dbName }
        : { url: options.url },
    );
  }
  if (options.uri !== undefined) {
    return resolveMongoBinding({ uri: options.uri, dbName: options.dbName ?? '' });
  }
  if (options.mongoClient !== undefined) {
    return resolveMongoBinding({
      mongoClient: options.mongoClient,
      dbName: options.dbName ?? '',
    });
  }
  // Unreachable: the `providedCount === 1` guard above plus the four
  // branch checks cover every shape of `MongoBindingFields`. A bare
  // `return undefined` here would silently mask a future
  // `MongoBindingFields` extension that adds a fifth input, so we
  // surface it as an invariant rather than a missing binding.
  throw new InternalError('Invariant violation: expected one mongo binding branch');
}
