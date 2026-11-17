import { existsSync, readFileSync, rmSync } from 'node:fs';

interface Queryable {
  query(sql: string, params?: readonly unknown[]): Promise<unknown>;
}

interface DriverDescriptor<TDriver extends Queryable> {
  create(location: string): Promise<TDriver>;
}

/**
 * Wraps a control driver so that, before the first transaction it opens, it runs the statement a test wrote to `raceFile` and deletes the file. It stands for another process, such as `migrate`, committing a change while a command runs.
 */
export function racingDriver<
  TDriver extends Queryable,
  TDescriptor extends DriverDescriptor<TDriver>,
>(descriptor: TDescriptor, raceFile: URL): TDescriptor {
  return {
    ...descriptor,
    async create(location: string) {
      const driver = await descriptor.create(location);
      const race = async () => {
        if (!existsSync(raceFile)) return;
        const { sql, params } = JSON.parse(readFileSync(raceFile, 'utf-8'));
        rmSync(raceFile);
        await driver.query(sql, params);
      };
      return new Proxy(driver, {
        get(target, property) {
          const value = Reflect.get(target, property, target);
          if (property === 'query') {
            return async (sql: string, params?: readonly unknown[]) => {
              if (sql.startsWith('BEGIN')) await race();
              return target.query(sql, params);
            };
          }
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    },
  };
}
