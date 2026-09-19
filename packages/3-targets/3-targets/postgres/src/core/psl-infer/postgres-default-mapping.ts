import type { DefaultMappingOptions } from '@internal/family-sql/psl-infer';

function formatDbGeneratedAttribute(expression: string): string {
  return `@default(dbgenerated(${JSON.stringify(expression)}))`;
}

export function createPostgresDefaultMapping(): DefaultMappingOptions {
  return {
    fallbackFunctionAttribute: formatDbGeneratedAttribute,
  };
}
