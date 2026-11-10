import postgres from '@prisma/orm-postgres/runtime';
import type { Contract } from './contract.d';
import cj from './contract.json' with { type: 'json' };

export const fallback = cj;

export function make(cj: unknown, url: string) {
  return postgres<Contract>({ contractJson: cj, url });
}
