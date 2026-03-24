import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  ChangeEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
} from 'react'

import type { LibraryDocument, LibraryFolder } from '../lib/api'

type Locale = 'zh' | 'en'

type Props = {
  locale: Locale
  folders: LibraryFolder[]
  documents: LibraryDocument[]
  currentFolderId: string | null
  currentDocumentId: string | null
  loading: boolean
  importing: boolean
  error: string
  actionMessage: string
  onNavigateFolder: (folderId: string | null) => void
  onCreateFolder: (parentFolderId: string | null) => Promise<void> | void
  onImport: (file: File, parentFolderId: string | null) => Promise<void>
  onOpen: (document: LibraryDocument) => void
  onRenameDocument: (document: LibraryDocument, nextName: string) => Promise<void>
  onRenameFolder: (folder: LibraryFolder, nextName: string) => Promise<void>
  onMoveDocument: (document: LibraryDocument, targetFolderId: string | null) => Promise<void>
  onMoveFolder: (folder: LibraryFolder, targetFolderId: string | null) => Promise<void>
  onDelete: (document: LibraryDocument, removeCache: boolean) => Promise<void>
  onDeleteFolder: (folder: LibraryFolder) => Promise<void>
}

type ContextMenuState =
  | { x: number; y: number; type: 'document'; document: LibraryDocument }
  | { x: number; y: number; type: 'folder'; folder: LibraryFolder }

type EditingState =
  | { type: 'document'; id: string; value: string }
  | { type: 'folder'; id: string; value: string }

type DraggingState =
  | { type: 'document'; document: LibraryDocument }
  | { type: 'folder'; folder: LibraryFolder }

