import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, CSSProperties, MouseEvent as ReactMouseEvent } from 'react'

import type { LibraryDocument } from '../lib/api'

type Locale = 'zh' | 'en'

type Props = {
  locale: Locale
  documents: LibraryDocument[]
  currentDocumentId: string | null
  loading: boolean
  importing: boolean
  error: string
  actionMessage: string
  onImport: (file: File) => Promise<void>
  onOpen: (document: LibraryDocument) => void
  onDelete: (document: LibraryDocument, removeCache: boolean) => Promise<void>
}

type ContextMenuState = {
  x: number
  y: number
  document: LibraryDocument
}

export default function Bookshelf({
  locale,
  documents,
  currentDocumentId,
  loading,
  importing,
  error,
  actionMessage,
  onImport,
  onOpen,
  onDelete,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const isZh = locale === 'zh'

  useEffect(() => {
    if (!contextMenu) return

    const closeMenuFromPointer = (event: PointerEvent) => {
      if (event?.button === 2) return
      setContextMenu(null)
    }
    const closeMenu = () => setContextMenu(null)
    const closeMenuOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setContextMenu(null)
      }
    }
    window.addEventListener('pointerdown', closeMenuFromPointer)
    window.addEventListener('keydown', closeMenuOnEscape)
    window.addEventListener('resize', closeMenu)
    window.addEventListener('scroll', closeMenu, true)
    return () => {
      window.removeEventListener('pointerdown', closeMenuFromPointer)
      window.removeEventListener('keydown', closeMenuOnEscape)
      window.removeEventListener('resize', closeMenu)
      window.removeEventListener('scroll', closeMenu, true)
    }
  }, [contextMenu])

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const [file] = Array.from(event.target.files ?? [])
    if (!file) return
    try {
      await onImport(file)
    } finally {
      event.target.value = ''
    }
  }

  return (
    <main className="bookshelf-page">
      <section className="bookshelf-hero">
        <div className="bookshelf-brand-block">
          <div className="bookshelf-brand-mark" aria-hidden="true">
            <span className="bookshelf-brand-mark__page" />
            <span className="bookshelf-brand-mark__spine" />
          </div>
          <div className="bookshelf-brand-copy">
            <span className="bookshelf-brand-kicker">{isZh ? 'BookLearning 书架' : 'BookLearning Shelf'}</span>
            <h1>{isZh ? '挑一本，继续学。' : 'Pick one and continue.'}</h1>
            <p>
              {isZh
                ? '每次翻开一页，都比昨天更接近你想成为的自己。'
                : 'Each page you open brings you closer to who you want to become.'}
            </p>
          </div>
        </div>
        <div className="bookshelf-strip-main">
          <div className="bookshelf-strip-row">
            <strong>{isZh ? '本地书架' : 'Library'}</strong>
            <span className="bookshelf-strip-count">{isZh ? `${documents.length} 本 PDF` : `${documents.length} PDFs`}</span>
          </div>
          <span className="bookshelf-strip-hint">
            {isZh ? '点击进入，右键删除' : 'Click to open, right click to delete'}
          </span>
        </div>
      </section>

      {actionMessage && <div className="bookshelf-banner bookshelf-banner--success">{actionMessage}</div>}
      {error && <div className="bookshelf-banner bookshelf-banner--error">{error}</div>}

      <section className="bookshelf-grid">
        {loading ? (
          <div className="bookshelf-empty">
            <div className="spinner" />
            <p>{isZh ? '正在整理你的书架...' : 'Loading your shelf...'}</p>
          </div>
        ) : documents.length === 0 ? (
          <div className="bookshelf-empty">
            <div className="bookshelf-empty-icon" />
            <h2>{isZh ? '书架还是空的' : 'Shelf is empty'}</h2>
            <p>{isZh ? '点下面的加号导入 PDF。' : 'Use the plus button below to import a PDF.'}</p>
          </div>
        ) : (
          documents.map((document, index) => (
            <button
              type="button"
              key={document.id}
              className={`shelf-item${document.id === currentDocumentId ? ' shelf-item--active' : ''}`}
              style={{ ['--shelf-accent' as string]: `${(index * 41) % 360}deg` } as CSSProperties}
              onClick={() => onOpen(document)}
              onContextMenu={(event: ReactMouseEvent) => {
                event.preventDefault()
                event.stopPropagation()
                const menuWidth = 240
                const menuHeight = 104
                const safeX = Math.min(event.clientX, window.innerWidth - menuWidth - 12)
                const safeY = Math.min(event.clientY, window.innerHeight - menuHeight - 12)
                setContextMenu({
                  x: Math.max(12, safeX),
                  y: Math.max(12, safeY),
                  document,
                })
              }}
              title={document.original_file_name}
            >
              <div className="shelf-book">
                <div className="shelf-book-cover shelf-book-cover--back" />
                <div className="shelf-book-pages" />
                <div className="shelf-book-cover shelf-book-cover--front">
                  <span className="shelf-item-menu-hint">{isZh ? '右键' : 'Menu'}</span>
                  {document.cached_pages > 0 && (
                    <span className="shelf-book-badge">
                      {isZh ? `${document.cached_pages} 页` : `${document.cached_pages}`}
                    </span>
                  )}
                </div>
              </div>
              <div className="shelf-item-text">
                <span className="shelf-item-title">{document.title}</span>
                <span className="shelf-item-subtitle">{document.original_file_name}</span>
              </div>
            </button>
          ))
        )}
      </section>

      <button
        type="button"
        className="shelf-fab"
        onClick={() => fileInputRef.current?.click()}
        disabled={importing}
        aria-label={isZh ? '导入 PDF' : 'Import PDF'}
        title={isZh ? '导入 PDF' : 'Import PDF'}
      >
        {importing ? (isZh ? '导入中...' : 'Importing...') : (isZh ? '导入 PDF' : 'Import PDF')}
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf,.pdf"
        hidden
        onChange={handleFileChange}
      />

      {contextMenu && (
        <div
          className="book-context-menu"
          style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => {
              void onDelete(contextMenu.document, true)
              setContextMenu(null)
            }}
          >
            {isZh ? '删除书籍并清除缓存' : 'Delete book and cache'}
          </button>
          <button
            type="button"
            onClick={() => {
              void onDelete(contextMenu.document, false)
              setContextMenu(null)
            }}
          >
            {isZh ? '仅移出书架' : 'Remove from shelf only'}
          </button>
        </div>
      )}
    </main>
  )
}
