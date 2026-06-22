// Module-level telemetry context for command-scoped metadata.
// Handlers can set fields (e.g. file_count) that the telemetry hook reads.

export interface TelemetryContext {
  startedAt?: number
  success?: boolean
  file_count?: number
}

let ctx: TelemetryContext = {}

export function getTelemetryContext(): TelemetryContext {
  return ctx
}

export function setTelemetryContext(partial: Partial<TelemetryContext>): void {
  Object.assign(ctx, partial)
}

export function resetTelemetryContext(): void {
  ctx = {}
}
