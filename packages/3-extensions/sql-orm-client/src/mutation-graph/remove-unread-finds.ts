import { Find } from './find';
import { FindByKeys } from './find-by-keys';
import type { Graph } from './graph';

export function removeUnreadFinds(graph: Graph): void {
  const unread = graph
    .nodes()
    .filter(
      ([id, node]) =>
        (node instanceof Find || node instanceof FindByKeys) &&
        id !== graph.result &&
        graph.readersOf(id).length === 0,
    );
  for (const [id] of unread) {
    graph.remove(id);
  }
  if (unread.length > 0) {
    removeUnreadFinds(graph);
  }
}
