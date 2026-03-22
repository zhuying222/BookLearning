export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export function parsePageSelection(
  input: string,
  maxPage: number,
): number[] {
  if (!input.trim()) {
    return []
  }

  const pages = new Set<number>()
  const segments = input
    .split(',')
    .map((segment) => segment.trim())
    .filter(Boolean)

  for (const segment of segments) {
    if (segment.includes('-')) {
      const [rawStart, rawEnd] = segment.split('-', 2)
      const start = Number.parseInt(rawStart.trim(), 10)
      const end = Number.parseInt(rawEnd.trim(), 10)

      if (!Number.isFinite(start) || !Number.isFinite(end)) {
        continue
      }

      const rangeStart = Math.max(1, Math.min(start, end))
      const rangeEnd = Math.min(maxPage, Math.max(start, end))

      for (let page = rangeStart; page <= rangeEnd; page += 1) {
        pages.add(page)
      }

      continue
    }

    const page = Number.parseInt(segment, 10)
    if (Number.isFinite(page) && page >= 1 && page <= maxPage) {
      pages.add(page)
    }
  }

  return [...pages].sort((left, right) => left - right)
}

export function formatPageSelection(pages: number[]): string {
  if (pages.length === 0) {
    return ''
  }

  const sortedPages = [...new Set(pages)].sort((left, right) => left - right)
  const segments: string[] = []
  let start = sortedPages[0]
  let end = sortedPages[0]

  for (let index = 1; index < sortedPages.length; index += 1) {
    const page = sortedPages[index]
    if (page === end + 1) {
      end = page
      continue
    }

    segments.push(start === end ? String(start) : `${start}-${end}`)
    start = page
    end = page
  }

  segments.push(start === end ? String(start) : `${start}-${end}`)
  return segments.join(', ')
}
