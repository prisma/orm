# Research: how other projects keep working with older data, older applications and upgrades

Every claim was checked against the source linked beside it. "Not confirmed" at the end lists what was not checked. Nothing here is a decision or a proposal for Prisma.

## 1. Data written by old releases, kept as test fixtures

At each release the project saves data written by that release into the repository. Tests read it with current code.

- **Apache Lucene.** Zipped indexes named `index.X.Y.Z-cfs.zip`, from 9.0.0 to 10.6.0, with tests such as `TestBasicBackwardsCompatibility`. [Directory](https://github.com/apache/lucene/tree/main/lucene/backward-codecs/src/test/org/apache/lucene/backward_index). Versions are listed in `versions.txt` and every supported major "must be present... so dropping a supported major cannot happen silently" ([source](https://raw.githubusercontent.com/apache/lucene/main/lucene/backward-codecs/src/test/org/apache/lucene/backward_index/BackwardsCompatibilityTestBase.java)). Indexes older than the supported range must fail with `IndexFormatTooOldException`. Adding a release is scripted ([addBackcompatIndexes.py](https://raw.githubusercontent.com/apache/lucene/main/dev-tools/scripts/addBackcompatIndexes.py)).
- **Kubernetes API objects.** `testdata/HEAD` holds objects from the current commit and `vX.Y.Z` directories hold objects from previous releases: "After every v1.x.0 release, snapshot compatibility data" ([README](https://raw.githubusercontent.com/kubernetes/api/master/testdata/README.md)). Each old file must decode and re-encode to identical bytes. Changing the old files "is exceptional, and requires extremely close review."
- **PostgreSQL `pg_upgrade`.** The buildfarm module `TestUpgradeXversion` upgrades installations saved from older branches, and warns of "substantial persistent use of disk space" ([source](https://raw.githubusercontent.com/PGBuildFarm/client-code/main/PGBuild/Modules/TestUpgradeXversion.pm)).
- **Elasticsearch.** `rolling-upgrade`, `full-cluster-restart` and `mixed-cluster` suites "to test upgrading from each supported version" ([TESTING](https://raw.githubusercontent.com/elastic/elasticsearch/main/TESTING.asciidoc)).
- **Cargo.** Tests `oldest_lockfile_still_works` and `v2_format_preserved` ([source](https://raw.githubusercontent.com/rust-lang/cargo/master/tests/testsuite/lockfile_compat.rs)).

Costs: each saved release adds files and test time. Applies when a format is read long after it was written, and needs a fixed list of supported versions.

## 2. Version numbers inside stored formats

- **Git.** A Git that does not understand a repository's format version "MUST NOT operate on that repository; doing so risks... losing data." An unknown `extensions.*` key also stops it ([docs](https://git-scm.com/docs/repository-version)).
- **Cargo.** A newer lock file gives "this version of Cargo does not understand this lock file". An old format is kept as it is when no update is needed (same test file as above).
- **npm.** `lockfileVersion` 1, 2 and 3; npm upgrades lock files written by v6 or earlier ([docs](https://docs.npmjs.com/cli/v10/configuring-npm/package-lock-json)).
- **Terraform providers.** Each resource schema has a version saved into the state. The provider writes upgraders keyed by prior version; each must upgrade "wholly" to the current version; the framework "does not iterate through intermediate version implementations" ([docs](https://developer.hashicorp.com/terraform/plugin/framework/resources/state-upgrade)).
- **Protocol Buffers.** Unknown fields are preserved and written back; field numbers are never reused ([docs](https://protobuf.dev/programming-guides/proto3/)).

## 3. Schema compatibility checked against a baseline in CI

- **`buf breaking`** compares a Protobuf schema with a past version from a Git branch, a registry or a tarball ([docs](https://buf.build/docs/breaking/)).
- **Confluent Schema Registry.** Default mode BACKWARD checks against the last version only; `_TRANSITIVE` modes check against all versions ([docs](https://docs.confluent.io/platform/current/schema-registry/fundamentals/schema-evolution.html)).
- **oasdiff** reports "only the changes that break existing API clients" for OpenAPI ([repo](https://github.com/oasdiff/oasdiff)).

Cost: a check against the last version only can miss breaks against older versions, which is why Confluent offers transitive modes.

## 4. Old migration files that must keep working

- **Rails.** `compatibility.rb` exists "to ensure that old migrations run the same way they did before a Rails upgrade", one class per prior version back to `V4_2` ([source](https://raw.githubusercontent.com/rails/rails/main/activerecord/lib/active_record/migration/compatibility.rb)).
- **Django.** Migrations generated on X.Y "should run unchanged on Django X.Y+1". Squashing keeps the old files until all instances have applied them ([docs](https://docs.djangoproject.com/en/stable/topics/migrations/)).
- **Flyway.** `validate` fails when an applied migration's checksum differs from the local file ([docs](https://documentation.red-gate.com/fd/validate-277578898.html)).

## 5. Old and new versions running at the same time

- **Kubernetes** version skew policy: API servers within one minor version; a kubelet up to three minors older, never newer ([policy](https://kubernetes.io/releases/version-skew-policy/)).
- **Elasticsearch** supports two versions together only during an upgrade ([docs](https://www.elastic.co/docs/troubleshoot/elasticsearch/troubleshooting-upgrades)).
- **CockroachDB.** New features "are not available until the upgrade is finalized"; after that "the cluster cannot be rolled back" ([docs](https://docs.cockroachlabs.com/docs/stable/upgrade-cockroach-version)).
- **Rails `ignored_columns`.** Code stops using a column, is deployed, and only then is the column dropped ([docs](https://api.rubyonrails.org/classes/ActiveRecord/ModelSchema/ClassMethods.html)).

## 6. Running downstream projects against a release candidate

- **Rust crater** builds crates with two toolchains "to detect regressions in the Rust compiler" ([repo](https://github.com/rust-lang/crater)).
- **Node.js CITGM** is used to "smoke test our releases and controversial changes" ([repo](https://github.com/nodejs/citgm)).
- **TypeScript** `typescript-error-deltas` compiles popular repositories with the old and new compiler ([repo](https://github.com/microsoft/typescript-error-deltas)).
- **Vite, Vue, Nuxt, Svelte** each run downstream test suites three times a week in an ecosystem CI ([Vite](https://github.com/vitejs/vite-ecosystem-ci), [Vue](https://github.com/vuejs/ecosystem-ci), [Nuxt](https://github.com/nuxt/ecosystem-ci), [Svelte](https://github.com/sveltejs/svelte-ecosystem-ci)).

## 7. Upgrades applied by a tool

- **Angular `ng update`.** A library declares migrations in its package.json; `ng update` runs each one between the installed and target version ([spec](https://raw.githubusercontent.com/angular/angular-cli/main/docs/specifications/update.md)).
- **Next.js codemods.** Where a fix cannot be determined, the codemod adds `@next-codemod-error` comments, and "Your build will error until these comments are explicitly removed." ([docs](https://nextjs.org/docs/app/guides/upgrading/codemods)).
- **React** `react-codemod`; some transforms leave calls to fix by hand ([repo](https://github.com/reactjs/react-codemod)).
- **Rust editions.** Opt-in per crate; crates of different editions interoperate; `cargo fix --edition` applies migration lints and backs out fixes that fail. "Proc macros in general cannot be automatically fixed at all." ([guide](https://doc.rust-lang.org/edition-guide/editions/advanced-migrations.html)).
- **Go `go fix`.** Conflicts between two fixes must be resolved "by the user of go fix" ([blog](https://go.dev/blog/gofix)).
- **Rails `app:update`**, and new defaults enabled gradually through `new_framework_defaults_X_Y.rb` ([guide](https://guides.rubyonrails.org/upgrading_ruby_on_rails.html)).
- **Ember.** Community codemods, and `ember-cli-deprecation-workflow` to turn one deprecation at a time into an error ([repo](https://github.com/ember-cli/ember-cli-deprecation-workflow)).

Every project above says some cases need manual work.

## 8. Written deprecation policies

- **Django.** Every deprecation spans "at least 2 feature releases" ([process](https://docs.djangoproject.com/en/dev/internals/release-process/)).
- **Rails.** "Breaking changes are paired with deprecation notices in the previous minor or major release." ([policy](https://guides.rubyonrails.org/maintenance_policy.html)).
- **Ember.** `deprecate()` requires an `until` version; a deprecation targeting the next major cannot be introduced later than the M.10 release ([RFC](https://rfcs.emberjs.com/id/0830-evolving-embers-major-version-process)).
- **Angular.** A deprecation lasts "a minimum one major version (approximately one year)" ([policy](https://angular.dev/reference/releases)).

## Not confirmed

- How SQLite tests its statement that newer versions read files back to 3.0.0.
- OpenSearch tests, Alembic, pnpm `lockfileVersion` rules, Flyway `repair`.
- Terraform state's own `version` field and whether older Terraform refuses newer state.
- How often TypeScript's scheduled runs happen.
- Whether crater runs are a required release step.
- How many old releases Kubernetes keeps in `testdata`.
