import {readFile} from 'node:fs/promises'
import {dirname, resolve} from 'node:path'

import {redact} from '../src/domain/redact'
import {protectEvidenceOutput, readEvidence, writeEvidence} from './evidence-io'
import type {EvidenceContext, ReviewEvidence, VerifierEvidence} from './evidence-schema'
import {bundleSchema, contextSchema} from './evidence-schema'
import {githubJSON, providerGate} from './github-evidence'
import {ProducerSuperseded, providerProducer, providerReport} from './producer-evidence'
import {PRODUCER_ROLES} from './producer-roles'
import {collectReadiness} from './readiness'
import {readinessProvider} from './readiness-provider'
import {repositoryRoot} from './validation-context'

/** One report can remain current for security after its code role has been superseded. */
export async function collectProducers(sources: string[], context: EvidenceContext, read = githubJSON) {
  if (sources.length > Object.values(PRODUCER_ROLES).length) throw new Error('Too many selected producers')
  if (new Set(sources).size !== sources.length) throw new Error('Duplicate producer selection')
  const imported: {markdown: string; records: (ReviewEvidence | VerifierEvidence)[]}[] = []
  for (const uri of sources) {
    const payload = await providerReport(uri, context, read)
    const current: (ReviewEvidence | VerifierEvidence)[] = []
    for (const record of [...payload.reviews, ...(payload.verifier ? [payload.verifier] : [])]) {
      try {
        await providerProducer(uri, context, read, record.provenance.producer_role)
        current.push(record)
      } catch (error) {
        if (!(error instanceof ProducerSuperseded)) throw error
      }
    }
    if (current.length) imported.push({markdown: payload.raw_report_markdown, records: current})
  }
  return imported
}

if (import.meta.main) {
  let args = Bun.argv.slice(2)
  if (args[0] === '--') args = args.slice(1)
  try {
    let contextPath = resolve(repositoryRoot, 'results/context.json'),
      output = resolve(repositoryRoot, 'results/readiness-input.json')
    while (args.length) {
      const flag = args.shift(),
        value = args.shift()
      if (!value || !['--context', '--out'].includes(flag!))
        throw new Error('Usage: collect:readiness -- --context <context> --out <bundle>')
      if (flag === '--context') contextPath = resolve(value)
      else output = resolve(value)
    }
    if (contextPath === output) throw new Error('Output cannot overwrite source context')
    if (dirname(contextPath) !== dirname(output))
      throw new Error('Output bundle must be colocated with context and relative check evidence')
    protectEvidenceOutput(contextPath, output)
    try {
      if (!bundleSchema.safeParse(JSON.parse(await readFile(output, 'utf8'))).success)
        throw new Error('Output is existing non-bundle data; refusing overwrite')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new Error('Output is existing non-bundle data or unavailable; refusing overwrite')
      }
    }
    const context = contextSchema.parse(JSON.parse(await readFile(contextPath, 'utf8'))),
      directory = dirname(contextPath)
    const provider = readinessProvider(directory)
    await provider.context(context)
    const gate = await providerGate(context)
    await provider.gate(gate, context)
    try {
      if (JSON.stringify(JSON.parse(await readEvidence(directory, 'gate.json'))) !== JSON.stringify(gate))
        throw new Error('Refusing to overwrite a different gate record')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    await writeEvidence(resolve(directory, 'gate.json'), gate)
    let sources: unknown = []
    try {
      sources = JSON.parse(await readEvidence(directory, 'producers.json'))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    if (!Array.isArray(sources) || sources.some((uri) => typeof uri !== 'string'))
      throw new Error('Invalid producer selection')
    for (const {records, markdown} of await collectProducers(sources, context)) {
      for (const record of records) {
        await provider.producer(record, context)
        const path = 'role' in record ? `reviews/${record.role}.json` : 'verifier.json'
        try {
          if (JSON.stringify(JSON.parse(await readEvidence(directory, path))) !== JSON.stringify(record))
            throw new Error('Refusing to overwrite a different source attestation')
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
          await writeEvidence(resolve(directory, path), record)
        }
      }
      await writeEvidence(resolve(directory, `raw-reports/${records[0].provenance.producer_id}.json`), {
        markdown,
      })
    }
    const bundle = await collectReadiness(context, directory)
    for (const lane of bundle.lanes)
      for (const check of lane.checks) for (const ref of check.evidence) await provider.artifact(ref, context, lane)
    for (const record of [...bundle.reviews, ...(bundle.verifier ? [bundle.verifier] : [])])
      await provider.producer(record, context)
    if (bundle.gate.source_uri) await provider.gate(bundle.gate, context)
    for (const record of bundle.deviations.filter((record) => record.approval.decision === 'approved'))
      await provider.deviation(record, context)
    await writeEvidence(output, bundle)
    console.log('Collected schema-valid evidence; readiness has not been decided')
  } catch (error) {
    console.error(redact(`Evidence collection blocked: ${String(error)}`))
    process.exitCode = 2
  }
}
