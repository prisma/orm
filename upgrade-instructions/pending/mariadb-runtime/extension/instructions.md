---
changes:
  - id: mysql-driver-factories-take-display-name
    summary: |
      `createMysqlRuntimeDriverDescriptor` and `createMysqlControlDriverDescriptor`, which build the MySQL driver for a database that extends MySQL, take the database's display name as a second argument, which their errors show, as in `createMysqlRuntimeDriverDescriptor('mariadb', 'MariaDB')`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - 'createMysql(?:Runtime|Control)DriverDescriptor\(\s*[^,()]+\s*\)'
---

# The MySQL driver factories take a display name

Find each call to `createMysqlRuntimeDriverDescriptor` or `createMysqlControlDriverDescriptor` with one argument, and add the name of the database as messages should show it:

```ts
const driver = createMysqlRuntimeDriverDescriptor('mariadb', 'MariaDB'); // was createMysqlRuntimeDriverDescriptor('mariadb')
```
