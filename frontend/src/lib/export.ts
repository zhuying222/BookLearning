import { marked } from 'marked'
import type { PDFDocumentProxy } from 'pdfjs-dist'

import { renderPdfPageToDataUrl } from './pdf'

const API_BASE = 'http://localhost:8000/api/v1'
const FIRST_PAGE_TEXT_CAPACITY = 2400
const CONTINUATION_COLUMN_CAPACITY = 2200

type PageData = {
  pageNum: number
  dataUrl: string
  explanation: string
}

type ContinuationSheet = {
  leftHtml: string
  rightHtml: string
}

export function exportAsJson(
  pdfHash: string,
  pdfFileName: string,
  explanations: Record<number, string>,
  pageCount: number,
) {
  const data = {
    version: '1.0',
    pdf_hash: pdfHash,
    pdf_file_name: pdfFileName,
    page_count: pageCount,
    export_time: new Date().toISOString(),
    pages: explanations,
  }

  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json',
  })
  downloadBlob(blob, `${stripExt(pdfFileName)}_讲解备份_${dateTag()}.json`)
}

export async function exportAsHtml(
  pdfDocument: PDFDocumentProxy,
  pdfFileName: string,
  explanations: Record<number, string>,
  pageCount: number,
  exportScale: number,
  includeAllPages: boolean,
  onProgress?: (done: number, total: number) => void,
) {
  const pages = includeAllPages
    ? allPages(pageCount)
    : sortedParsedPages(explanations)

  const body = await buildBody(
    pdfDocument,
    explanations,
    pages,
    exportScale,
    onProgress,
  )
  const html = wrapHtml(pdfFileName, body, false)
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
  downloadBlob(blob, `${stripExt(pdfFileName)}_讲解_${dateTag()}.html`)
}

export async function exportAsPdf(
  pdfDocument: PDFDocumentProxy,
  pdfFileName: string,
  explanations: Record<number, string>,
  pageCount: number,
  exportScale: number,
  includeAllPages: boolean,
  onProgress?: (done: number, total: number) => void,
) {
  const pages = includeAllPages
    ? allPages(pageCount)
    : sortedParsedPages(explanations)

  const pageImagesBase64: Record<string, string> = {}
  for (let index = 0; index < pages.length; index += 1) {
    const pageNum = pages[index]
    onProgress?.(index, pages.length)
    const image = await renderPdfPageToDataUrl(pdfDocument, pageNum, exportScale)
    pageImagesBase64[String(pageNum)] = image.dataUrl.replace(/^data:image\/png;base64,/, '')
  }
  onProgress?.(pages.length, pages.length)

  const response = await fetch(`${API_BASE}/export/pdf`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      pdf_file_name: pdfFileName,
      pages,
      page_images_base64: pageImagesBase64,
      explanations: Object.fromEntries(
        Object.entries(explanations).map(([key, value]) => [String(key), value]),
      ),
    }),
  })

  if (!response.ok) {
    throw new Error(await response.text())
  }

  const blob = await response.blob()
  const filename = getFilenameFromDisposition(response.headers.get('Content-Disposition'))
    || `${stripExt(pdfFileName)} - BookLearning 讲解.pdf`
  downloadBlob(blob, filename)
}

function sortedParsedPages(explanations: Record<number, string>): number[] {
  return Object.keys(explanations)
    .map(Number)
    .filter((pageNum) => explanations[pageNum]?.trim())
    .sort((a, b) => a - b)
}

function allPages(pageCount: number): number[] {
  return Array.from({ length: pageCount }, (_, index) => index + 1)
}

async function buildBody(
  pdfDocument: PDFDocumentProxy,
  explanations: Record<number, string>,
  pages: number[],
  exportScale: number,
  onProgress?: (done: number, total: number) => void,
): Promise<string> {
  const allData: PageData[] = []

  for (let index = 0; index < pages.length; index += 1) {
    const pageNum = pages[index]
    onProgress?.(index, pages.length)

    const image = await renderPdfPageToDataUrl(pdfDocument, pageNum, exportScale)
    const explanation = explanations[pageNum]?.trim() || ''

    allData.push({
      pageNum,
      dataUrl: image.dataUrl,
      explanation,
    })
  }

  onProgress?.(pages.length, pages.length)

  return allData
    .map((pageData) => buildPageSheets(pageData))
    .join('\n')
}

function buildPageSheets(pageData: PageData): string {
  const explanation = pageData.explanation.trim()

  if (!explanation) {
    return buildFirstSheet(pageData, '', true)
  }

  const chunks = paginateExplanation(explanation)
  const sheets: string[] = []

  sheets.push(buildFirstSheet(pageData, chunks.firstHtml, false))

  for (const continuation of chunks.continuations) {
    sheets.push(buildContinuationSheet(pageData.pageNum, continuation))
  }

  return sheets.join('\n')
}

