import { type as arktype } from 'arktype';
import { AppConfigError } from './errors';

const appConfigSchema = arktype({
  DATABASE_URL: 'string',
});

export function loadAppConfig() {
  const result = appConfigSchema({
    DATABASE_URL: process.env['DATABASE_URL'],
  });
  if (result instanceof arktype.errors) {
    const message = result.map((p: { message: string }) => p.message).join('; ');
    throw new AppConfigError(`Invalid app configuration: ${message}`);
  }
  return { databaseUrl: result.DATABASE_URL };
}
