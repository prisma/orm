import type fc from 'fast-check';

function numberFrom(variable: string): number | undefined {
  const value = process.env[variable];
  return value === undefined || value === '' ? undefined : Number(value);
}

export function runsAreOverridden(): boolean {
  return ['ORM_PATHS_RUNS', 'ORM_PATHS_PATH', 'ORM_PATHS_SEED', 'ORM_PATHS_SCHEMA'].some(
    (variable) => process.env[variable] !== undefined,
  );
}

export function seedOfRun(): number {
  return numberFrom('ORM_PATHS_SEED') ?? 1;
}

export function propertyOptions(defaultRuns: number, seed: number): fc.Parameters<unknown> {
  const path = process.env['ORM_PATHS_PATH'];
  return {
    numRuns: numberFrom('ORM_PATHS_RUNS') ?? defaultRuns,
    seed,
    ...(path === undefined ? {} : { path, endOnFailure: true }),
    ...(process.env['ORM_PATHS_UNSHRUNK'] === undefined ? {} : { endOnFailure: true }),
  };
}

export function onlySchema(): number | undefined {
  return numberFrom('ORM_PATHS_SCHEMA');
}