function paginateExplanation(explanation: string): {
  firstHtml: string
  continuations: ContinuationSheet[]
} {
  const blocks = splitMarkdownBlocks(explanation)
  const firstBlocks = consumeBlocks(blocks, FIRST_PAGE_TEXT_CAPACITY)
  const continuations: ContinuationSheet[] = []

  while (blocks.length > 0) {
    const leftBlocks = consumeBlocks(blocks, CONTINUATION_COLUMN_CAPACITY)
    const rightBlocks = consumeBlocks(blocks, CONTINUATION_COLUMN_CAPACITY)

    continuations.push({
      leftHtml: renderBlocks(leftBlocks),
      rightHtml: renderBlocks(rightBlocks),
    })
  }

  return {
    firstHtml: renderBlocks(firstBlocks),
    continuations,
  }
}

function splitMarkdownBlocks(markdown: string): string[] {
  return markdown
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
}

function consumeBlocks(blocks: string[], capacity: number): string[] {
  const collected: string[] = []
  let used = 0

  while (blocks.length > 0) {
    const next = blocks[0]
    const cost = blockCost(next)
    const willOverflow = used + cost > capacity

    if (willOverflow && collected.length > 0) {
      break
    }

    collected.push(blocks.shift()!)
    used += cost

    if (willOverflow) {
      break
    }
  }

  return collected
}

