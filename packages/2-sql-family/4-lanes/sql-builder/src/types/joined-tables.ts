import type { EmptyRow, QueryContext, Scope } from '../scope';
import type { WithJoin, WithSelect } from './shared';

export interface JoinedTables<QC extends QueryContext, AvailableScope extends Scope>
  extends WithSelect<QC, AvailableScope, EmptyRow>,
    WithJoin<QC, AvailableScope, QC['capabilities']> {}
