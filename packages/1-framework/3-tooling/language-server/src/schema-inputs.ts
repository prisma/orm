import { normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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

export function resolveSchemaInputs(config: SchemaInputConfig): SchemaInputSet {
  const inputs = hasPslInputs(config) ? config.contract?.source.inputs : undefined;
  const uris = inputs?.map(configuredInputUri) ?? [];
  const identities = new Set(uris.map(canonicalFileIdentity));

  return {
    includes: (uri) => identities.has(canonicalFileIdentity(uri)),
    uris: () => uris,
  };
}

function configuredInputUri(input: string): string {
  if (isFileUri(input)) {
    return input;
  }
  return pathToFileURL(input, { windows: isWindowsPlatform() }).toString();
}

function isFileUri(input: string): boolean {
  try {
    return new URL(input).protocol === 'file:';
  } catch {
    return false;
  }
}

function canonicalFileIdentity(uri: string): string {
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

function isWindowsPlatform(): boolean {
  return process.platform === 'win32';
}

export const emptySchemaInputSet: SchemaInputSet = {
  includes: () => false,
  uris: () => [],
};
