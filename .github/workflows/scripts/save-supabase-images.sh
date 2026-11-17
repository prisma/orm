#!/usr/bin/env bash
# Saves every Supabase Docker image on this runner into one archive for the
# Actions cache. Run it after `supabase start`, which pulls exactly the images
# the CI job needs.
#
# Usage: save-supabase-images.sh <archive path>
set -euo pipefail

readonly archive=$1

# The CLI pulls every service image through the public.ecr.aws/supabase/
# mirror, including third-party ones such as kong and mailpit.
list_supabase_images() {
  docker image ls --format '{{.Repository}}:{{.Tag}}' | grep '^public\.ecr\.aws/supabase/' || true
}

images=()
while IFS= read -r image; do
  images+=("$image")
done < <(list_supabase_images)

if ((${#images[@]} == 0)); then
  echo "::error::No public.ecr.aws/supabase/ images to save. Did supabase start run?"
  exit 1
fi

printf 'Saving %s\n' "${images[@]}"
docker save --output "$archive" "${images[@]}"
