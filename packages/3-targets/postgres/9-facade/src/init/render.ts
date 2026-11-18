import { readFileSync } from 'node:fs';
import { join } from 'pathe';

/**
 * Fills each `{{name}}` of the template in one pass, so a value is inserted as it is: a value
 * holding `$&` or another placeholder is not read again.
 */
export function renderTemplate(
  templateFile: string,
  vars: Readonly<Record<string, string>>,
): string {
  const template = readFileSync(join(import.meta.dirname, templateFile), 'utf-8');
  return template.replace(/\{\{(\w+)\}\}/g, (placeholder, name: string) =>
    Object.hasOwn(vars, name) ? (vars[name] ?? placeholder) : placeholder,
  );
}
