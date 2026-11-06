/** Names the unbound namespace in a TypeScript contract: storage the connection locates, such as an extension found through the Postgres `search_path`. Only the Postgres `extension()` builder accepts it today, as `extension(name, { namespace: unbound })`. */
export const unbound: unique symbol = Symbol.for('prisma.namespace.unbound');
