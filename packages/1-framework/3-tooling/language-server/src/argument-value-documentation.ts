import type { ArgType } from '@internal/psl-parser';
import { directArgType } from './attribute-argument-grammar';

export function argumentValueDocumentation(types: readonly ArgType<unknown, never>[]): string {
  const values = new Map<string, string>();
  for (const type of types) collectIdentifierValues(type, values);
  if (values.size === 0) return '';
  return `\n\nAllowed values:\n${[...values].map(([name, documentation]) => `- \`${name}\`: ${documentation}`).join('\n')}`;
}

function collectIdentifierValues(
  param: ArgType<unknown, never>,
  values: Map<string, string>,
): void {
  const type = directArgType(param);
  switch (type.kind) {
    case 'identifier':
      if (!values.has(type.name)) values.set(type.name, type.documentation);
      break;
    case 'oneOf':
      for (const alternative of type.alternatives) collectIdentifierValues(alternative, values);
      break;
    case 'list':
    case 'record':
      collectIdentifierValues(type.of, values);
      break;
    default:
      break;
  }
}
