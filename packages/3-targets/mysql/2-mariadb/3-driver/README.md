# @internal/driver-mariadb

MariaDB runtime and control drivers for Prisma 8.

## Package Classification

- **Domain**: targets
- **Layer**: drivers
- **Plane**: multi-plane (migration, runtime)

## Purpose

MySQL's drivers ([`@internal/driver-mysql`](../../1-mysql/3-driver/README.md)) built for the `mariadb` target id, which the config loader requires every component of a MariaDB stack to carry. The package holds no driver code: the MySQL driver connects to MariaDB 10.11 unchanged, and its README's environment requirements hold on MariaDB too.

## Exports

- `./control`: the control driver descriptor
- `./runtime`: the runtime driver descriptor
