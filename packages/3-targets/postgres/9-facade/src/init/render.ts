import { readFileSync } from 'node:fs';
import { join } from 'pathe';

export function renderTemplate(
  templateFile: string,
  vars: Readonly<Record<string, string>>,
): string {
  let result = readFileSync(join(import.meta.dirname, templateFile), 'utf-8');
  for (const [key, value] of Object.entries(vars)) {
    result = result.replaceAll(`{{${key}}}`, value);
  }
  return result;
}