export default function Bookshelf({
  locale,
  folders,
  documents,
  currentFolderId,
  currentDocumentId,
  loading,
  importing,
  error,
  actionMessage,
  onNavigateFolder,
  onCreateFolder,
  onImport,
  onOpen,
  onRenameDocument,
  onRenameFolder,
  onMoveDocument,
  onMoveFolder,
  onDelete,
  onDeleteFolder,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [editing, setEditing] = useState<EditingState | null>(null)
  const [dragging, setDragging] = useState<DraggingState | null>(null)
  const isZh = locale === 'zh'

  const foldersById = useMemo(
    () => new Map(folders.map((folder) => [folder.id, folder])),
    [folders],
  )
  const currentFolder = currentFolderId ? foldersById.get(currentFolderId) ?? null : null
  const currentFolderParentId = currentFolder?.parent_id ?? null
  const visibleFolders = useMemo(
    () => folders
      .filter((folder) => folder.parent_id === currentFolderId)
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN')),
    [currentFolderId, folders],
  )
  const visibleDocuments = useMemo(
    () => documents
      .filter((document) => document.parent_folder_id === currentFolderId)
      .sort((a, b) => a.title.localeCompare(b.title, 'zh-Hans-CN')),
    [currentFolderId, documents],
  )
  const breadcrumbs = useMemo(() => {
    const items: LibraryFolder[] = []
    let cursor = currentFolder
    while (cursor) {
      items.unshift(cursor)
      cursor = cursor.parent_id ? foldersById.get(cursor.parent_id) ?? null : null
    }
    return items
  }, [currentFolder, foldersById])
  const canCreateFolder = (currentFolder?.depth ?? 0) < 5

  const getDocumentSubtitle = (document: LibraryDocument) => {
    const normalizedTitle = document.title.trim().toLowerCase()
    const normalizedFileStem = document.original_file_name.replace(/\.pdf$/i, '').trim().toLowerCase()
    if (normalizedTitle && normalizedTitle !== normalizedFileStem) {
      return document.original_file_name
    }

    const parts: string[] = []
    if (document.page_count && document.page_count > 0) {
      parts.push(isZh ? `${document.page_count} 页` : `${document.page_count} pages`)
    }
    if (document.cached_pages > 0) {
      parts.push(isZh ? `已缓存 ${document.cached_pages} 页` : `${document.cached_pages} cached`)
    }
    return parts.join(' · ')
  }

  useEffect(() => {
    if (!contextMenu) return
    const closeMenuFromPointer = (event: PointerEvent) => {
      if (event.button === 2) return
      setContextMenu(null)
    }
    const closeMenuOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setContextMenu(null)
      }
    }
    const closeMenu = () => setContextMenu(null)
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
      await onImport(file, currentFolderId)
    } finally {
      event.target.value = ''
    }
  }

  const commitRename = async () => {
    if (!editing) return
    const nextValue = editing.value.trim()
    if (!nextValue) {
      setEditing(null)
      return
    }

    if (editing.type === 'document') {
      const target = documents.find((item) => item.id === editing.id)
      if (target) {
        await onRenameDocument(target, nextValue)
      }
    } else {
      const target = folders.find((item) => item.id === editing.id)
      if (target) {
        await onRenameFolder(target, nextValue)
      }
    }

    setEditing(null)
  }

  const handleRenameKeyDown = async (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      await commitRename()
    } else if (event.key === 'Escape') {
      setEditing(null)
    }
  }

  const openContextMenu = (event: ReactMouseEvent, nextMenu: ContextMenuState) => {
    event.preventDefault()
    event.stopPropagation()
    const menuWidth = 248
    const menuHeight = nextMenu.type === 'folder' ? 132 : 164
    const safeX = Math.min(event.clientX, window.innerWidth - menuWidth - 12)
    const safeY = Math.min(event.clientY, window.innerHeight - menuHeight - 12)
    setContextMenu({
      ...nextMenu,
      x: Math.max(12, safeX),
      y: Math.max(12, safeY),
    })
  }

  const handleDropToFolder = async (folder: LibraryFolder) => {
    if (!dragging) return
    if (dragging.type === 'document') {
      await onMoveDocument(dragging.document, folder.id)
    } else {
      await onMoveFolder(dragging.folder, folder.id)
    }
    setDragging(null)
  }

  const handleDropToCurrentArea = async () => {
    if (!dragging) return
    if (dragging.type === 'document') {
      await onMoveDocument(dragging.document, currentFolderId)
    } else if (dragging.folder.id !== currentFolderId) {
      await onMoveFolder(dragging.folder, currentFolderId)
    }
    setDragging(null)
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
            <span className="bookshelf-strip-count">
              {isZh ? `${documents.length} 本 PDF / ${folders.length} 个文件夹` : `${documents.length} PDFs / ${folders.length} folders`}
            </span>
          </div>
          <span className="bookshelf-strip-hint">
            {isZh ? '点击进入，右键操作，拖动书本或文件夹放入目标文件夹。' : 'Click to open, right click for actions, drag books or folders into folders.'}
          </span>
        </div>
      </section>

      {actionMessage && <div className="bookshelf-banner bookshelf-banner--success">{actionMessage}</div>}
      {error && <div className="bookshelf-banner bookshelf-banner--error">{error}</div>}

      <section className="bookshelf-toolbar">
        <div className="bookshelf-breadcrumbs">
          <button type="button" className="bookshelf-crumb" onClick={() => onNavigateFolder(null)}>
            {isZh ? '全部书本' : 'All books'}
          </button>
          {breadcrumbs.map((folder) => (
            <button
              type="button"
              key={folder.id}
              className="bookshelf-crumb"
              onClick={() => onNavigateFolder(folder.id)}
            >
              {folder.name}
            </button>
          ))}
        </div>
        <div className="bookshelf-toolbar-meta">
          <strong>{currentFolder?.name ?? (isZh ? '根目录' : 'Root')}</strong>
          <span>
            {isZh ? `${visibleFolders.length} 个文件夹，${visibleDocuments.length} 本书` : `${visibleFolders.length} folders, ${visibleDocuments.length} books`}
          </span>
        </div>
      </section>

      <section
        className="bookshelf-grid"
        onDragOver={(event) => event.preventDefault()}
        onDrop={async (event) => {
          event.preventDefault()
          await handleDropToCurrentArea()
        }}
      >
        {loading ? (
          <div className="bookshelf-empty">
            <div className="spinner" />
            <p>{isZh ? '正在整理你的书架...' : 'Loading your shelf...'}</p>
          </div>
        ) : visibleFolders.length === 0 && visibleDocuments.length === 0 ? (
          <div className="bookshelf-empty">
            <div className="bookshelf-empty-icon" />
            <h2>{isZh ? '这里还是空的' : 'Nothing here yet'}</h2>
            <p>{isZh ? '点下面按钮导入 PDF 或新建文件夹。' : 'Import a PDF or create a folder with the buttons below.'}</p>
          </div>
        ) : (
          <>
            {visibleFolders.map((folder, index) => (
              <div
                key={folder.id}
                className="shelf-item shelf-item--folder"
                draggable
                onDragStart={() => setDragging({ type: 'folder', folder })}
                onDragEnd={() => setDragging(null)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={async (event) => {
                  event.preventDefault()
                  await handleDropToFolder(folder)
                }}
                onContextMenu={(event) => openContextMenu(event, { x: 0, y: 0, type: 'folder', folder })}
              >
                <div
                  className="shelf-item-surface"
                  role="button"
                  tabIndex={0}
                  onClick={() => onNavigateFolder(folder.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      onNavigateFolder(folder.id)
                    }
                  }}
                >
                  <div className={`shelf-folder shelf-folder--tone-${index % 4}`} aria-hidden="true">
                    <span className="shelf-folder-tab" />
                  </div>
                  <div className="shelf-item-text">
                    {editing?.type === 'folder' && editing.id === folder.id ? (
                      <input
                        className="library-rename-input"
                        value={editing.value}
                        autoFocus
                        onChange={(event) => setEditing((prev) => prev ? { ...prev, value: event.target.value } : prev)}
                        onBlur={() => { void commitRename() }}
                        onKeyDown={(event) => { void handleRenameKeyDown(event) }}
                      />
                    ) : (
                      <button
                        type="button"
                        className="library-title-button"
                        onClick={(event) => {
                          event.stopPropagation()
                          setEditing({ type: 'folder', id: folder.id, value: folder.name })
                        }}
                      >
                        {folder.name}
                      </button>
                    )}
                    <span className="shelf-item-subtitle">
                      {isZh ? `${folder.child_folder_count} 个子文件夹 · ${folder.total_document_count} 本书` : `${folder.child_folder_count} subfolders · ${folder.total_document_count} books`}
                    </span>
                  </div>
                </div>
              </div>
            ))}

            {visibleDocuments.map((document) => (
              <div
                key={document.id}
                className={`shelf-item${document.id === currentDocumentId ? ' shelf-item--active' : ''}`}
                draggable
                onDragStart={() => setDragging({ type: 'document', document })}
                onDragEnd={() => setDragging(null)}
                onContextMenu={(event) => openContextMenu(event, { x: 0, y: 0, type: 'document', document })}
              >
                <div
                  className="shelf-item-surface"
                  role="button"
                  tabIndex={0}
                  onClick={() => onOpen(document)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      onOpen(document)
                    }
                  }}
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
                    {editing?.type === 'document' && editing.id === document.id ? (
                      <input
                        className="library-rename-input"
                        value={editing.value}
                        autoFocus
                        onChange={(event) => setEditing((prev) => prev ? { ...prev, value: event.target.value } : prev)}
                        onBlur={() => { void commitRename() }}
                        onKeyDown={(event) => { void handleRenameKeyDown(event) }}
                      />
                    ) : (
                      <button
                        type="button"
                        className="library-title-button"
                        onClick={(event) => {
                          event.stopPropagation()
                          setEditing({ type: 'document', id: document.id, value: document.title })
                        }}
                      >
                        {document.title}
                      </button>
                    )}
                    <span className="shelf-item-subtitle">{getDocumentSubtitle(document)}</span>
                  </div>
                </div>
              </div>
            ))}
          </>
        )}
      </section>

      <div className="shelf-fab-dock">
        <button
          type="button"
          className="shelf-fab shelf-fab--secondary"
          onClick={() => void onCreateFolder(currentFolderId)}
          disabled={!canCreateFolder}
          title={isZh ? '新建文件夹' : 'New folder'}
        >
          {isZh ? '新建文件夹' : 'New folder'}
        </button>
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
      </div>

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
          {contextMenu.type === 'document' ? (
            <>
              <button
                type="button"
                onClick={() => {
                  setEditing({ type: 'document', id: contextMenu.document.id, value: contextMenu.document.title })
                  setContextMenu(null)
                }}
              >
                {isZh ? '重命名' : 'Rename'}
              </button>
              {currentFolderId && (
                <button
                  type="button"
                  onClick={() => {
                    void onMoveDocument(contextMenu.document, currentFolderParentId)
                    setContextMenu(null)
                  }}
                >
                  {isZh ? '移出当前文件夹' : 'Move out of current folder'}
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  void onDelete(contextMenu.document, false)
                  setContextMenu(null)
                }}
              >
                {isZh ? '仅移出书架' : 'Remove from shelf only'}
              </button>
              <button
                type="button"
                onClick={() => {
                  void onDelete(contextMenu.document, true)
                  setContextMenu(null)
                }}
              >
                {isZh ? '删除书籍并清除缓存' : 'Delete book and cache'}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => {
                  setEditing({ type: 'folder', id: contextMenu.folder.id, value: contextMenu.folder.name })
                  setContextMenu(null)
                }}
              >
                {isZh ? '重命名' : 'Rename'}
              </button>
              {currentFolderId && (
                <button
                  type="button"
                  onClick={() => {
                    void onMoveFolder(contextMenu.folder, currentFolderParentId)
                    setContextMenu(null)
                  }}
                >
                  {isZh ? '移出当前文件夹' : 'Move out of current folder'}
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  void onDeleteFolder(contextMenu.folder)
                  setContextMenu(null)
                }}
              >
                {isZh ? '删除文件夹' : 'Delete folder'}
              </button>
            </>
          )}
        </div>
      )}
    </main>
  )
}
