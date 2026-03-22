import {
  GlobalWorkerOptions,
  getDocument,
  type PDFDocumentProxy,
  type PDFPageProxy,
} from 'pdfjs-dist'
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

GlobalWorkerOptions.workerSrc = workerSrc

export type RenderedPageImage = {
  pageNumber: number
  dataUrl: string
  width: number
  height: number
}

export async function loadPdfDocument(
  data: Uint8Array,
): Promise<PDFDocumentProxy> {
  const loadingTask = getDocument({ data })
  return loadingTask.promise
}

export async function renderPdfPageToCanvas(
  page: PDFPageProxy,
  canvas: HTMLCanvasElement,
  scale: number,
): Promise<{ width: number; height: number }> {
  const viewport = page.getViewport({ scale })
  const ratio = window.devicePixelRatio || 1
  const context = canvas.getContext('2d')

  if (!context) {
    throw new Error('Canvas 2D context is unavailable.')
  }

  canvas.width = Math.floor(viewport.width * ratio)
  canvas.height = Math.floor(viewport.height * ratio)
  canvas.style.width = `${viewport.width}px`
  canvas.style.height = `${viewport.height}px`

  const renderContext = {
    canvasContext: context,
    viewport,
    transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
  } as Parameters<PDFPageProxy['render']>[0]

  await page.render(renderContext).promise

  return {
    width: viewport.width,
    height: viewport.height,
  }
}

export async function renderPdfPageToDataUrl(
  pdfDocument: PDFDocumentProxy,
  pageNumber: number,
  scale: number,
): Promise<RenderedPageImage> {
  const page = await pdfDocument.getPage(pageNumber)
  const canvas = document.createElement('canvas')
  const dimensions = await renderPdfPageToCanvas(page, canvas, scale)

  return {
    pageNumber,
    dataUrl: canvas.toDataURL('image/png'),
    width: Math.round(dimensions.width),
    height: Math.round(dimensions.height),
  }
}
