export function resolveForgeCommand(): string {
  // Compiled binary: process.execPath IS the forge binary
  // Dev mode (bun run): process.execPath is bun, argv[1] is the script
  const execPath = process.execPath
  const base = execPath.endsWith('/bun') || execPath.endsWith('/bun.exe') ? `${execPath} ${process.argv[1]}` : execPath
  return `${base} sync --silent`
}
