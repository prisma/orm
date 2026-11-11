import { Find } from './find';
import { FindByKeys } from './find-by-keys';
import type { Graph } from './graph';

export function removeUnreadFinds(graph: Graph): void {
  graph.removeUnread((node) => node instanceof Find || node instanceof FindByKeys);
}
