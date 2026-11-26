import type { ImportRequirement } from '@internal/ts-render';
import { type } from 'arktype';
import { errorInitContributionUnavailable } from './errors';
import type { ConfigExpression, ContractEntryInput, InitContribution } from './init-contribution';
import type { TargetPackage } from './target-packages';
import { defaultContractEntry } from './templates/code-templates';

const ConfigExpressionSchema = type({
  renderTypeScript: 'Function',
  importRequirements: 'Function',
});

const RenderedSchema = type(/\S/);

const ImportRequirementsSchema = type({
  moduleSpecifier: /\S/,
  symbol: /\S/,
  'kind?': "'named'|'default'",
  'attributes?': 'Record<string, string>',
  'alias?': 'string',
  'typeOnly?': 'boolean',
}).array();

/**
 * The contribution's `contract:` entry for `input`, or the CLI's own when it gives none. The
 * contribution comes from another package, so what it returns is checked here and kept as checked.
 */
export function contractEntryFor(
  contribution: InitContribution,
  input: ContractEntryInput,
  target: TargetPackage,
): ConfigExpression {
  if (contribution.contractEntry === undefined) {
    return defaultContractEntry(contribution.configModule, input);
  }
  const malformed = (detail: string) =>
    errorInitContributionUnavailable({
      packageName: target.packageName,
      reason: 'invalid-shape',
      detail: `its contractEntry returned ${detail}`,
      unlisted: target.listed === undefined,
      missingPeers: [],
      missingPeersCommand: undefined,
    });

  const returned: unknown = contribution.contractEntry(input);
  const expression = ConfigExpressionSchema(returned);
  if (expression instanceof type.errors) {
    throw malformed(
      `a value without renderTypeScript and importRequirements methods (${expression.summary})`,
    );
  }
  const rendered: unknown = expression.renderTypeScript();
  const source = RenderedSchema(rendered);
  if (source instanceof type.errors) {
    throw malformed(`an expression whose renderTypeScript() gave no text (${source.summary})`);
  }
  const listed: unknown = expression.importRequirements();
  const imports = ImportRequirementsSchema(listed);
  if (imports instanceof type.errors) {
    throw malformed(`an expression whose importRequirements() are malformed (${imports.summary})`);
  }
  const requirements: readonly ImportRequirement[] = imports;
  return {
    renderTypeScript: () => source,
    importRequirements: () => requirements,
  };
}
