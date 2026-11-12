import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import type { Profile } from './types'

// Technology vocabulary. A component that names one of these is technology-specific and must match the project.
export const TECH: Record<string, string[]> = {
  python: ['python', 'django', 'fastapi', 'flask', 'pytest', 'pydantic', 'uv', 'pip', 'poetry', 'asyncio', 'celery', 'sqlalchemy'],
  fastapi: ['fastapi', 'pydantic', 'uvicorn', 'starlette'],
  django: ['django', 'drf'],
  typescript: ['typescript', 'javascript', 'node', 'nodejs', 'npm', 'tsconfig', 'deno', 'bun'],
  react: ['react', 'nextjs', 'next.js', 'jsx', 'tsx', 'redux'],
  vue: ['vue', 'nuxt'],
  angular: ['angular'],
  go: ['go', 'golang', 'goroutine', 'goroutines'],
  rust: ['rust', 'cargo', 'tokio'],
  java: ['java', 'spring', 'kotlin', 'gradle', 'maven', 'jvm', 'scala'],
  dotnet: ['c#', 'csharp', '.net', 'dotnet', 'asp.net', 'blazor'],
  ruby: ['ruby', 'rails'],
  php: ['php', 'laravel', 'symfony'],
  elixir: ['elixir', 'phoenix', 'erlang'],
  haskell: ['haskell'],
  julia: ['julia'],
  cpp: ['c++', 'cpp', 'cmake'],
  c: ['embedded', 'microcontroller', 'cortex', 'firmware', 'rtos'],
  mobile: ['ios', 'android', 'swift', 'swiftui', 'flutter', 'react-native', 'kotlin multiplatform', 'mobile'],
  docker: ['docker', 'dockerfile', 'container', 'containers'],
  kubernetes: ['kubernetes', 'k8s', 'helm', 'kubectl', 'gitops', 'argocd', 'istio', 'service mesh'],
  terraform: ['terraform', 'opentofu', 'iac'],
  cloud: ['aws', 'azure', 'gcp', 'cloudformation', 'lambda', 'serverless', 'multi-cloud', 'hybrid cloud', 'hybrid-cloud'],
  gitlab: ['gitlab'],
  'github-actions': ['github actions', 'github-actions', 'workflow yaml'],
  postgres: ['postgres', 'postgresql', 'asyncpg', 'psycopg', 'sql'],
  blockchain: ['blockchain', 'solidity', 'web3', 'defi', 'nft', 'smart contract'],
  unity: ['unity', 'unreal', 'godot', 'game'],
  payments: ['stripe', 'paypal', 'payment', 'payments', 'billing', 'pci'],
  ml: ['pytorch', 'tensorflow', 'mlops', 'fine-tuning', 'finetuning', 'llm training', 'dgx'],
  llm: ['llm', 'rag', 'langchain', 'langgraph', 'prompt engineering', 'embeddings', 'vector'],
  drawio: ['draw.io', 'drawio', 'diagram'],
}

const read = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8').toLowerCase() : '')

const walk = (root: string, depth = 3): string[] => {
  const out: string[] = []
  const rec = (d: string, n: number) => {
    if (n < 0) return
    for (const e of readdirSync(d)) {
      if (e === '.git' || e === 'node_modules' || e === '.factory' || e === '.crucible' || e === '.venv') continue
      const p = join(d, e)
      if (statSync(p).isDirectory()) rec(p, n - 1)
      else out.push(p.slice(root.length + 1))
    }
  }
  rec(root, depth)
  return out
}

// Deterministic project context detection: file indicators and dependency names only.
export const detectProfile = (root: string, extra: { include?: string[]; exclude?: string[] } = {}): Profile => {
  const files = walk(root)
  const tags = new Map<string, string>()
  const add = (t: string, why: string) => tags.has(t) || tags.set(t, why)
  const deps = [read(join(root, 'pyproject.toml')), read(join(root, 'requirements.txt')), read(join(root, 'package.json'))].join('\n')
  if (files.some((f) => /(^|\/)(pyproject\.toml|requirements.*\.txt|setup\.py)$/.test(f) || f.endsWith('.py'))) add('python', 'python files/manifest')
  if (/\bfastapi\b/.test(deps)) add('fastapi', 'fastapi dependency')
  if (/\bdjango\b/.test(deps)) add('django', 'django dependency')
  if (files.some((f) => /(^|\/)(package\.json|tsconfig\.json)$/.test(f))) add('typescript', 'package.json/tsconfig')
  if (/"react"/.test(deps)) add('react', 'react dependency')
  if (files.some((f) => f.endsWith('go.mod'))) add('go', 'go.mod')
  if (files.some((f) => f.endsWith('Cargo.toml'))) add('rust', 'Cargo.toml')
  if (files.some((f) => /(pom\.xml|build\.gradle(\.kts)?)$/.test(f))) add('java', 'pom/gradle')
  if (files.some((f) => /(^|\/)(Dockerfile|docker-compose\.ya?ml|compose\.ya?ml)$/.test(f))) add('docker', 'Dockerfile/compose')
  if (files.some((f) => f.endsWith('.tf'))) add('terraform', '*.tf')
  if (files.some((f) => f.startsWith('.github/workflows/'))) add('github-actions', '.github/workflows')
  if (/psycopg|asyncpg|sqlalchemy|postgres/.test(deps)) add('postgres', 'database driver')
  if (/\bstripe\b/.test(deps)) add('payments', 'stripe dependency')
  if (/\b(langchain|openai|anthropic)\b/.test(deps)) add('llm', 'LLM SDK dependency')
  if (files.some((f) => f.endsWith('.drawio'))) add('drawio', '*.drawio')
  for (const t of extra.include ?? []) add(t, 'config include')
  for (const t of extra.exclude ?? []) tags.delete(t)
  return { tags: [...tags.keys()].sort(), evidence: Object.fromEntries(tags) }
}
