import { Temporal } from 'temporal-polyfill/full/implementation';
import { registerTemporalImplementation } from './temporal-implementation';

export function registerControlPlaneTemporal(): void {
  registerTemporalImplementation(Temporal);
}
