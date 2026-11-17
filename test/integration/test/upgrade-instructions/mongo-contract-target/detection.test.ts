import { describe, expect, it } from 'vitest';
import { detectionPatterns } from '../guide-detections';

const APP_GUIDE =
  'skills/prisma-8/upgrading/app/upgrades/8.0.0-rc.20-to-8.0.0-rc.21/instructions.md';

const EXTENSION_GUIDE =
  'skills/prisma-8/upgrading/extension/upgrades/8.0.0-rc.20-to-8.0.0-rc.21/instructions.md';

function patternsOf(audience: string, id: string): readonly RegExp[] {
  return detectionPatterns(audience === 'app' ? APP_GUIDE : EXTENSION_GUIDE, id);
}

describe.each(['app', 'extension'])('the %s mongo-contract-target detection', (audience) => {
  const matches = (content: string) =>
    patternsOf(audience, 'mongo-contract-target-option').some((pattern) => pattern.test(content));

  it('matches a mongoContract call without a target until it passes one', () => {
    expect([
      matches("const contract = mongoContract('./prisma/schema.prisma');"),
      matches('mongoContract("./schema.prisma",)'),
      matches("mongoContract(schemaPath, { output: 'out/contract.json' })"),
      matches('mongoContract(schemaPath)'),
      matches("mongoContract(join(dir, 'schema.prisma'))"),
      matches("mongoContract(join(dir, 'schema.prisma'), { output: 'out' })"),
      matches("mongoContract('./schema.prisma', { target: mongoTargetPack })"),
      matches("mongoContract(join(dir, 'schema.prisma'), { target: mongoTargetPack })"),
      matches(
        "mongoContract(schemaPath, {\n  output: 'out/contract.json',\n  target: mongoTargetPack,\n})",
      ),
      matches('mongoContract(schemaPath, options)'),
      matches("mongoContract(join(dir, 'schema.prisma'), config.contract)"),
    ]).toEqual([true, true, true, true, true, true, false, false, false, true, true]);
  });

  it('does not match a call of another function that ends in mongoContract', () => {
    expect(matches("prisma6mongoContract('./schema.prisma')")).toBe(false);
  });
});
