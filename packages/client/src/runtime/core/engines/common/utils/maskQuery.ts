export function maskQuery(query?: string): string {
  if (!query) {
    return ''
  }
  return (
    query
      // replace all strings with X
      .replace(/"(?:[^"\\]|\\.)*"/g, '"X"')
      // replace all numbers with 5
      .replace(/[\s:\[]([+-]?([0-9]*[.])?[0-9]+)/g, (substr) => {
        return `${substr[0]}5`
      })
  )
}
