export interface Trace {
  stack: string | null

  onSelectorCallStart?: () => void
  onSelectorCallEnd?: () => void

  onIsEqualCall?: (equal: boolean) => void
  onObjectIsEqualCall?: (equal: boolean) => void

  onSubscribe?: () => void
  onSubscribeCleanup?: () => void
  onStoreChange?: () => void

  onGetSnapshot?: () => void
}