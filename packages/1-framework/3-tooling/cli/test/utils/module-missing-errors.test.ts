import { describe, expect, it } from 'vitest';
import {
  errorContractTypesModuleMissing,
  errorMigrationModuleMissing,
} from '../../src/utils/cli-errors';

describe('the errors for a config that names no generated-file module', () => {
  it.each([
    ['contract.typesModule', errorContractTypesModuleMissing()],
    ['migrations.module', errorMigrationModuleMissing()],
  ])(
    'say what to do with a hand-assembled config and with a target package too old to set %s',
    (member, error) => {
      expect(error.fix).toContain(`A config assembled by hand sets \`${member}\``);
      expect(error.fix).toContain(
        "If the config comes from a target package's `defineConfig`, that package is older than",
      );
    },
  );
});
