/**
 * GitHub Script helper to create annotated tags when they do not already exist.
 * Expects the following environment variables to be set:
 * - INPUT_REPOSITORY: optional owner/repo target, defaults to current repo
 * - TAG_NAME: required tag name
 * - COMMIT_SHA: required commit sha to tag
 * - TAG_MESSAGE: optional message for annotated tag
 */
export async function createGitTag({ github, core, context }) {
  const repoInput = process.env.INPUT_REPOSITORY
  let owner
  let repo

  if (repoInput && repoInput.trim().length > 0) {
    const parts = repoInput.split('/')
    if (parts.length !== 2) {
      core.setFailed(`Invalid repository input: ${repoInput}`)
      return
    }
    ;[owner, repo] = parts
  } else {
    ;({ owner, repo } = context.repo)
  }

  const tagName = process.env.TAG_NAME
  if (!tagName) {
    core.setFailed('Missing tag name input.')
    return
  }

  const commitSha = process.env.COMMIT_SHA
  if (!commitSha) {
    core.setFailed('Missing commit SHA input.')
    return
  }

  const messageEnv = process.env.TAG_MESSAGE
  const message = messageEnv && messageEnv.trim().length > 0 ? messageEnv : tagName

  try {
    await github.rest.git.getRef({
      owner,
      repo,
      ref: `tags/${tagName}`,
    })
    core.info(`Tag ${tagName} already exists on ${owner}/${repo}, skipping.`)
    return
  } catch (error) {
    if (error.status !== 404) {
      throw error
    }
  }

  const tag = await github.rest.git.createTag({
    owner,
    repo,
    tag: tagName,
    message,
    object: commitSha,
    type: 'commit',
  })

  try {
    await github.rest.git.createRef({
      owner,
      repo,
      ref: `refs/tags/${tagName}`,
      sha: tag.data.sha,
    })
  } catch (error) {
    if (error.status === 422 && error.message?.includes('Reference already exists')) {
      core.info(`Tag reference refs/tags/${tagName} already exists on ${owner}/${repo}, skipping.`)
      return
    }
    throw error
  }

  core.info(`Created tag ${tagName} on ${owner}/${repo} at ${commitSha}.`)
}
