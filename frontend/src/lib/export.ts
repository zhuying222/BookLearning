import katexCssText from 'katex/dist/katex.min.css?inline'
import { toPng } from 'html-to-image'
import type { PDFDocumentProxy } from 'pdfjs-dist'

import { renderPdfPageToDataUrl } from './pdf'
import { renderExplanationMarkdown } from './renderMarkdown'
const API_BASE = 'http://localhost:8000/api/v1'
const CAPTURE_HEIGHT_SCALE = 1.2
const MIN_CAPTURE_HEIGHT = 920
const MAX_CAPTURE_HEIGHT = 1180
const SHEET_WIDTH_MULTIPLIER = 2.08
const PDF_EXPORT_CHUNK_SIZE = 4
export const MIN_EXPORT_EXPLANATION_FONT_SIZE = 13
export const MAX_EXPORT_EXPLANATION_FONT_SIZE = 24
export const DEFAULT_EXPORT_EXPLANATION_FONT_SIZE = 15

type PageData = {
  pageNum: number
  dataUrl: string
  explanation: string
  width: number
  height: number
}

type ExportSheet = {
  html: string
  captureWidth: number
  captureHeight: number
  pageWidthPt: number
  pageHeightPt: number
  layout: Required<ExportLayoutOptions>
}

type ContinuationSheet = {
  leftHtml: string
  rightHtml: string
}

type SheetMetrics = {
  captureWidth: number
  captureHeight: number
  pageWidthPt: number
  pageHeightPt: number
}

type PendingSheetUpload = {
  imageBase64: string
  pageSize: {
    width: number
    height: number
  }
}

export type ExportLayoutOptions = {
  explanationFontSizePx?: number
}

export type PdfExportProgress = {
  phase: 'render' | 'upload' | 'finalize'
  done: number
  total: number
}

const MAX_BLOCK_COST = 900

function resolveExportLayoutOptions(layoutOptions?: ExportLayoutOptions): Required<ExportLayoutOptions> {
  return {
    explanationFontSizePx: clampNumber(
      Math.round(layoutOptions?.explanationFontSizePx ?? DEFAULT_EXPORT_EXPLANATION_FONT_SIZE),
      MIN_EXPORT_EXPLANATION_FONT_SIZE,
      MAX_EXPORT_EXPLANATION_FONT_SIZE,
    ),
  }
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
  layoutOptions?: ExportLayoutOptions,
  onProgress?: (done: number, total: number) => void,
) {
  const layout = resolveExportLayoutOptions(layoutOptions)
  const pages = includeAllPages
    ? allPages(pageCount)
    : sortedParsedPages(explanations)

  const sheets = await buildSheets(
    pdfDocument,
    explanations,
    pages,
    exportScale,
    layout,
    onProgress,
  )
  const html = wrapHtml(
    pdfFileName,
    sheets.map((sheet) => sheet.html).join('\n'),
    false,
    layout,
  )
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
  layoutOptions?: ExportLayoutOptions,
  onProgress?: (progress: PdfExportProgress) => void,
) {
  const layout = resolveExportLayoutOptions(layoutOptions)
  const pages = includeAllPages
    ? allPages(pageCount)
    : sortedParsedPages(explanations)

  const sessionId = await createPdfExportSession(pdfFileName)
  const pendingChunk: PendingSheetUpload[] = []
  let chunkIndex = 0
  let uploadedSheetCount = 0

  for (let index = 0; index < pages.length; index += 1) {
    const pageNum = pages[index]
    onProgress?.({
      phase: 'render',
      done: index,
      total: Math.max(1, pages.length),
    })

    const image = await renderPdfPageToDataUrl(pdfDocument, pageNum, exportScale)
    const explanation = explanations[pageNum]?.trim() || ''
    const pageData: PageData = {
      pageNum,
      dataUrl: image.dataUrl,
      explanation,
      width: image.width,
      height: image.height,
    }
    const pageSheets = await buildPageSheets(pageData, exportScale, layout)

    for (const sheet of pageSheets) {
      pendingChunk.push({
        imageBase64: await renderSheetToBase64(sheet),
        pageSize: {
          width: sheet.pageWidthPt,
          height: sheet.pageHeightPt,
        },
      })

      if (pendingChunk.length >= PDF_EXPORT_CHUNK_SIZE) {
        uploadedSheetCount = await uploadPdfSheetChunk(sessionId, chunkIndex, pendingChunk)
        chunkIndex += 1
        pendingChunk.length = 0
        onProgress?.({
          phase: 'upload',
          done: uploadedSheetCount,
          total: 0,
        })
      }
    }
  }

  onProgress?.({
    phase: 'render',
    done: pages.length,
    total: Math.max(1, pages.length),
  })

  if (pendingChunk.length > 0) {
    uploadedSheetCount = await uploadPdfSheetChunk(sessionId, chunkIndex, pendingChunk)
    onProgress?.({
      phase: 'upload',
      done: uploadedSheetCount,
      total: 0,
    })
  }

  onProgress?.({
    phase: 'finalize',
    done: uploadedSheetCount,
    total: uploadedSheetCount,
  })

  const response = await fetch(`${API_BASE}/export/pdf/session/${sessionId}/finalize`, {
    method: 'POST',
  })

  if (!response.ok) {
    throw new Error(await readErrorMessage(response))
  }

  const blob = await response.blob()
  const filename = getFilenameFromDisposition(response.headers.get('Content-Disposition'))
    || `${stripExt(pdfFileName)} - BookLearning 讲解.pdf`
  downloadBlob(blob, filename)
}

