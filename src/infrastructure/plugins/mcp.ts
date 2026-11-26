import {posix} from 'node:path'

interface StdioServer {
  type: 'stdio'
  command: string
  cwd?: string
}
interface RemoteServer {
  type: 'streamable-http' | 'sse'
  url: string
  headers?: Record<string, string>
}
export interface McpConfig {
  mcpServers: Record<string, StdioServer | RemoteServer>
}

const CWD_ROOTS = ['${PLUGIN_ROOT}', '${PLUGIN_DATA}']
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/
const CREDENTIAL_HEADERS = new Set(['authorization', 'proxy-authorization', 'cookie'])
const LOOPBACK_V4 = /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/

/** Symlinks are already confined by package acquisition; this catches `..` escapes in the configured string. */
function staysInside(relative: string): boolean {
  const normalized = posix.normalize(relative.replaceAll('\\', '/') || '.')
  return normalized !== '..' && !normalized.startsWith('../')
}

function commandError(command: string): string | undefined {
  const isPath = /[/\\]/.test(command)
  if (isPath && !staysInside(command.replace(/^\.\//, ''))) return 'resolves outside the plugin root'
  if (command.startsWith('./')) return undefined
  if (isPath) return 'must be a bare executable name or a plugin-relative path starting with "./"'
  if (/\s/.test(command)) return 'must be a single executable token, not a shell command'
}

function cwdError(cwd: string): string | undefined {
  const root = CWD_ROOTS.find((prefix) => cwd === prefix || cwd.startsWith(`${prefix}/`))
  const rest = root ? cwd.slice(root.length + 1) : cwd.slice(2)
  return staysInside(rest) ? undefined : `resolves outside ${root ?? 'the plugin root'}`
}

function urlError(raw: string): string | undefined {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return 'must be an absolute URL'
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return 'must use http or https'
  if (url.username || url.password) return 'must not contain user information'
  if (raw.includes('#')) return 'must not contain a fragment'
  const loopback = url.hostname === 'localhost' || url.hostname === '[::1]' || LOOPBACK_V4.test(url.hostname)
  if (url.protocol === 'http:' && !loopback) return 'must use https for a non-loopback host'
}

/** Agent Plugins 1.0 §7.2.1 rules the vendored schema leaves to the specification text. */
export function checkMcpServers(path: string, config: McpConfig): string[] {
  const errors: string[] = []
  for (const [name, server] of Object.entries(config.mcpServers)) {
    const report = (field: string, message: string | undefined) => {
      if (message) errors.push(`${path}/mcpServers/${name}/${field}: ${message}`)
    }
    if (server.type === 'stdio') {
      report('command', commandError(server.command))
      if (server.cwd !== undefined) report('cwd', cwdError(server.cwd))
      continue
    }
    report('url', urlError(server.url))
    for (const [header, value] of Object.entries(server.headers ?? {})) {
      if (!HEADER_NAME.test(header)) report(`headers/${header}`, 'is not a valid HTTP header name')
      else if (CREDENTIAL_HEADERS.has(header.toLowerCase()))
        report(`headers/${header}`, 'carries credentials; headers are visible package data')
      if (/[\r\n\0]/.test(value)) report(`headers/${header}`, 'value must not contain line breaks')
    }
  }
  return errors
}
