import type { MysqlBinding } from '@internal/driver-mysql/runtime';

export type MysqlBindingInput = { readonly url: string };

export function resolveMysqlBinding(input: MysqlBindingInput): MysqlBinding {
  return { kind: 'url', url: input.url };
}

export function resolveOptionalMysqlBinding(options: {
  readonly url?: string;
}): MysqlBinding | undefined {
  return options.url === undefined ? undefined : { kind: 'url', url: options.url };
}
