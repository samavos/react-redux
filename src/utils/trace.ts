export interface Trace {
  onSelectorUnmount?: () => void

  onSelectorCallStart?: () => void
  onSelectorCallEnd?: () => void

  onIsEqualCall?: (equal: boolean) => void
  onObjectIsEqualCall?: (equal: boolean) => void

  onSubscribe?: () => void
  onSubscribeCleanup?: () => void
  onStoreChange?: () => void

  onGetSnapshot?: () => void
}

export interface TraceFactory {
  (name?: string): Trace
}