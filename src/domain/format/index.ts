// ─── Time Ago ────────────────────────────────────────────────────────────────

export function formatTimeAgo(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime()

  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return 'just now'

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} minute(s) ago`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hour(s) ago`

  const days = Math.floor(hours / 24)
  return `${days} day(s) ago`
}

// ─── Date/Time ───────────────────────────────────────────────────────────────

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function formatDateTime(date: Date): string {
  const day = DAY_NAMES[date.getDay()]
  const dd = String(date.getDate()).padStart(2, '0')
  const mon = MONTH_NAMES[date.getMonth()]
  const yyyy = date.getFullYear()
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  return `${day} ${dd} ${mon} ${yyyy}, ${hh}:${mm}`
}

export function formatShortDateTime(date: Date): string {
  const dd = String(date.getDate()).padStart(2, '0')
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const hh = String(date.getHours()).padStart(2, '0')
  const min = String(date.getMinutes()).padStart(2, '0')
  return `${dd}/${mm} ${hh}:${min}`
}
