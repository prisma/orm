import { describe, expect, it } from 'vitest';
import { detectionPatterns } from '../guide-detections';

const GUIDE_PATHS = {
  app: 'skills/prisma-8/upgrading/app/upgrades/8.0.0-rc.19-to-8.0.0-rc.20/instructions.md',
  extension:
    'skills/prisma-8/upgrading/extension/upgrades/8.0.0-rc.19-to-8.0.0-rc.20/instructions.md',
} as const;

function detectionOf(audience: keyof typeof GUIDE_PATHS, id: string): readonly RegExp[] {
  return detectionPatterns(GUIDE_PATHS[audience], id);
}

function detects(audience: keyof typeof GUIDE_PATHS, id: string, content: string): boolean {
  return detectionOf(audience, id).some((pattern) => pattern.test(content));
}

describe.each(['app', 'extension'] as const)('the %s guide', (audience) => {
  describe('supabase-for-role-replaces-with-role-methods', () => {
    const id = 'supabase-for-role-replaces-with-role-methods';

    it.each([
      ['queryWithRole', 'runtime.queryWithRole(plan, { role: "anon" })'],
      ['executeWithRole', 'await rt.executeWithRole(plan, binding)'],
      ['preparedQueryWithRole', 'runtime.preparedQueryWithRole(statement, params, binding)'],
      [
        'preparedExecuteWithRole',
        'runtime\n  .preparedExecuteWithRole(statement, params, binding)',
      ],
      ['roleActivitySource', 'runtime.roleActivitySource(binding).startActivity(call)'],
    ])('finds %s', (_name, content) => {
      expect(detects(audience, id, content)).toBe(true);
    });

    it.each([
      ['forRole', 'runtime.forRole(binding).query(plan)'],
      ['a function of a similar name', 'queryWithRoles(plan)'],
      ['a property that is not called', 'const name = "queryWithRole";'],
    ])('skips %s', (_name, content) => {
      expect(detects(audience, id, content)).toBe(false);
    });
  });

  describe('supabase-role-types-gain-members', () => {
    const id = 'supabase-role-types-gain-members';

    it.each([
      ['RoleBoundDb', 'const user: RoleBoundDb<Contract> = fakeUser();'],
      ['ServiceRoleDb', 'let admin: ServiceRoleDb<Contract>;'],
      ['SupabaseTransactionContext', '(tx: SupabaseTransactionContext<Contract>) => tx.orm'],
      ['SupabaseRuntime', 'function fakeRuntime(): SupabaseRuntime {'],
    ])('finds %s', (_name, content) => {
      expect(detects(audience, id, content)).toBe(true);
    });

    it.each([
      ['SupabaseRuntimeImpl', 'new SupabaseRuntimeImpl(options)'],
      ['a longer name', 'type MyRoleBoundDbFactory = () => void;'],
      ['SupabaseDb', 'const db: SupabaseDb<Contract> = await supabase(options);'],
    ])('skips %s', (_name, content) => {
      expect(detects(audience, id, content)).toBe(false);
    });
  });

  describe('supabase-pg-takes-a-pool', () => {
    const id = 'supabase-pg-takes-a-pool';

    it.each([
      [
        'a pg.Client',
        'await supabase({ contract, pg: new Client({ connectionString }), jwtSecret })',
      ],
      ['shorthand', 'const db = await supabase({ contract, jwtSecret, pg });'],
      [
        'a multi-line call with nested options',
        'await supabase<Contract>({\n  contract,\n  poolOptions: { idleTimeoutMillis: 1 },\n  pg: client,\n})',
      ],
      ['a pg.Pool, which the agent inspects and skips', 'supabase({ contract, pg: pool })'],
    ])('finds %s', (_name, content) => {
      expect(detects(audience, id, content)).toBe(true);
    });

    it.each([
      ['a url', 'await supabase({ contract, url, jwtSecret })'],
      ['postgres()', 'postgres({ contract, pg: client })'],
      ['a member access named pg', 'supabase({ contract, url: config.pg })'],
      ['an option that starts with pg', 'supabase({ contract, url, pgOptions: {} })'],
      ['a method of the same name', 'factory.supabase({ contract, pg: client })'],
    ])('skips %s', (_name, content) => {
      expect(detects(audience, id, content)).toBe(false);
    });
  });
});

describe('the extension guide', () => {
  const id = 'raw-connection-obeys-close';

  it('finds a call of acquireRawConnection', () => {
    expect(detects('extension', id, 'const conn = await this.acquireRawConnection();')).toBe(true);
  });

  it('skips a method of a similar name', () => {
    expect(detects('extension', id, 'this.myacquireRawConnection()')).toBe(false);
  });
});
