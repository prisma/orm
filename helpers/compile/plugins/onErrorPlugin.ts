import type * as esbuild from 'esbuild'

/**
 * Causes esbuild to exit immediately with an error code.
 */
export const onErrorPlugin: esbuild.Plugin = {
  name: 'onErrorPlugin',
  setup(build) {
    build.onEnd((result) => {
      // if there were errors found on the build
      if (result.errors.length > 0) {
        process.exit(1)
      }
    })
  },
}