function blockCost(block: string): number {
  const text = block
    .replace(/!\[[^\]]*]\([^)]*\)/g, '')
    .replace(/\[[^\]]*]\([^)]*\)/g, '$1')
    .replace(/[`*_>#-]/g, '')
    .trim()

  const paragraphCount = Math.max(1, block.split('\n').length)
  const headingBonus = /^#{1,6}\s/m.test(block) ? 140 : 0
  const listBonus = /^(\s*[-*+]|\s*\d+\.)\s/m.test(block) ? 100 : 0
  const tableBonus = /\|/.test(block) ? 180 : 0

  return text.length + paragraphCount * 55 + headingBonus + listBonus + tableBonus
}

function renderBlocks(blocks: string[]): string {
  if (blocks.length === 0) {
    return ''
  }

  return marked.parse(blocks.join('\n\n')) as string
}

function buildFirstSheet(
  pageData: PageData,
  explanationHtml: string,
  isEmptyExplanation: boolean,
): string {
  return `
    <section class="export-sheet">
      <div class="sheet-grid sheet-grid--first">
        <div class="sheet-panel sheet-panel--pdf">
          <span class="page-label">P${pageData.pageNum}</span>
          <img src="${pageData.dataUrl}" alt="Page ${pageData.pageNum}" />
        </div>
        <div class="sheet-panel sheet-panel--text">
          ${
            isEmptyExplanation
              ? `<div class="explanation-empty">暂无讲解</div>`
              : `<div class="explanation-content">${explanationHtml}</div>`
          }
        </div>
      </div>
    </section>
  `
}

function buildContinuationSheet(
  pageNum: number,
  continuation: ContinuationSheet,
): string {
  return `
    <section class="export-sheet export-sheet--continuation">
      <div class="sheet-grid sheet-grid--continuation">
        <div class="sheet-panel sheet-panel--text">
          <div class="continuation-marker">P${pageNum} 讲解续页</div>
          <div class="explanation-content">${continuation.leftHtml || ''}</div>
        </div>
        <div class="sheet-panel sheet-panel--text">
          <div class="explanation-content">${continuation.rightHtml || ''}</div>
        </div>
      </div>
    </section>
  `
}

function wrapHtml(title: string, body: string, forPrint: boolean): string {
  const printStyles = forPrint
    ? `
    @page {
      size: A4 landscape;
      margin: 8mm;
    }
    body {
      background: #fff;
    }
    .export-header {
      display: none;
    }
    .export-sheet {
      page-break-after: always;
    }
    .export-sheet:last-of-type {
      page-break-after: auto;
    }
    .sheet-grid,
    .sheet-panel,
    .page-label,
    .continuation-marker {
      break-inside: auto;
      page-break-inside: auto;
    }
    .sheet-panel--pdf img {
      break-inside: avoid;
      page-break-inside: avoid;
    }
    `
    : ''

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} - BookLearning 讲解</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, "Microsoft YaHei", "PingFang SC", sans-serif;
    color: #333;
    background: #f8f6f2;
    line-height: 1.6;
  }
  .export-header {
    padding: 20px 32px;
    border-bottom: 2px solid #e8e0d4;
    background: #fffbf6;
  }
  .export-header h1 { font-size: 1.3rem; color: #4a3520; }
  .export-header p { font-size: 0.85rem; color: #8a7a6a; margin-top: 4px; }

  .export-sheet {
    margin: 16px 24px;
    border: 1px solid #e0d8cc;
    border-radius: 12px;
    background: #fff;
    overflow: hidden;
  }
  .export-sheet--continuation {
    padding-top: 0;
  }
  .sheet-grid {
    display: grid;
    min-height: 200px;
    align-items: start;
  }
  .sheet-grid--first,
  .sheet-grid--continuation {
    grid-template-columns: 1fr 1fr;
  }
  .sheet-panel {
    min-width: 0;
    min-height: 100%;
  }
  .sheet-panel--pdf {
    padding: 12px;
    border-right: 1px solid #e0d8cc;
    background: #faf8f4;
    position: relative;
  }
  .sheet-panel--pdf img {
    display: block;
    width: 100%;
    height: auto;
    border-radius: 4px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.08);
  }
  .sheet-panel--text {
    padding: 16px 20px;
    overflow: hidden;
  }
  .continuation-marker {
    margin-bottom: 10px;
    color: #8a6d52;
    font-size: 0.82rem;
    font-weight: 700;
  }

  .page-label {
    position: absolute;
    top: 4px;
    left: 4px;
    background: rgba(74,53,32,0.75);
    color: #fff;
    font-size: 0.72rem;
    font-weight: 700;
    padding: 2px 8px;
    border-radius: 4px;
    z-index: 1;
  }

  .explanation-empty {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100%;
    color: #9a8c7c;
    font-size: 1rem;
    border: 1px dashed #dfd4c6;
    border-radius: 8px;
    background: #fcfaf7;
    padding: 16px;
    text-align: center;
  }

  .explanation-content {
    font-size: 0.88rem;
    line-height: 1.72;
    word-break: break-word;
    overflow-wrap: anywhere;
  }
  .explanation-content h1 { font-size: 1.16rem; margin: 0.8em 0 0.4em; }
  .explanation-content h2 { font-size: 1.02rem; margin: 0.7em 0 0.3em; }
  .explanation-content h3 { font-size: 0.94rem; margin: 0.6em 0 0.3em; }
  .explanation-content p { margin: 0.45em 0; }
  .explanation-content ul, .explanation-content ol { padding-left: 1.4em; margin: 0.4em 0; }
  .explanation-content li { margin: 0.2em 0; }
  .explanation-content code {
    padding: 1px 5px;
    border-radius: 4px;
    background: rgba(178,110,24,0.08);
    font-family: Consolas, "Courier New", monospace;
    font-size: 0.87em;
  }
  .explanation-content pre {
    padding: 10px 12px;
    border-radius: 8px;
    background: #f5f0ea;
    overflow-x: auto;
    margin: 0.5em 0;
  }
  .explanation-content pre code { background: transparent; padding: 0; }
  .explanation-content blockquote {
    margin: 0.5em 0;
    padding: 6px 12px;
    border-left: 3px solid #b26e18;
    background: rgba(178,110,24,0.04);
  }
  .explanation-content table {
    width: 100%;
    border-collapse: collapse;
    margin: 0.5em 0;
    table-layout: fixed;
  }
  .explanation-content th, .explanation-content td {
    padding: 6px 8px;
    border: 1px solid #e0d8cc;
    text-align: left;
    word-break: break-word;
  }
  .explanation-content th { background: #f5efe6; font-weight: 600; }
  .explanation-content strong { color: #4a3520; }

  @media screen and (max-width: 1100px) {
    .sheet-grid--first,
    .sheet-grid--continuation {
      grid-template-columns: 1fr;
    }
    .sheet-panel--pdf {
      border-right: none;
      border-bottom: 1px solid #e0d8cc;
    }
  }

  @media print {
    .export-sheet {
      margin: 0;
      border: none;
      border-radius: 0;
    }
    .sheet-panel--pdf {
      border-right: 1px solid #ccc;
      background: #fff;
    }
    .continuation-marker {
      margin-bottom: 8px;
    }
    ${printStyles}
  }
</style>
</head>
<body>
  <div class="export-header">
    <h1>${escapeHtml(title)} - BookLearning 讲解</h1>
    <p>导出时间：${new Date().toLocaleString('zh-CN')}</p>
  </div>
  ${body}
</body>
</html>`
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

function stripExt(filename: string): string {
  return filename.replace(/\.[^.]+$/, '')
}

function dateTag(): string {
  const date = new Date()
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`
}

function getFilenameFromDisposition(contentDisposition: string | null): string | null {
  if (!contentDisposition) {
    return null
  }

  const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i)
  if (utf8Match?.[1]) {
    return decodeURIComponent(utf8Match[1])
  }

  const match = contentDisposition.match(/filename="([^"]+)"/i)
  return match?.[1] ?? null
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
