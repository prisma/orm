ARG MONGO_VERSION

FROM mongo:${MONGO_VERSION}

# we take over the default & start mongo in replica set mode in a background task
ENTRYPOINT mongod --port $MONGO_REPLICA_PORT --replSet rs0 --bind_ip 0.0.0.0 & MONGOD_PID=$!; \
# we prepare the replica set with a single node and prepare the root user config.
# the initiate call is wrapped in try/catch so that a restart with a pre-existing
# replica set state (AlreadyInitialized / code 23) is treated as success instead
# of causing the `until` loop below to spin forever, spawning a mongosh every second.
INIT_REPL_CMD="try { rs.initiate({ _id: 'rs0', members: [{ _id: 0, host: '$MONGO_REPLICA_HOST:$MONGO_REPLICA_PORT' }] }) } catch (e) { if (e.codeName !== 'AlreadyInitialized' && e.code !== 23) { throw e } }"; \
# we wait for mongod to accept connections and then submit the command just above
until ($MONGO_COMMAND admin --port $MONGO_REPLICA_PORT --eval "$INIT_REPL_CMD"); do sleep 1; done; \
# we are done but we keep the container by waiting on signals from the mongo task
echo "REPLICA SET ONLINE"; wait $MONGOD_PID;
