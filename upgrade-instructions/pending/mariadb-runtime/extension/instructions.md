---
changes:
  - id: mysql-driver-factories-take-the-target
    summary: |
      `createMysqlRuntimeDriverDescriptor` and `createMysqlControlDriverDescriptor`, which build the MySQL driver for a target that extends MySQL, take an options object whose `target` is the target's runtime metadata, from which the drivers take their target id and the display name their errors show, and whose `checkViolationErrors` lists the error numbers the database reports a failed CHECK constraint with, as in `createMysqlRuntimeDriverDescriptor({ target: mariadbTargetDescriptorMetaRuntime, checkViolationErrors: [4025] })`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - 'createMysql(?:Runtime|Control)DriverDescriptor\(\s*[''"`]'
---

# The MySQL driver factories take the target's runtime metadata and its CHECK error numbers

Find each call to `createMysqlRuntimeDriverDescriptor` or `createMysqlControlDriverDescriptor` that passes a target id, and pass the target's runtime metadata instead, which carries its `targetId` and its `displayName`, and the error numbers the database reports a failed CHECK constraint with (3819 on MySQL, 4025 on MariaDB):

```ts
// was createMysqlRuntimeDriverDescriptor('mariadb')
const driver = createMysqlRuntimeDriverDescriptor({
  target: mariadbTargetDescriptorMetaRuntime,
  checkViolationErrors: [4025],
});
```

A target without metadata of its own passes an object with the two fields: `{ target: { targetId: 'mariadb', displayName: 'MariaDB' }, checkViolationErrors: [4025] }`.
