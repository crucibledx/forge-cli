import Ajv2020, {type ErrorObject, type ValidateFunction} from 'ajv/dist/2020'
import {z} from 'zod'

import type {PluginManifest} from '@domain/plugins'
import {FORGE_NAMESPACE} from '@domain/plugins'

import pkg from '../../../package.json'
import mcpSchema from './schemas/agent-plugins-1.0.0/mcp.schema.json'
import pluginSchema from './schemas/agent-plugins-1.0.0/plugin.schema.json'

export interface ManifestCheck {
  manifest?: PluginManifest
  errors: string[]
  warnings: string[]
}

export const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/
const KNOWN_FIELDS = new Set(Object.keys(pluginSchema.properties))
export const PLUGIN_NAME = new RegExp(pluginSchema.properties.name.pattern)
export const PLUGIN_NAME_MAX = pluginSchema.properties.name.maxLength
/** Compiled on first use: every command imports this module, few validate a package. */
let validators: {plugin: ValidateFunction; mcp: ValidateFunction} | undefined
function schemaValidators() {
  if (!validators) {
    const ajv = new Ajv2020({allErrors: true})
    validators = {plugin: ajv.compile(pluginSchema), mcp: ajv.compile(mcpSchema)}
  }
  return validators
}
const forgeExtensionSchema = z
  .object({minForgeVersion: z.string().regex(SEMVER).optional(), harnesses: z.array(z.string()).optional()})
  .strict()

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function formatErrors(file: string, errors: ErrorObject[] | null | undefined): string[] {
  return (errors ?? []).map((error) =>
    error.keyword === 'required'
      ? `${file}${error.instancePath}: missing required field "${error.params.missingProperty}"`
      : `${file}${error.instancePath}: ${error.message}`,
  )
}

export function compareSemver(a: string, b: string): number {
  const parse = (version: string) => SEMVER.exec(version)!
  const [x, y] = [parse(a), parse(b)]
  for (let i = 1; i <= 3; i++) if (Number(x[i]) !== Number(y[i])) return Number(x[i]) - Number(y[i])
  return x[4] && !y[4] ? -1 : !x[4] && y[4] ? 1 : 0
}

/**
 * Agent Plugins 1.0 manifest rules (spec §5, §8.1): unknown top-level fields and a non-object `extensions` warn and
 * are ignored; every other schema violation is fatal. Forge additionally requires a semver `version`.
 */
export function checkManifest(raw: unknown, forgeVersion: string = pkg.version): ManifestCheck {
  if (!isObject(raw)) return {errors: ['plugin.json: must contain a JSON object'], warnings: []}
  const errors: string[] = []
  const warnings: string[] = []
  const manifest = {...raw}
  for (const key of Object.keys(manifest))
    if (!KNOWN_FIELDS.has(key)) {
      warnings.push(`plugin.json: unknown top-level field "${key}" ignored`)
      delete manifest[key]
    }
  if ('extensions' in manifest && !isObject(manifest.extensions)) {
    warnings.push('plugin.json: "extensions" is not an object and was ignored')
    delete manifest.extensions
  }
  const {plugin: validatePlugin} = schemaValidators()
  if (!validatePlugin(manifest)) errors.push(...formatErrors('plugin.json', validatePlugin.errors))
  if (typeof manifest.version !== 'string' || !SEMVER.test(manifest.version))
    errors.push(
      `plugin.json: "version" must be a semantic version (forge requires it), got ${JSON.stringify(manifest.version ?? null)}`,
    )
  const extensions = isObject(manifest.extensions) ? manifest.extensions : {}
  const forge = forgeExtensionSchema.safeParse(extensions[FORGE_NAMESPACE] ?? {})
  if (!forge.success)
    errors.push(
      ...forge.error.issues.map(
        (issue) =>
          `plugin.json: extensions["${FORGE_NAMESPACE}"]${issue.path.map((p) => `.${String(p)}`).join('')}: ${issue.message}`,
      ),
    )
  else if (forge.data.minForgeVersion && compareSemver(forgeVersion, forge.data.minForgeVersion) < 0)
    errors.push(
      `plugin.json: requires forge ${forge.data.minForgeVersion} or newer (this is ${forgeVersion}); upgrade forge`,
    )
  if (errors.length || !forge.success) return {errors, warnings}
  const {name, version, description} = manifest as {name: string; version: string; description?: string}
  return {
    manifest: {name, version, ...(description === undefined ? {} : {description}), forge: forge.data},
    errors,
    warnings,
  }
}

export function checkMcpConfig(path: string, raw: unknown): string[] {
  const {mcp} = schemaValidators()
  return mcp(raw) ? [] : formatErrors(path, mcp.errors)
}
