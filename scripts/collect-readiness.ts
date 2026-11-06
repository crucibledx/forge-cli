import {readFile} from 'node:fs/promises'
import {dirname, resolve} from 'node:path'

import {redact} from '../src/domain/redact'
import {readEvidence, writeEvidence} from './evidence-io'
import {contextSchema} from './evidence-schema'
import {providerGate} from './github-evidence'
import {providerProducer} from './producer-evidence'
import {collectReadiness} from './readiness'
import {readinessProvider} from './readiness-provider'
import {repositoryRoot} from './validation-context'

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
    const context = contextSchema.parse(JSON.parse(await readFile(contextPath, 'utf8'))),
      directory = dirname(contextPath)
    const provider = readinessProvider(repositoryRoot, directory)
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
    for (const uri of sources) {
      const payload = await providerProducer(uri, context)
      const records = [...payload.reviews, ...(payload.verifier ? [payload.verifier] : [])]
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
        markdown: payload.raw_report_markdown,
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
