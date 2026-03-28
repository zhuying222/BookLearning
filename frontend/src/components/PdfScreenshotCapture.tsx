import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  RefObject,
} from 'react'
import { createPortal } from 'react-dom'

import { writeImageBlobToClipboard } from '../lib/clipboard'

type Props = {
  locale: 'zh' | 'en'
  canvasRef: RefObject<HTMLCanvasElement | null>
  floatingRootElement?: HTMLElement | null
  disabled: boolean
  onCaptureSuccess?: () => void
}

type SelectionRect = {
  x: number
  y: number
  width: number
  height: number
}

const MIN_SELECTION_SIZE = 12
const TOAST_DURATION_MS = 2600

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function normalizeRect(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
): SelectionRect {
  const left = Math.min(startX, endX)
  const top = Math.min(startY, endY)

  return {
    x: left,
    y: top,
    width: Math.abs(endX - startX),
    height: Math.abs(endY - startY),
  }
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Failed to export screenshot image.'))
        return
      }
      resolve(blob)
    }, 'image/png')
  })
}

export default function PdfScreenshotCapture({
  locale,
  canvasRef,
  floatingRootElement,
  disabled,
  onCaptureSuccess,
}: Props) {
  const [isCapturing, setIsCapturing] = useState(false)
  const [selection, setSelection] = useState<SelectionRect | null>(null)
  const [toast, setToast] = useState('')

  const overlayRef = useRef<HTMLDivElement | null>(null)
  const dragStartRef = useRef<{ x: number; y: number } | null>(null)
  const toastTimerRef = useRef<number | null>(null)
  const screenshotSeqRef = useRef(0)

  const isZh = locale === 'zh'

  const flashToast = useCallback((message: string) => {
    setToast(message)
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current)
    }
    toastTimerRef.current = window.setTimeout(() => {
      setToast('')
      toastTimerRef.current = null
    }, TOAST_DURATION_MS)
  }, [])

  const cancelCapture = useCallback((showToast = false) => {
    dragStartRef.current = null
    setSelection(null)
    setIsCapturing(false)
    if (showToast) {
      flashToast(isZh ? '已取消本次截图。' : 'Capture cancelled.')
    }
  }, [flashToast, isZh])

  useEffect(() => () => {
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current)
    }
  }, [])

  useEffect(() => {
    if (!disabled) {
      return undefined
    }

    const frameId = window.requestAnimationFrame(() => {
      cancelCapture(false)
    })

    return () => window.cancelAnimationFrame(frameId)
  }, [cancelCapture, disabled])

  useEffect(() => {
    if (!isCapturing) {
      return undefined
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return
      }
      event.preventDefault()
      cancelCapture(true)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [cancelCapture, isCapturing])

  const getOverlayPoint = useCallback((clientX: number, clientY: number) => {
    const overlay = overlayRef.current
    if (!overlay) {
      return null
    }

    const rect = overlay.getBoundingClientRect()
    return {
      x: clamp(clientX - rect.left, 0, rect.width),
      y: clamp(clientY - rect.top, 0, rect.height),
      width: rect.width,
      height: rect.height,
    }
  }, [])

  const finishCapture = useCallback(async (rect: SelectionRect) => {
    const canvas = canvasRef.current
    const overlay = overlayRef.current

    if (!canvas || !overlay) {
      throw new Error(isZh ? '当前页还没有可截图的画面。' : 'Nothing is ready to capture yet.')
    }

    const overlayRect = overlay.getBoundingClientRect()
    if (overlayRect.width <= 0 || overlayRect.height <= 0) {
      throw new Error(isZh ? '截图区域无效。' : 'Invalid capture area.')
    }

    const scaleX = canvas.width / overlayRect.width
    const scaleY = canvas.height / overlayRect.height
    const sourceX = Math.max(0, Math.floor(rect.x * scaleX))
    const sourceY = Math.max(0, Math.floor(rect.y * scaleY))
    const sourceWidth = Math.max(1, Math.floor(rect.width * scaleX))
    const sourceHeight = Math.max(1, Math.floor(rect.height * scaleY))

    const targetCanvas = document.createElement('canvas')
    targetCanvas.width = sourceWidth
    targetCanvas.height = sourceHeight

    const context = targetCanvas.getContext('2d')
    if (!context) {
      throw new Error(isZh ? '无法创建截图画布。' : 'Failed to create capture canvas.')
    }

    context.drawImage(
      canvas,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      0,
      0,
      sourceWidth,
      sourceHeight,
    )

    const blob = await canvasToBlob(targetCanvas)
    await writeImageBlobToClipboard(blob)
    onCaptureSuccess?.()

    screenshotSeqRef.current += 1
    flashToast(
      isZh
        ? `截图${screenshotSeqRef.current} 已复制，可 Ctrl+V 粘贴到提示词/追问框。`
        : `Shot ${screenshotSeqRef.current} copied. Press Ctrl+V to attach it.`,
    )
  }, [canvasRef, flashToast, isZh, onCaptureSuccess])

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return
    }

    const point = getOverlayPoint(event.clientX, event.clientY)
    if (!point) {
      return
    }

    dragStartRef.current = { x: point.x, y: point.y }
    setSelection({ x: point.x, y: point.y, width: 0, height: 0 })
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
  }, [getOverlayPoint])

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const dragStart = dragStartRef.current
    if (!dragStart) {
      return
    }

    const point = getOverlayPoint(event.clientX, event.clientY)
    if (!point) {
      return
    }

    setSelection(normalizeRect(dragStart.x, dragStart.y, point.x, point.y))
  }, [getOverlayPoint])

  const handlePointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const dragStart = dragStartRef.current
    if (!dragStart) {
      return
    }

    dragStartRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }

    const point = getOverlayPoint(event.clientX, event.clientY)
    if (!point) {
      cancelCapture(false)
      return
    }

    const rect = normalizeRect(dragStart.x, dragStart.y, point.x, point.y)
    if (rect.width < MIN_SELECTION_SIZE || rect.height < MIN_SELECTION_SIZE) {
      setSelection(null)
      flashToast(isZh ? '截图区域过小，请重新框选。' : 'Selection is too small.')
      return
    }

    setSelection(rect)
    void finishCapture(rect)
      .catch((error) => {
        flashToast(error instanceof Error ? error.message : (isZh ? '截图失败。' : 'Capture failed.'))
      })
      .finally(() => {
        dragStartRef.current = null
        setSelection(null)
        setIsCapturing(false)
      })
  }, [cancelCapture, finishCapture, flashToast, getOverlayPoint, isZh])

  const handlePointerCancel = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    cancelCapture(false)
  }, [cancelCapture])

  const handleContextMenu = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    cancelCapture(true)
  }, [cancelCapture])

  const buttonNode = (
    <button
      type="button"
      className={`pdf-screenshot-fab${isCapturing ? ' pdf-screenshot-fab--active' : ''}`}
      onClick={() => {
        if (disabled) {
          return
        }
        setSelection(null)
        setIsCapturing(true)
      }}
      disabled={disabled}
      aria-label={isZh ? '开始截图' : 'Start screenshot'}
    >
      {isZh ? '截图' : 'Shot'}
    </button>
  )
  const floatingNode = (
    <>
      {buttonNode}
      {toast && <div className="pdf-screenshot-toast">{toast}</div>}
    </>
  )

  return (
    <>
      {floatingRootElement ? createPortal(floatingNode, floatingRootElement) : floatingNode}

      {isCapturing && (
        <div
          ref={overlayRef}
          className="pdf-screenshot-overlay"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          onContextMenu={handleContextMenu}
        >
          <div className="pdf-screenshot-overlay__hint">
            {isZh ? '拖拽框选，右键或 Esc 取消' : 'Drag to capture, right click or Esc to cancel'}
          </div>
          {selection && (
            <div
              className="pdf-screenshot-selection"
              style={{
                left: `${selection.x}px`,
                top: `${selection.y}px`,
                width: `${selection.width}px`,
                height: `${selection.height}px`,
              }}
            />
          )}
        </div>
      )}
    </>
  )
}
