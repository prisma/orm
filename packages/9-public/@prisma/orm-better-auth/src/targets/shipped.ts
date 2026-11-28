import type { TargetSupport } from '../target-support';
import { postgresSupport } from './postgres';
import { sqliteSupport } from './sqlite';

export const shippedTargetSupports: readonly TargetSupport[] = [postgresSupport, sqliteSupport];
