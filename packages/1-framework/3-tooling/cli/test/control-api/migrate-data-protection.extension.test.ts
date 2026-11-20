import { afterEach, describe, expect, it } from 'vitest';
import {
  AUDIT_MIGRATION,
  AUDIT_SPACE,
  CREATE_TABLE,
  DATA_LOSS_FORBIDDEN,
  DROP_AUDIT,
  forbidding,
  migrate,
  removeProjectDirs,
} from './migrate-data-protection.fixtures';

const KEEP_EXTENSION_DATA = `This database's data protection policy forbids losing data, so these operations cannot run on it. Contract space "${AUDIT_SPACE}" belongs to an extension, so do not edit or delete its migrations; ask the extension's author for a version without the operation. To do it anyway, whoever owns the database must first change its data protection policy.`;

afterEach(removeProjectDirs);

describe("executeMigrate, data protection, an extension space's migration", () => {
  it('refuses a migration of an extension space that loses data, naming the space', async () => {
    const { result, runnerCalls } = await migrate({
      appOps: [CREATE_TABLE],
      markers: forbidding(DATA_LOSS_FORBIDDEN),
      withAuditSpace: true,
    });

    expect(result.ok ? undefined : result.failure.toEnvelope()).toMatchObject({
      fix: KEEP_EXTENSION_DATA,
      meta: {
        operations: [
          {
            setting: 'dataLoss',
            spaceId: AUDIT_SPACE,
            migration: AUDIT_MIGRATION,
            operationId: DROP_AUDIT.id,
          },
        ],
      },
    });
    expect(runnerCalls).toEqual([]);
  });
});
