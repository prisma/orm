export type QueryEvent = {
  timestamp: Date
  query: string
  params: readonly unknown[]
  duration: number
}
