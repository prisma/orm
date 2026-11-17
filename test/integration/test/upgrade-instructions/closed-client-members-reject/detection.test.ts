import { describe, expect, it } from 'vitest';
import { detectionPatterns } from '../guide-detections';

const GUIDE_PATHS = {
  app: 'skills/prisma-8/upgrading/app/upgrades/8.0.0-rc.20-to-8.0.0-rc.21/instructions.md',
  extension:
    'skills/prisma-8/upgrading/extension/upgrades/8.0.0-rc.20-to-8.0.0-rc.21/instructions.md',
} as const;

const id = 'client-members-reject-instead-of-throwing';
const ormPackage = ['@prisma', 'orm-postgres'].join('/');
const importsOrm = `import { postgres } from '${ormPackage}/runtime';\n`;

function detects(audience: keyof typeof GUIDE_PATHS, content: string): boolean {
  return detectionPatterns(GUIDE_PATHS[audience], id).some((pattern) => pattern.test(content));
}

describe.each(['app', 'extension'] as const)('the %s detection', (audience) => {
  it.each([
    [
      'an unawaited transaction',
      'try {\n  db.transaction(work);\n} catch (error) {\n  log(error);\n}',
    ],
    ['a one-line try block', 'try { db.transaction(work); } catch (e) {}'],
    [
      'a result kept in a variable',
      'try {\n  const rows = db.query(plan);\n  use(rows);\n} catch {}',
    ],
    ['a returned prepare', 'try {\n  return db.prepare({}, build);\n} catch (e) {}'],
    [
      'a prepared execute after another statement',
      'try {\n  setUp();\n  prepared.execute(tx, params);\n} finally {\n  done();\n}',
    ],
    [
      'a call nested two blocks deep',
      'try {\n  if (a) {\n    if (b) {\n      db.execute(plan);\n    }\n  }\n} catch {}',
    ],
    [
      'an ORM terminal after a chain',
      'try {\n  const user = db.orm.public.User.where({ id }).first();\n} catch {}',
    ],
    ['a returned ORM read', 'try {\n  return db.orm.public.User.all();\n} catch {}'],
    ['an ORM create', "try {\n  db.orm.public.User.create({ name: 'Ada' });\n} catch {}"],
    [
      'an ORM call with a callback filter',
      'try {\n  const u = db.orm.public.User.where((u) => u.id.eq(1)).first();\n} catch {}',
    ],
    [
      'a chain split across lines',
      'try {\n  const u = db.orm.public.User\n    .where({ id })\n    .first();\n} catch {}',
    ],
    ['a call passed to push', 'try {\n  jobs.push(db.execute(plan));\n} catch {}'],
    ['a voided transaction', 'try {\n  void db.transaction(work);\n} catch {}'],
    ['a role-bound client', 'try {\n  userDb.query(plan);\n} catch {}'],
    ['a client on this', "try {\n  this.db.orm.public.User.create({ name: 'Ada' });\n} catch {}"],
  ])('finds %s', (_name, content) => {
    expect(detects(audience, importsOrm + content)).toBe(true);
  });

  it.each([
    ['an awaited query', 'try {\n  await db.query(plan).toArray();\n} catch (error) {}'],
    [
      'an awaited result in a variable',
      'try {\n  const stats = await db.execute(plan);\n} catch {}',
    ],
    ['an awaited ORM read', 'try {\n  await db.orm.public.User.first();\n} catch {}'],
    ['an awaited one-line try block', 'try { await db.transaction(work); } catch {}'],
    ['a call outside try', 'db.transaction(work).catch(handle);'],
    ['a call after the try block', 'try {\n  await setUp();\n} catch {}\ndb.query(plan);'],
    ['another method', 'try {\n  cache.get(key);\n} catch {}'],
    [
      'an awaited chain split across lines',
      'try {\n  const u = await db.orm.public.User\n    .where((u) => u.id.eq(1))\n    .first();\n} catch {}',
    ],
    ['Object.create', 'try {\n  const o = Object.create(proto);\n} catch {}'],
    ['Promise.all', 'try {\n  await x;\n  Promise.all(list);\n} catch {}'],
    ['a cache delete', 'try {\n  cache.delete(key);\n} catch {}'],
    ['a pg pool query', 'try {\n  pool.query(sql);\n} catch {}'],
  ])('skips %s', (_name, content) => {
    expect(detects(audience, importsOrm + content)).toBe(false);
  });

  it('skips a file that imports no @prisma/orm package', () => {
    expect(detects(audience, 'try {\n  db.transaction(work);\n} catch {}')).toBe(false);
  });
});
