export const TITLE_PREFIX = 'crucible-forge-sync'

export function titleFor(projectRoot: string): string {
  const slug = projectRoot
    .replace(/[^a-zA-Z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return `${TITLE_PREFIX}-${slug}`
}
