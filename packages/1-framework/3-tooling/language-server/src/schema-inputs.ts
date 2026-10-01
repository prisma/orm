import { normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expandContractInputs } from '@internal/config-loader';
import { isPrismaNextSchema } from '@internal/psl-parser';

export interface SchemaInputConfig {
  readonly contract?: {
    readonly source: {
      readonly format?: string;
      readonly inputs?: readonly string[];
    };
  };
}

export interface SchemaInputSet {
  includes(uri: string): boolean;
  uris(): Iterable<string>;
}

export function hasPslInputs(config: SchemaInputConfig): boolean {
  const source = config.contract?.source;
  return source?.format === 'psl' && source.inputs !== undefined;
}

export async function resolveSchemaInputs(
  config: SchemaInputConfig,
  readText: (uri: string) => string | undefined,
): Promise<SchemaInputSet> {
  const rawInputs = hasPslInputs(config) ? config.contract?.source.inputs : undefined;
  const patterns = rawInputs?.map(toExpandablePath);
  const expanded = await expandContractInputs(patterns);
  const windows = isWindowsPlatform();
  const candidates = expanded.map((path) =>
    normalizeFileUri(pathToFileURL(path, { windows }).toString()),
  );
  const identities = new Set(candidates.map(canonicalFileIdentity));

  function isMember(uri: string): boolean {
    if (!identities.has(canonicalFileIdentity(uri))) {
      return false;
    }
    const text = readText(uri);
    return text !== undefined && isPrismaNextSchema(text);
  }

  return {
    includes: isMember,
    uris: () => candidates.filter(isMember),
  };
}

function toExpandablePath(input: string): string {
  return isFileUri(input) ? fileURLToPath(new URL(input), { windows: isWindowsPlatform() }) : input;
}

export function isWatcherCacheEligible(config: SchemaInputConfig): boolean {
  const patterns = config.contract?.source.inputs;
  return (
    hasPslInputs(config) &&
    patterns !== undefined &&
    patterns.length > 0 &&
    patterns.every(
      (pattern) =>
        /^[A-Za-z0-9_./: *?-]+$/.test(pattern) &&
        !isFileUri(pattern) &&
        pattern.split('/').every((segment) => !segment.includes('**') || segment === '**'),
    )
  );
}

export function toWatcherGlobPattern(pattern: string): string {
  return isWindowsPlatform() ? pattern.replaceAll('\\', '/') : pattern;
}

function isFileUri(input: string): boolean {
  try {
    return new URL(input).protocol === 'file:';
  } catch {
    return false;
  }
}

export function canonicalFileIdentity(uri: string): string {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return uri;
  }
  if (url.protocol !== 'file:') {
    return uri;
  }

  try {
    const windows = isWindowsPlatform();
    const filePath = normalize(fileURLToPath(url, { windows }));
    return windows ? filePath.toLowerCase() : filePath;
  } catch {
    return uri;
  }
}

export function normalizeFileUri(uri: string): string {
  const identity = canonicalFileIdentity(uri);
  return identity === uri
    ? uri
    : pathToFileURL(identity, { windows: isWindowsPlatform() }).toString();
}

function isWindowsPlatform(): boolean {
  return process.platform === 'win32';
}

export const emptySchemaInputSet: SchemaInputSet = {
  includes: () => false,
  uris: () => [],
};
