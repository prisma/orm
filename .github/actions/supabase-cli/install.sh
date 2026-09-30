#!/usr/bin/env bash
# Installs the pinned Supabase CLI and tells later steps which Actions cache
# entry holds the Docker images that `supabase start` runs.
#
# The CLI comes from its release tarball rather than supabase/setup-cli: the
# org allowlists actions, and only the repositories CI already uses are on it.
#
# To bump the CLI, set cli_version and cli_tarball_sha256. The checksum is the
# supabase_linux_amd64.tar.gz line of the release's
# supabase_<version>_checksums.txt.
set -euo pipefail

readonly cli_version=2.95.4
readonly cli_tarball_sha256=01a3b8f5861d108a934937cae88e8d503093c3f7d3aa32d959f69b099b4f9ef3
readonly supabase_config=examples/supabase/supabase/config.toml

download_verified_cli_tarball() {
  local tarball=$1
  curl --fail --silent --show-error --location --output "$tarball" \
    "https://github.com/supabase/cli/releases/download/v${cli_version}/supabase_linux_amd64.tar.gz"
  echo "$cli_tarball_sha256  $tarball" | sha256sum --check --strict -
}

install_cli_on_path() {
  local tarball=$1
  local bin_dir=$RUNNER_TEMP/bin
  mkdir -p "$bin_dir"
  tar --extract --gzip --file "$tarball" --directory "$bin_dir" supabase
  echo "$bin_dir" >> "$GITHUB_PATH"
}

# The image set is fixed by the CLI version and by the services config.toml
# enables, so changing either one names a new cache entry.
write_image_cache_outputs() {
  local config_sha256
  config_sha256=$(sha256sum "$supabase_config")
  local config_hash=${config_sha256:0:16}
  echo "images-cache-key=supabase-images-${RUNNER_OS}-${cli_version}-${config_hash}" >> "$GITHUB_OUTPUT"
  echo "images-archive=$RUNNER_TEMP/supabase-images.tar" >> "$GITHUB_OUTPUT"
}

tarball=$RUNNER_TEMP/supabase.tar.gz
download_verified_cli_tarball "$tarball"
install_cli_on_path "$tarball"
write_image_cache_outputs
