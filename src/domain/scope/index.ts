let globalMode = false

export function setGlobalMode(enabled: boolean): void {
  globalMode = enabled
}

export function isGlobalMode(): boolean {
  return globalMode
}
