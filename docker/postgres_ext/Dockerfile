ARG POSTGRES_VERSION=16
FROM postgres:${POSTGRES_VERSION}

ARG POSTGRES_VERSION
ENV POSTGRES_VERSION=${POSTGRES_VERSION}

# Install PostGIS and pgvector for the specified Postgres version
RUN apt-get update && \
    apt-get install -y \
    postgis \
    postgresql-${POSTGRES_VERSION}-postgis-3 \
    postgresql-${POSTGRES_VERSION}-postgis-3-scripts \
    postgresql-${POSTGRES_VERSION}-pgvector && \
    rm -rf /var/lib/apt/lists/*
