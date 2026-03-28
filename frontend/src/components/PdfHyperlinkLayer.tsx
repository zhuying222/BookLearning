import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import type { HyperlinkRecord } from '../lib/api'
import { deleteHyperlink, updateHyperlinkPosition, updateHyperlinkText } from '../lib/api'

const DEFAULT_PDF_SCALE = 1.1

type Props = {
  locale: 'zh' | 'en'
  pdfHash: string
  pageNumber: number
  scale: number
  hyperlinks: HyperlinkRecord[]
  onHyperlinkUpsert: (item: HyperlinkRecord) => void
  onHyperlinkRemove: (hyperlinkId: string) => void
  onJumpToLinkedTarget: (pageNumber: number, targetType: 'followup' | 'note', targetId: string) => void
}

type ContextMenuState = {
  hyperlinkId: string
  x: number
  y: number
} | null

type DragState = {
  linkId: string
  offsetX: number
  offsetY: number
  startX: number
  startY: number
  moved: boolean
} | null

type DragPreview = {
  linkId: string
  positionX: number
  positionY: number
} | null

function clampLinkPosition(value: number): number {
  return Math.max(0.02, Math.min(0.94, value))
}

export default function PdfHyperlinkLayer({
  locale,
  pdfHash,
  pageNumber,
  scale,
  hyperlinks,
  onHyperlinkUpsert,
  onHyperlinkRemove,
  onJumpToLinkedTarget,
}: Props) {
  const isZh = locale === 'zh'
  const overlayRef = useRef<HTMLDivElement | null>(null)
  const timerRef = useRef<number | null>(null)
  const dragSuppressClickRef = useRef<string | null>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null)
  const [dragState, setDragState] = useState<DragState>(null)
  const [dragPreview, setDragPreview] = useState<DragPreview>(null)
  const [message, setMessage] = useState('')

  const markers = useMemo(
    () => hyperlinks.filter((item) => item.page_number === pageNumber),
    [hyperlinks, pageNumber],
  )
  const overlayStyle = useMemo(
    () => ({ '--pdf-link-scale': `${Math.max(0.4, (scale / DEFAULT_PDF_SCALE) * 0.56)}` } as CSSProperties),
    [scale],
  )

  const flashMessage = useCallback((text: string) => {
    setMessage(text)
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
    }
    timerRef.current = window.setTimeout(() => {
      setMessage('')
      timerRef.current = null
    }, 1800)
  }, [])

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (!contextMenu) return
    const closeMenu = () => setContextMenu(null)
    window.addEventListener('click', closeMenu)
    window.addEventListener('scroll', closeMenu, true)
    return () => {
      window.removeEventListener('click', closeMenu)
      window.removeEventListener('scroll', closeMenu, true)
    }
  }, [contextMenu])

  useEffect(() => {
    if (!dragState) return
    const handlePointerMove = (event: PointerEvent) => {
      if (!overlayRef.current) return
      const rect = overlayRef.current.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return

      const moved = Math.abs(event.clientX - dragState.startX) > 4 || Math.abs(event.clientY - dragState.startY) > 4
      if (moved && !dragState.moved) {
        setDragState((prev) => (prev ? { ...prev, moved: true } : prev))
      }

      const nextX = clampLinkPosition((event.clientX - rect.left - dragState.offsetX) / rect.width)
      const nextY = clampLinkPosition((event.clientY - rect.top - dragState.offsetY) / rect.height)
      setDragPreview({
        linkId: dragState.linkId,
        positionX: nextX,
        positionY: nextY,
      })
    }

    const handlePointerUp = () => {
      const activeDrag = dragState
      const preview = dragPreview
      setDragState(null)
      setDragPreview(null)
      if (!activeDrag || !activeDrag.moved || !preview || preview.linkId !== activeDrag.linkId) {
        return
      }
      dragSuppressClickRef.current = activeDrag.linkId
      window.setTimeout(() => {
        if (dragSuppressClickRef.current === activeDrag.linkId) {
          dragSuppressClickRef.current = null
        }
      }, 0)

      void updateHyperlinkPosition(pdfHash, activeDrag.linkId, {
        position_x: preview.positionX,
        position_y: preview.positionY,
      }).then((updated) => {
        onHyperlinkUpsert(updated)
      }).catch(() => {
        flashMessage(isZh ? '超链接位置保存失败' : 'Failed to save hyperlink position')
      })
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }
  }, [dragPreview, dragState, flashMessage, isZh, onHyperlinkUpsert, pdfHash])

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLButtonElement>, hyperlinkId: string) => {
    if (event.button !== 0) return
    const targetRect = event.currentTarget.getBoundingClientRect()
    setDragState({
      linkId: hyperlinkId,
      offsetX: event.clientX - targetRect.left,
      offsetY: event.clientY - targetRect.top,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    })
  }, [])

  const handleActivate = useCallback((hyperlink: HyperlinkRecord) => {
    if (dragSuppressClickRef.current === hyperlink.id) {
      dragSuppressClickRef.current = null
      return
    }
    onJumpToLinkedTarget(hyperlink.page_number, hyperlink.target_type, hyperlink.target_id)
  }, [onJumpToLinkedTarget])

  const handleRenameHyperlink = useCallback(async (hyperlinkId: string) => {
    const target = markers.find((item) => item.id === hyperlinkId)
    if (!target) return
    const nextText = window.prompt(
      isZh ? '修改超链接显示文本' : 'Edit hyperlink text',
      target.display_text,
    )
    if (nextText === null) {
      setContextMenu(null)
      return
    }
    if (!nextText.trim()) {
      flashMessage(isZh ? '显示文本不能为空' : 'Hyperlink text cannot be empty')
      return
    }
    try {
      const updated = await updateHyperlinkText(pdfHash, hyperlinkId, {
        display_text: nextText.trim(),
      })
      onHyperlinkUpsert(updated)
      setContextMenu(null)
      flashMessage(isZh ? '超链接文本已更新' : 'Hyperlink text updated')
    } catch {
      flashMessage(isZh ? '更新超链接文本失败' : 'Failed to update hyperlink text')
    }
  }, [flashMessage, isZh, markers, onHyperlinkUpsert, pdfHash])

  const handleDeleteHyperlink = useCallback(async (hyperlinkId: string) => {
    try {
      await deleteHyperlink(pdfHash, hyperlinkId)
      onHyperlinkRemove(hyperlinkId)
      setContextMenu(null)
      flashMessage(isZh ? '超链接已删除' : 'Hyperlink deleted')
    } catch {
      flashMessage(isZh ? '删除超链接失败' : 'Failed to delete hyperlink')
    }
  }, [flashMessage, isZh, onHyperlinkRemove, pdfHash])

  const menuStyle = contextMenu
    ? {
        left: Math.max(12, Math.min(contextMenu.x, window.innerWidth - 196)),
        top: Math.max(12, Math.min(contextMenu.y, window.innerHeight - 120)),
      }
    : undefined

  return (
    <div ref={overlayRef} className="pdf-link-overlay" style={overlayStyle}>
      {markers.map((hyperlink) => {
        const position = dragPreview?.linkId === hyperlink.id
          ? { x: dragPreview.positionX, y: dragPreview.positionY }
          : { x: hyperlink.position_x, y: hyperlink.position_y }
        return (
          <button
            key={hyperlink.id}
            type="button"
            className="page-link-marker"
            style={{
              left: `${position.x * 100}%`,
              top: `${position.y * 100}%`,
            }}
            onPointerDown={(event) => handlePointerDown(event, hyperlink.id)}
            onClick={() => handleActivate(hyperlink)}
            onContextMenu={(event) => {
              event.preventDefault()
              setContextMenu({
                hyperlinkId: hyperlink.id,
                x: event.clientX,
                y: event.clientY,
              })
            }}
          >
            <span className="page-link-marker__icon">#</span>
            <span className="page-link-marker__text">{hyperlink.display_text}</span>
          </button>
        )
      })}

      {message && <div className="pdf-link-toast">{message}</div>}

      {contextMenu && (
        <div className="follow-up-context-menu" style={menuStyle}>
          <button type="button" onClick={() => void handleRenameHyperlink(contextMenu.hyperlinkId)}>
            {isZh ? '修改显示文本' : 'Edit display text'}
          </button>
          <button type="button" className="follow-up-context-menu__danger" onClick={() => void handleDeleteHyperlink(contextMenu.hyperlinkId)}>
            {isZh ? '删除超链接' : 'Delete hyperlink'}
          </button>
        </div>
      )}
    </div>
  )
}