export async function renderPdfExportPreview(
  pdfDocument: PDFDocumentProxy,
  pageNum: number,
  explanation: string,
  exportScale: number,
  layoutOptions?: ExportLayoutOptions,
): Promise<string> {
  const layout = resolveExportLayoutOptions(layoutOptions)
  const image = await renderPdfPageToDataUrl(pdfDocument, pageNum, exportScale)
  const pageData: PageData = {
    pageNum,
    dataUrl: image.dataUrl,
    explanation: explanation.trim(),
    width: image.width,
    height: image.height,
  }
  const pageSheets = await buildPageSheets(pageData, exportScale, layout)
  const firstSheet = pageSheets[0]

  if (!firstSheet) {
    throw new Error('Failed to build export preview.')
  }

  return renderSheetToDataUrl(firstSheet)
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

async function buildSheets(
  pdfDocument: PDFDocumentProxy,
  explanations: Record<number, string>,
  pages: number[],
  exportScale: number,
  layout: Required<ExportLayoutOptions>,
  onProgress?: (done: number, total: number) => void,
): Promise<ExportSheet[]> {
  const allSheets: ExportSheet[] = []

  for (let index = 0; index < pages.length; index += 1) {
    const pageNum = pages[index]
    onProgress?.(index, Math.max(1, pages.length * 2))

    const image = await renderPdfPageToDataUrl(pdfDocument, pageNum, exportScale)
    const explanation = explanations[pageNum]?.trim() || ''
    const pageData: PageData = {
      pageNum,
      dataUrl: image.dataUrl,
      explanation,
      width: image.width,
      height: image.height,
    }
    allSheets.push(...await buildPageSheets(pageData, exportScale, layout))
  }

  onProgress?.(pages.length, Math.max(1, pages.length * 2))
  return allSheets
}

async function buildPageSheets(
  pageData: PageData,
  exportScale: number,
  layout: Required<ExportLayoutOptions>,
): Promise<ExportSheet[]> {
  const explanation = pageData.explanation.trim()
  const metrics = buildSheetMetrics(pageData, exportScale)

  if (!explanation) {
    return [{
      html: buildFirstSheet(pageData, '', true),
      ...metrics,
      layout,
    }]
  }

  const chunks = await paginateExplanation(pageData, explanation, metrics, layout)
  const sheets: ExportSheet[] = []

  sheets.push({
    html: buildFirstSheet(pageData, chunks.firstHtml, false),
    ...metrics,
    layout,
  })

  for (const continuation of chunks.continuations) {
    sheets.push({
      html: buildContinuationSheet(pageData.pageNum, continuation),
      ...metrics,
      layout,
    })
  }

  return sheets
}

async function paginateExplanation(
  pageData: PageData,
  explanation: string,
  metrics: SheetMetrics,
  layout: Required<ExportLayoutOptions>,
): Promise<{
  firstHtml: string
  continuations: ContinuationSheet[]
}> {
  const blocks = expandBlocksForPagination(normalizeExportBlocks(splitMarkdownBlocks(explanation)))
  const continuations: ContinuationSheet[] = []
  const firstHost = createMeasurementHost({
    html: buildFirstSheet(pageData, '', false),
    ...metrics,
    layout,
  })
  await waitForCaptureReady(firstHost)
  const firstTarget = firstHost.querySelector('.text-surface')
  if (!(firstTarget instanceof HTMLElement)) {
    destroyMeasurementHost(firstHost)
    throw new Error('Failed to measure first export sheet.')
  }
  const firstBlocks = consumeBlocksByHeight(blocks, firstTarget)
  destroyMeasurementHost(firstHost)

  while (blocks.length > 0) {
    const continuationHost = createMeasurementHost({
      html: buildContinuationSheet(pageData.pageNum, { leftHtml: '', rightHtml: '' }),
      ...metrics,
      layout,
    })
    await waitForCaptureReady(continuationHost)
    const targets = continuationHost.querySelectorAll('.text-surface')
    const leftTarget = targets[0]
    const rightTarget = targets[1]
    if (!(leftTarget instanceof HTMLElement) || !(rightTarget instanceof HTMLElement)) {
      destroyMeasurementHost(continuationHost)
      throw new Error('Failed to measure continuation export sheet.')
    }

    const leftBlocks = consumeBlocksByHeight(blocks, leftTarget)
    const rightBlocks = consumeBlocksByHeight(blocks, rightTarget)
    destroyMeasurementHost(continuationHost)

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
  const blocks: string[] = []
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const current: string[] = []
  let inFence = false
  let fenceMarker = ''
  let inDisplayMath = false

  const flush = () => {
    const block = current.join('\n').trim()
    if (block) {
      blocks.push(block)
    }
    current.length = 0
  }

  for (const line of lines) {
    const trimmed = line.trim()

    if (!inFence && !inDisplayMath && trimmed === '') {
      flush()
      continue
    }

    current.push(line)

    const fenceMatch = trimmed.match(/^(`{3,}|~{3,})/)
    if (fenceMatch) {
      if (!inFence) {
        inFence = true
        fenceMarker = fenceMatch[1]
      } else if (trimmed.startsWith(fenceMarker[0]) && trimmed.length >= fenceMarker.length) {
        inFence = false
        fenceMarker = ''
      }
    }

    if (!inFence && countUnescapedDoubleDollar(line) % 2 === 1) {
      inDisplayMath = !inDisplayMath
    }
  }

  flush()
  return blocks
}

function normalizeExportBlocks(blocks: string[]): string[] {
  const normalized: string[] = []
  let carry = ''

  for (const block of blocks) {
    const combined = carry ? `${carry}\n\n${block}` : block
    if (isStickyLeadingBlock(combined)) {
      carry = combined
      continue
    }
    normalized.push(combined)
    carry = ''
  }

  if (carry) {
    normalized.push(carry)
  }

  return normalized
}

function isStickyLeadingBlock(block: string): boolean {
  const trimmed = block.trim()
  return trimmed === '---' || /^#{1,6}\s[^\n]+$/.test(trimmed)
}

function renderBlocks(blocks: string[]): string {
  if (blocks.length === 0) {
    return ''
  }

  return renderExplanationMarkdown(blocks.join('\n\n'))
}

function expandBlocksForPagination(blocks: string[]): string[] {
  const expanded: string[] = []

  for (const block of blocks) {
    expanded.push(...splitLargeBlockForPagination(block))
  }

  return expanded
}

function buildSheetMetrics(pageData: PageData, exportScale: number): SheetMetrics {
  const pageWidthPt = pageData.width / exportScale
  const pageHeightPt = pageData.height / exportScale
  const captureHeight = clampNumber(
    Math.round(pageHeightPt * CAPTURE_HEIGHT_SCALE),
    MIN_CAPTURE_HEIGHT,
    MAX_CAPTURE_HEIGHT,
  )
  const captureWidth = Math.round(captureHeight * (pageWidthPt / pageHeightPt) * SHEET_WIDTH_MULTIPLIER)

  return {
    captureWidth,
    captureHeight,
    pageWidthPt: roundTo(pageHeightPt * (captureWidth / captureHeight), 2),
    pageHeightPt: roundTo(pageHeightPt, 2),
  }
}

function consumeBlocksByHeight(blocks: string[], container: HTMLElement): string[] {
  const collected: string[] = []
  const contentRoot = container.querySelector('.explanation-content')
  if (!(contentRoot instanceof HTMLElement)) {
    return collected
  }
  contentRoot.innerHTML = ''

  while (blocks.length > 0) {
    const next = blocks[0]
    const probe = document.createElement('div')
    probe.style.display = 'flow-root'
    probe.innerHTML = renderExplanationMarkdown(next)
    contentRoot.appendChild(probe)

    const willOverflow = container.scrollHeight > container.clientHeight + 1
    if (willOverflow) {
      contentRoot.removeChild(probe)
      if (collected.length === 0) {
        const splitBlocks = splitOversizedBlockForMeasurement(next)
        if (splitBlocks.length > 1) {
          blocks.splice(0, 1, ...splitBlocks)
          continue
        }
        contentRoot.appendChild(probe)
        collected.push(blocks.shift()!)
      }
      break
    }

    collected.push(blocks.shift()!)
  }

  return collected
}

function blockCost(block: string): number {
  const text = block
    .replace(/!\[[^\]]*]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
    .replace(/[`*_>#-]/g, '')
    .trim()

  const paragraphCount = Math.max(1, block.split('\n').length)
  const headingBonus = /^#{1,6}\s/m.test(block) ? 140 : 0
  const listBonus = /^(\s*[-*+]|\s*\d+\.)\s/m.test(block) ? 100 : 0
  const tableBonus = /\|/.test(block) ? 180 : 0

  return text.length + paragraphCount * 55 + headingBonus + listBonus + tableBonus
}

function splitOversizedBlockForMeasurement(block: string): string[] {
  const aggressive = splitLargeBlockForPagination(block, true)
  if (aggressive.length > 1) {
    return aggressive
  }

  const lineChunks = splitMultilineBlock(block)
  if (lineChunks.length > 1) {
    return lineChunks
  }

  return [block]
}

function splitLargeBlockForPagination(block: string, force = false): string[] {
  const cost = blockCost(block)
  if (!force && cost <= MAX_BLOCK_COST) {
    return [block]
  }

  const trimmed = block.trim()
  if (!trimmed || isStickyLeadingBlock(trimmed) || isFenceBlock(trimmed) || isDisplayMathBlock(trimmed) || isTableBlock(trimmed)) {
    return [block]
  }

  const targetChunkLength = force ? 90 : 140

  const headingChunks = splitHeadingPrefixedBlock(block, targetChunkLength)
  if (headingChunks.length > 1) {
    return headingChunks.flatMap((item) => splitLargeBlockForPagination(item, force))
  }

  const listItems = splitListBlock(block)
  if (listItems.length > 1) {
    return listItems.flatMap((item) => splitLargeBlockForPagination(item, force))
  }

  const singleListItemChunks = splitSingleListItemBlock(block, targetChunkLength)
  if (singleListItemChunks.length > 1) {
    return singleListItemChunks.flatMap((item) => splitLargeBlockForPagination(item, force))
  }

  const paragraphChunks = splitParagraphBlock(block, targetChunkLength)
  if (paragraphChunks.length > 1) {
    return paragraphChunks.flatMap((item) => splitLargeBlockForPagination(item, force))
  }

  return [block]
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
          <div class="text-surface">
            ${
              isEmptyExplanation
                ? `<div class="explanation-empty">暂无讲解</div>`
                : `<div class="explanation-content">${explanationHtml}</div>`
            }
          </div>
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
        <div class="sheet-panel sheet-panel--text sheet-panel--text-continued">
          <span class="page-label page-label--continuation">P${pageNum}+</span>
          <div class="text-surface text-surface--continuation">
            <div class="continuation-marker">第 ${pageNum} 页讲解续页</div>
            <div class="explanation-content">${continuation.leftHtml || ''}</div>
          </div>
        </div>
        <div class="sheet-panel sheet-panel--text">
          <div class="text-surface text-surface--continuation">
            <div class="explanation-content">${continuation.rightHtml || ''}</div>
          </div>
        </div>
      </div>
    </section>
  `
}

function wrapHtml(
  title: string,
  body: string,
  forPrint: boolean,
  layout: Required<ExportLayoutOptions>,
): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} - BookLearning 讲解</title>
<style>
  ${buildExportStyles(forPrint, layout)}
</style>
</head>
<body>
  ${buildExportBody(title, body)}
</body>
</html>`
}

function buildExportStyles(forPrint: boolean, layout: Required<ExportLayoutOptions>): string {
  const exportModeStyles = forPrint
    ? `
  body {
    background: #fff;
  }
  .export-header {
    display: none;
  }
  .export-sheet {
    page-break-after: always;
    break-after: page;
  }
  .export-sheet:last-of-type {
    page-break-after: auto;
    break-after: auto;
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

  return `
  ${katexCssText}
  :root {
    --export-explanation-font-size: ${layout.explanationFontSizePx}px;
  }
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
    border-radius: 14px;
    background:
      linear-gradient(180deg, #fffdf9 0%, #fffaf4 100%);
    box-shadow: 0 8px 22px rgba(93, 66, 35, 0.08);
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
    padding: 14px 16px;
    overflow: hidden;
    position: relative;
    background: linear-gradient(180deg, #fffefc 0%, #fcf8f2 100%);
  }
  .continuation-marker {
    margin-bottom: 12px;
    color: #8a6d52;
    font-size: 0.82rem;
    font-weight: 700;
    letter-spacing: 0.02em;
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
  .page-label--continuation {
    top: 8px;
    left: 8px;
    background: linear-gradient(135deg, #5f4325 0%, #8d673e 100%);
    box-shadow: 0 6px 14px rgba(95, 67, 37, 0.24);
  }
  .sheet-panel--text-continued {
    padding-top: 32px;
  }
  .text-surface {
    height: 100%;
    min-height: 0;
    border: 1px solid #eadfce;
    border-radius: 12px;
    background:
      linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(252,247,239,0.96) 100%);
    box-shadow:
      inset 0 1px 0 rgba(255,255,255,0.9),
      0 2px 8px rgba(103, 76, 44, 0.05);
    padding: 16px 18px;
    overflow: hidden;
  }
  .text-surface--continuation {
    padding-top: 18px;
  }

  .explanation-empty {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100%;
    color: #9a8c7c;
    font-size: 1em;
    border: 1px dashed #dfd4c6;
    border-radius: 8px;
    background: #fcfaf7;
    padding: 16px;
    text-align: center;
  }

  .explanation-content {
    font-size: var(--export-explanation-font-size, 15px);
    line-height: 1.72;
    word-break: break-word;
    overflow-wrap: anywhere;
  }
  .explanation-content h1 { font-size: 1.32em; margin: 0.8em 0 0.4em; }
  .explanation-content h2 { font-size: 1.16em; margin: 0.7em 0 0.3em; }
  .explanation-content h3 { font-size: 1.07em; margin: 0.6em 0 0.3em; }
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
  .explanation-content .katex {
    font-size: 1.02em;
  }
  .explanation-content .katex-display {
    margin: 0.7em 0;
    overflow-x: auto;
    overflow-y: hidden;
    padding: 0.2em 0;
  }

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
  ${exportModeStyles}
  `
}

function buildCaptureStyles(): string {
  return `
  ${katexCssText}
  .booklearning-export-capture,
  .booklearning-export-capture * {
    box-sizing: border-box;
  }
  .booklearning-export-capture {
    width: var(--capture-sheet-width, 1400px);
    height: var(--capture-sheet-height, 990px);
    margin: 0;
    padding: 0;
    background: #ffffff;
    color: #333;
    font-family: -apple-system, "Microsoft YaHei", "PingFang SC", sans-serif;
    line-height: 1.6;
    --export-explanation-font-size: 15px;
  }
  .booklearning-export-capture .export-sheet {
    width: 100%;
    height: 100%;
    margin: 0;
    border: 1px solid #e0d8cc;
    border-radius: 0;
    background:
      linear-gradient(180deg, #fffdf9 0%, #fffaf4 100%);
    box-shadow: none;
    overflow: hidden;
  }
  .booklearning-export-capture .sheet-grid {
    display: grid;
    width: 100%;
    height: 100%;
    min-height: 0;
    align-items: stretch;
  }
  .booklearning-export-capture .sheet-grid--first,
  .booklearning-export-capture .sheet-grid--continuation {
    grid-template-columns: 1fr 1fr;
  }
  .booklearning-export-capture .sheet-panel {
    min-width: 0;
    min-height: 0;
    height: 100%;
  }
  .booklearning-export-capture .sheet-panel--pdf {
    position: relative;
    padding: 12px;
    border-right: 1px solid #e0d8cc;
    background: #faf8f4;
  }
  .booklearning-export-capture .sheet-panel--pdf img {
    display: block;
    width: 100%;
    height: calc(100% - 8px);
    object-fit: contain;
    border-radius: 4px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
    background: #fff;
  }
  .booklearning-export-capture .sheet-panel--text {
    padding: 14px 16px;
    overflow: hidden;
    position: relative;
    background: linear-gradient(180deg, #fffefc 0%, #fcf8f2 100%);
  }
  .booklearning-export-capture .sheet-panel--text-continued {
    padding-top: 32px;
  }
  .booklearning-export-capture .page-label {
    position: absolute;
    top: 4px;
    left: 4px;
    background: rgba(74, 53, 32, 0.75);
    color: #fff;
    font-size: 0.72rem;
    font-weight: 700;
    padding: 2px 8px;
    border-radius: 4px;
    z-index: 1;
  }
  .booklearning-export-capture .page-label--continuation {
    top: 8px;
    left: 8px;
    background: linear-gradient(135deg, #5f4325 0%, #8d673e 100%);
    box-shadow: 0 6px 14px rgba(95, 67, 37, 0.24);
  }
  .booklearning-export-capture .text-surface {
    height: 100%;
    min-height: 0;
    border: 1px solid #eadfce;
    border-radius: 12px;
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.98) 0%, rgba(252, 247, 239, 0.96) 100%);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.9),
      0 2px 8px rgba(103, 76, 44, 0.05);
    padding: 16px 18px;
    overflow: hidden;
  }
  .booklearning-export-capture .text-surface--continuation {
    padding-top: 18px;
  }
  .booklearning-export-capture .continuation-marker {
    margin-bottom: 12px;
    color: #8a6d52;
    font-size: 0.82rem;
    font-weight: 700;
    letter-spacing: 0.02em;
  }
  .booklearning-export-capture .explanation-empty {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100%;
    color: #9a8c7c;
    font-size: 1em;
    border: 1px dashed #dfd4c6;
    border-radius: 8px;
    background: #fcfaf7;
    padding: 16px;
    text-align: center;
  }
  .booklearning-export-capture .explanation-content {
    font-size: var(--export-explanation-font-size, 15px);
    line-height: 1.72;
    word-break: break-word;
    overflow-wrap: anywhere;
  }
  .booklearning-export-capture .explanation-content h1 { font-size: 1.32em; margin: 0.8em 0 0.4em; }
  .booklearning-export-capture .explanation-content h2 { font-size: 1.16em; margin: 0.7em 0 0.3em; }
  .booklearning-export-capture .explanation-content h3 { font-size: 1.07em; margin: 0.6em 0 0.3em; }
  .booklearning-export-capture .explanation-content p { margin: 0.45em 0; }
  .booklearning-export-capture .explanation-content ul,
  .booklearning-export-capture .explanation-content ol { padding-left: 1.4em; margin: 0.4em 0; }
  .booklearning-export-capture .explanation-content li { margin: 0.2em 0; }
  .booklearning-export-capture .explanation-content code {
    padding: 1px 5px;
    border-radius: 4px;
    background: rgba(178, 110, 24, 0.08);
    font-family: Consolas, "Courier New", monospace;
    font-size: 0.87em;
  }
  .booklearning-export-capture .explanation-content pre {
    padding: 10px 12px;
    border-radius: 8px;
    background: #f5f0ea;
    overflow: hidden;
    margin: 0.5em 0;
  }
  .booklearning-export-capture .explanation-content pre code { background: transparent; padding: 0; }
  .booklearning-export-capture .explanation-content blockquote {
    margin: 0.5em 0;
    padding: 6px 12px;
    border-left: 3px solid #b26e18;
    background: rgba(178, 110, 24, 0.04);
  }
  .booklearning-export-capture .explanation-content table {
    width: 100%;
    border-collapse: collapse;
    margin: 0.5em 0;
    table-layout: fixed;
  }
  .booklearning-export-capture .explanation-content th,
  .booklearning-export-capture .explanation-content td {
    padding: 6px 8px;
    border: 1px solid #e0d8cc;
    text-align: left;
    word-break: break-word;
  }
  .booklearning-export-capture .explanation-content th { background: #f5efe6; font-weight: 600; }
  .booklearning-export-capture .explanation-content strong { color: #4a3520; }
  .booklearning-export-capture .explanation-content .katex {
    font-size: 1.02em;
  }
  .booklearning-export-capture .explanation-content .katex-display {
    margin: 0.7em 0;
    overflow: hidden;
    padding: 0.2em 0;
  }
  `
}

function isFenceBlock(block: string): boolean {
  return /^(`{3,}|~{3,})/.test(block)
}

function isDisplayMathBlock(block: string): boolean {
  return /^\$\$[\s\S]*\$\$$/.test(block)
}

function isTableBlock(block: string): boolean {
  const lines = block.split('\n').map((line) => line.trim()).filter(Boolean)
  if (lines.length < 2) {
    return false
  }

  return lines[0].includes('|') && /^[:|\-\s]+$/.test(lines[1])
}

function splitListBlock(block: string): string[] {
  const lines = block.replace(/\r\n/g, '\n').split('\n')
  const items: string[] = []
  let current: string[] = []

  for (const line of lines) {
    if (/^\s*(?:[-*+]|\d+\.)\s+/.test(line)) {
      if (current.length > 0) {
        items.push(current.join('\n').trim())
      }
      current = [line]
      continue
    }

    if (current.length > 0) {
      current.push(line)
    } else {
      return [block]
    }
  }

  if (current.length > 0) {
    items.push(current.join('\n').trim())
  }

  return items.length > 1 ? items : [block]
}

function splitHeadingPrefixedBlock(block: string, targetChunkLength: number): string[] {
  const normalized = block.replace(/\r\n/g, '\n')
  const lines = normalized.split('\n')
  const heading = lines[0]?.trim()

  if (!heading || !/^#{1,6}\s+/.test(heading) || lines.length < 2) {
    return [block]
  }

  const body = lines.slice(1).join('\n').trim()
  if (!body) {
    return [block]
  }

  const bodyChunks = splitParagraphBlock(body, targetChunkLength)
  if (bodyChunks.length <= 1) {
    return [block]
  }

  return [`${heading}\n\n${bodyChunks[0]}`, ...bodyChunks.slice(1)]
}

function splitSingleListItemBlock(block: string, targetChunkLength: number): string[] {
  const normalized = block.replace(/\r\n/g, '\n')
  const lines = normalized.split('\n')
  const match = lines[0]?.match(/^(\s*(?:[-*+]|\d+\.)\s+)(.*)$/)
  if (!match) {
    return [block]
  }

  const [, marker, firstLine] = match
  const content = [firstLine, ...lines.slice(1).map((line) => line.trim())]
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()

  const chunks = splitTextIntoChunks(content, targetChunkLength)
  if (chunks.length <= 1) {
    return [block]
  }

  return chunks.map((chunk) => `${marker}${chunk}`)
}

function splitParagraphBlock(block: string, targetChunkLength: number): string[] {
  const normalized = block
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()

  const chunks = splitTextIntoChunks(normalized, targetChunkLength)
  return chunks.length > 1 ? chunks : [block]
}

function splitMultilineBlock(block: string): string[] {
  const lines = block
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean)

  if (lines.length < 2) {
    return [block]
  }

  const mid = Math.ceil(lines.length / 2)
  const left = lines.slice(0, mid).join('\n').trim()
  const right = lines.slice(mid).join('\n').trim()

  return left && right ? [left, right] : [block]
}

function splitTextIntoChunks(text: string, targetChunkLength: number): string[] {
  const sentences = splitTextIntoSentences(text)
  if (sentences.length <= 1) {
    return splitLongTextFallback(text, targetChunkLength)
  }

  const chunks: string[] = []
  let current = ''

  for (const sentence of sentences) {
    const candidate = current ? `${current} ${sentence}` : sentence
    if (candidate.length > targetChunkLength && current) {
      chunks.push(current)
      current = sentence
      continue
    }
    current = candidate
  }

  if (current) {
    chunks.push(current)
  }

  return chunks.length > 1 ? chunks : splitLongTextFallback(text, targetChunkLength)
}

function splitTextIntoSentences(text: string): string[] {
  const sentences: string[] = []
  let current = ''
  let inlineDollarCount = 0

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    current += char

    if (char === '$' && !isEscaped(text, index) && text[index - 1] !== '$' && text[index + 1] !== '$') {
      inlineDollarCount += 1
      continue
    }

    if (inlineDollarCount % 2 === 1) {
      continue
    }

    const isSentenceBoundary = /[。！？!?；;：:]/.test(char)
      || (/[，,]/.test(char) && current.length >= 120)

    if (!isSentenceBoundary) {
      continue
    }

    const trimmed = current.trim()
    if (trimmed) {
      sentences.push(trimmed)
    }
    current = ''
  }

  const tail = current.trim()
  if (tail) {
    sentences.push(tail)
  }

  return sentences
}

function splitLongTextFallback(text: string, targetChunkLength: number): string[] {
  const hardLimit = Math.max(targetChunkLength + 20, Math.round(targetChunkLength * 1.15))
  if (text.length <= hardLimit) {
    return [text]
  }

  const chunks: string[] = []
  let start = 0

  while (start < text.length) {
    let end = Math.min(start + targetChunkLength, text.length)

    if (end < text.length) {
      const windowSize = Math.max(targetChunkLength + 40, targetChunkLength)
      const slice = text.slice(start, Math.min(start + windowSize, text.length))
      const breakOffset = findPreferredBreakOffset(slice, Math.max(30, Math.floor(targetChunkLength * 0.45)))
      if (breakOffset > 0) {
        end = start + breakOffset
      }
    }

    chunks.push(text.slice(start, end).trim())
    start = end
  }

  return chunks.filter(Boolean)
}

function findPreferredBreakOffset(text: string, minOffset: number): number {
  for (let index = text.length - 1; index >= minOffset; index -= 1) {
    if (/[。！？!?；;：:，,\s]/.test(text[index])) {
      return index + 1
    }
  }

  return -1
}

function buildExportBody(title: string, body: string): string {
  return `
  <div class="export-header">
    <h1>${escapeHtml(title)} - BookLearning 讲解</h1>
    <p>导出时间：${new Date().toLocaleString('zh-CN')}</p>
  </div>
  ${body}
  `
}

function createMeasurementHost(sheet: ExportSheet): HTMLDivElement {
  const style = document.createElement('style')
  style.textContent = buildCaptureStyles()
  document.head.appendChild(style)

  const host = document.createElement('div')
  host.style.position = 'fixed'
  host.style.left = '-100000px'
  host.style.top = '0'
  host.style.pointerEvents = 'none'
  host.style.opacity = '0'
  host.dataset.exportHost = 'true'
  host.innerHTML = `<div class="booklearning-export-capture" style="--capture-sheet-width:${sheet.captureWidth}px; --capture-sheet-height:${sheet.captureHeight}px; --export-explanation-font-size:${sheet.layout.explanationFontSizePx}px;">${sheet.html}</div>`
  ;(host as HTMLDivElement & { __exportStyle?: HTMLStyleElement }).__exportStyle = style
  document.body.appendChild(host)
  return host
}

function destroyMeasurementHost(host: HTMLDivElement): void {
  host.remove()
  ;(host as HTMLDivElement & { __exportStyle?: HTMLStyleElement }).__exportStyle?.remove()
}

async function renderSheetToDataUrl(sheet: ExportSheet): Promise<string> {
  const host = createMeasurementHost(sheet)

  try {
    const captureNode = host.firstElementChild as HTMLElement | null
    if (!captureNode) {
      throw new Error('Failed to prepare PDF export sheet.')
    }

    await waitForCaptureReady(captureNode)

    return await toPng(captureNode, {
      cacheBust: true,
      pixelRatio: 1.6,
      backgroundColor: '#ffffff',
      canvasWidth: Math.round(sheet.captureWidth * 1.6),
      canvasHeight: Math.round(sheet.captureHeight * 1.6),
      width: sheet.captureWidth,
      height: sheet.captureHeight,
    })
  } finally {
    destroyMeasurementHost(host)
  }
}

async function renderSheetToBase64(sheet: ExportSheet): Promise<string> {
  const dataUrl = await renderSheetToDataUrl(sheet)
  return dataUrl.replace(/^data:image\/png;base64,/, '')
}

async function createPdfExportSession(pdfFileName: string): Promise<string> {
  const response = await fetch(`${API_BASE}/export/pdf/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      pdf_file_name: pdfFileName,
    }),
  })

  if (!response.ok) {
    throw new Error(await readErrorMessage(response))
  }

  const data = await response.json() as { session_id?: string }
  if (!data.session_id) {
    throw new Error('Failed to create export session.')
  }

  return data.session_id
}

async function uploadPdfSheetChunk(
  sessionId: string,
  chunkIndex: number,
  chunk: PendingSheetUpload[],
): Promise<number> {
  const response = await fetch(`${API_BASE}/export/pdf/session/${sessionId}/chunk`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chunk_index: chunkIndex,
      sheet_images_base64: chunk.map((item) => item.imageBase64),
      sheet_page_sizes: chunk.map((item) => item.pageSize),
    }),
  })

  if (!response.ok) {
    throw new Error(await readErrorMessage(response))
  }

  const data = await response.json() as { sheet_count?: number }
  return Number(data.sheet_count ?? 0)
}

async function readErrorMessage(response: Response): Promise<string> {
  const contentType = response.headers.get('Content-Type') || ''
  if (contentType.includes('application/json')) {
    const data = await response.json() as { detail?: string }
    return data.detail || `Request failed with status ${response.status}`
  }

  const text = await response.text()
  return text || `Request failed with status ${response.status}`
}

async function waitForCaptureReady(root: HTMLElement): Promise<void> {
  const images = Array.from(root.querySelectorAll('img'))
  await Promise.all(images.map(waitForImage))

  if ('fonts' in document) {
    try {
      await document.fonts.ready
    } catch {
      // Font readiness failures should not block export.
    }
  }

  await nextFrame()
  await nextFrame()
}

function waitForImage(image: HTMLImageElement): Promise<void> {
  if (image.complete) {
    return image.decode().catch(() => undefined)
  }

  return new Promise((resolve) => {
    const finish = () => {
      image.removeEventListener('load', finish)
      image.removeEventListener('error', finish)
      resolve()
    }

    image.addEventListener('load', finish, { once: true })
    image.addEventListener('error', finish, { once: true })
  })
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve())
  })
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

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function countUnescapedDoubleDollar(line: string): number {
  let count = 0

  for (let index = 0; index < line.length - 1; index += 1) {
    if (line[index] === '$' && line[index + 1] === '$' && !isEscaped(line, index)) {
      count += 1
      index += 1
    }
  }

  return count
}

function isEscaped(input: string, index: number): boolean {
  let backslashCount = 0

  for (let cursor = index - 1; cursor >= 0 && input[cursor] === '\\'; cursor -= 1) {
    backslashCount += 1
  }

  return backslashCount % 2 === 1
}
