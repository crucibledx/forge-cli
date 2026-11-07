import {readFile} from 'node:fs/promises'
import {dirname, resolve} from 'node:path'

import {redact} from '../src/domain/redact'
import {protectEvidenceOutput, readEvidence, writeEvidence} from './evidence-io'
import type {EvidenceContext, ReviewEvidence, VerifierEvidence} from './evidence-schema'
import {bundleSchema, contextSchema} from './evidence-schema'
import {githubJSON, providerGate} from './github-evidence'
import {
  assertProducerRecord,
  producerSelection,
  ProducerSuperseded,
  providerProducerState,
  providerReport,
} from './producer-evidence'
import type {ProducerRole} from './producer-roles'
import {collectReadiness} from './readiness'
import {readinessProvider} from './readiness-provider'
import {repositoryRoot} from './validation-context'

/** One report can remain current for security after its code role has been superseded. */
export async function collectProducers(sources: string[], context: EvidenceContext, read = githubJSON) {
  producerSelection(sources)
  const imported: {markdown: string; records: (ReviewEvidence | VerifierEvidence)[]}[] = []
  const selected = new Map<
    ProducerRole,
    {
      record: ReviewEvidence | VerifierEvidence
      source: number
      current: boolean
      superseded: boolean
    }
  >()
  for (const uri of sources) {
    const payload = await providerReport(uri, context, read)
    const source = imported.push({markdown: payload.raw_report_markdown, records: []}) - 1
    for (const record of [...payload.reviews, ...(payload.verifier ? [payload.verifier] : [])]) {
      let current = false,
        superseded = false
      try {
        await providerProducerState(uri, context, read, record.provenance.producer_role)
        current = true
      } catch (error) {
        // Even a superseded-only selection must reach aggregation. All routing references remain in producers.json;
        // the checker authenticates every candidate and validates its findings/rows, not this fallback's URI order.
        superseded = error instanceof ProducerSuperseded
      }
      const role = record.provenance.producer_role,
        previous = selected.get(role)
      if (current && previous?.current) throw new Error('Conflicting current producer records')
      if (
        !previous ||
        (current && !previous.current) ||
        (!current &&
          !previous.current &&
          ((!superseded && previous.superseded) ||
            (superseded === previous.superseded && uri < previous.record.provenance.source_uri)))
      )
        selected.set(role, {record, source, current, superseded})
    }
  }
  for (const {record, source} of selected.values()) imported[source].records.push(record)
  return imported.filter((source) => source.records.length)
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
    await writeEvidence(resolve(directory, 'gate.json'), gate, directory)
    let sources: unknown = []
    try {
      sources = JSON.parse(await readEvidence(directory, 'producers.json'))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    for (const {records, markdown} of await collectProducers(producerSelection(sources), context)) {
      for (const record of records) {
        const path = 'role' in record ? `reviews/${record.role}.json` : 'verifier.json'
        try {
          if (JSON.stringify(JSON.parse(await readEvidence(directory, path))) !== JSON.stringify(record))
            throw new Error('Refusing to overwrite a different source attestation')
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
          await writeEvidence(resolve(directory, path), record, directory)
        }
      }
      await writeEvidence(
        resolve(directory, `raw-reports/${records[0].provenance.producer_id}.json`),
        {
          markdown,
        },
        directory,
      )
    }
    const bundle = await collectReadiness(context, directory)
    for (const lane of bundle.lanes)
      for (const check of lane.checks) for (const ref of check.evidence) await provider.artifact(ref, context, lane)
    for (const record of [...bundle.reviews, ...(bundle.verifier ? [bundle.verifier] : [])])
      assertProducerRecord(await providerReport(record.provenance.source_uri, context), record)
    if (bundle.gate.source_uri) await provider.gate(bundle.gate, context)
    for (const record of bundle.deviations.filter((record) => record.approval.decision === 'approved'))
      await provider.deviation(record, context)
    await writeEvidence(output, bundle, directory)
    console.log('Collected schema-valid evidence; readiness has not been decided')
  } catch (error) {
    console.error(redact(`Evidence collection blocked: ${String(error)}`))
    process.exitCode = 2
  }
}
