import { describe, expect, it } from 'vitest';
import { detectionPatterns } from '../guide-detections';

const APP_GUIDE =
  'skills/prisma-8/upgrading/app/upgrades/8.0.0-rc.20-to-8.0.0-rc.21/instructions.md';

const EXTENSION_GUIDE =
  'skills/prisma-8/upgrading/extension/upgrades/8.0.0-rc.20-to-8.0.0-rc.21/instructions.md';

function patternsOf(audience: string, id: string): readonly RegExp[] {
  return detectionPatterns(audience === 'app' ? APP_GUIDE : EXTENSION_GUIDE, id);
}

describe.each(['app', 'extension'])('the %s mongo-definition-names detection', (audience) => {
  const matches = (id: string, content: string) =>
    patternsOf(audience, id).some((pattern) => pattern.test(content));

  it('matches ContractDefinition imported or re-exported from a MongoDB contract builder until it is renamed', () => {
    expect([
      matches(
        'mongo-contract-input',
        "import type { ContractDefinition } from '@prisma/orm-mongo/contract-builder';",
      ),
      matches(
        'mongo-contract-input',
        "import {\n  type ContractDefinition,\n  defineContract,\n} from '@prisma/orm-family-mongo/contract-ts/contract-builder';\ntype Input = ContractDefinition<Family, Target>;",
      ),
      matches(
        'mongo-contract-input',
        "export type { ContractDefinition } from '@prisma/orm-mongo/contract-builder';",
      ),
      matches(
        'mongo-contract-input',
        "import type { ContractInput } from '@prisma/orm-mongo/contract-builder';",
      ),
    ]).toEqual([true, true, true, false]);
  });

  it('does not match the plain-data ContractDefinition, which takes no type parameters', () => {
    expect(
      matches(
        'mongo-contract-input',
        "import type { ContractDefinition } from '@prisma/orm-family-mongo/contract-ts/contract-builder';\nconst definition: ContractDefinition = build();",
      ),
    ).toBe(false);
  });

  it('does not match SQL ContractDefinition', () => {
    expect(
      matches(
        'mongo-contract-input',
        "import type { ContractDefinition } from '@prisma/orm-postgres/contract-builder';",
      ),
    ).toBe(false);
  });

  it('matches MongoModelDefinition until it is replaced', () => {
    expect([
      matches(
        'mongo-model-definition-removed',
        "import type { MongoModelDefinition } from '@prisma/orm-mongo/family-contract';",
      ),
      matches(
        'mongo-model-definition-removed',
        'const model: ContractModel<MongoModelStorage> = user;',
      ),
    ]).toEqual([true, false]);
  });
});
