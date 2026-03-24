import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, WheelEvent } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'

import './App.css'
import AiConfigPanel from './components/AiConfigPanel'
import Bookshelf from './components/Bookshelf'
import ExplanationPanel from './components/ExplanationPanel'
import ParseControls from './components/ParseControls'
import PromptEditor from './components/PromptEditor'
import type { FollowUpRecord, LibraryDocument, LibraryFolder, TaskStatus } from './lib/api'
import {
  createFolder,
  deleteFolder,
  deleteDocument,
  downloadDocumentPdf,
  followUpPage,
  getTaskStatus,
  importDocument,
  listLibrary,
  loadAllCachedExplanations,
  loadSavedFollowUps,
  moveDocument,
  moveFolder,
  parseRange,
  parseSinglePage,
  renameDocument,
  renameFolder,
  updateDocumentProgress,
} from './lib/api'
import { exportAsHtml, exportAsJson, exportAsPdf } from './lib/export'
import type { PdfExportProgress } from './lib/export'
import { clamp, formatPageSelection, parsePageSelection } from './lib/pageSelection'
import {
  loadPdfDocument,
  renderPdfPageToCanvas,
  renderPdfPageToDataUrl,
} from './lib/pdf'

const MIN_SCALE = 0.4
const MAX_SCALE = 4
const DEFAULT_SCALE = 1.1
const DEFAULT_EXPORT_SCALE = 1.75
const MIN_VIEWER_RATIO = 12
const MAX_VIEWER_RATIO = 88
const MIN_RIGHT_TOP_RATIO = 18
const MAX_RIGHT_TOP_RATIO = 92

type Locale = 'zh' | 'en'
type ViewMode = 'library' | 'reader'
type OverwriteDialogState = { page: number } | null

type StatusState =
  | { key: 'idle' }
  | { key: 'loadingPdf'; fileName: string }
  | { key: 'renderingPage'; page: number; pageCount: number; zoom: number }
  | { key: 'loadedPage'; fileName: string; page: number; pageCount: number }
  | { key: 'renderFailed' }
  | { key: 'parsing'; page: number }
  | { key: 'parsed'; page: number }
  | { key: 'parseFailed'; error: string }

function getStatusText(locale: Locale, status: StatusState): string {
  switch (status.key) {
    case 'idle':
      return locale === 'zh' ? '从书架中选择一本 PDF 后即可开始阅读。' : 'Select a PDF from your shelf to start reading.'
    case 'loadingPdf':
      return locale === 'zh' ? `正在加载 ${status.fileName}...` : `Loading ${status.fileName}...`
    case 'renderingPage':
      return locale === 'zh'
        ? `正在渲染第 ${status.page} / ${status.pageCount} 页，缩放 ${status.zoom}%。`
        : `Rendering page ${status.page} / ${status.pageCount} at ${status.zoom}%.`
    case 'loadedPage':
      return locale === 'zh'
        ? `已载入 ${status.fileName}，当前第 ${status.page} / ${status.pageCount} 页。`
        : `Loaded ${status.fileName}, page ${status.page} / ${status.pageCount}.`
    case 'renderFailed':
      return locale === 'zh' ? '当前页渲染失败。' : 'Current page render failed.'
    case 'parsing':
      return locale === 'zh' ? `正在解析第 ${status.page} 页...` : `Parsing page ${status.page}...`
    case 'parsed':
      return locale === 'zh' ? `第 ${status.page} 页解析完成。` : `Page ${status.page} parsed.`
    case 'parseFailed':
      return locale === 'zh' ? `解析失败：${status.error}` : `Parse failed: ${status.error}`
  }
}

function App() {
  const [locale, setLocale] = useState<Locale>('zh')
  const [viewMode, setViewMode] = useState<ViewMode>('library')
  const [libraryFolders, setLibraryFolders] = useState<LibraryFolder[]>([])
  const [libraryDocuments, setLibraryDocuments] = useState<LibraryDocument[]>([])
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null)
  const [isLibraryLoading, setIsLibraryLoading] = useState(true)
  const [isImportingDocument, setIsImportingDocument] = useState(false)
  const [libraryError, setLibraryError] = useState('')
  const [libraryActionMessage, setLibraryActionMessage] = useState('')
  const [currentDocumentMeta, setCurrentDocumentMeta] = useState<LibraryDocument | null>(null)
  const [pdfDocument, setPdfDocument] = useState<PDFDocumentProxy | null>(null)
  const [pdfFileName, setPdfFileName] = useState('No file loaded')
  const [pdfHash, setPdfHash] = useState('')
  const [pageCount, setPageCount] = useState(0)
  const [currentPage, setCurrentPage] = useState(1)
  const [jumpInput, setJumpInput] = useState('1')
  const [scale, setScale] = useState(DEFAULT_SCALE)
  const [viewerRatio, setViewerRatio] = useState(55)
  const [isResizing, setIsResizing] = useState(false)
  const [rightTopRatio, setRightTopRatio] = useState(66.67)
  const [isRightPanelResizing, setIsRightPanelResizing] = useState(false)
  const [status, setStatus] = useState<StatusState>({ key: 'idle' })
  const [loadError, setLoadError] = useState('')
  const [renderError, setRenderError] = useState('')
  const [isLoadingPdf, setIsLoadingPdf] = useState(false)

  // AI & Parse state
  const [showAiConfig, setShowAiConfig] = useState(false)
  const [showPromptEditor, setShowPromptEditor] = useState(false)
  const [explanations, setExplanations] = useState<Record<number, string>>({})
  const [parsingPages, setParsingPages] = useState<number[]>([])
  const [parseError, setParseError] = useState('')
  const [activeTask, setActiveTask] = useState<TaskStatus | null>(null)
  const [batchRangeInput, setBatchRangeInput] = useState('')
  const [batchPreparationStatus, setBatchPreparationStatus] = useState('')
  const [pagePrompts, setPagePrompts] = useState<Record<number, string>>({})
  const [followUps, setFollowUps] = useState<Record<number, FollowUpRecord[]>>({})
  const [followUpDrafts, setFollowUpDrafts] = useState<Record<number, string>>({})
  const [followUpModePage, setFollowUpModePage] = useState<number | null>(null)
  const [skipOverwritePrompt, setSkipOverwritePrompt] = useState(false)
  const [overwriteDialog, setOverwriteDialog] = useState<OverwriteDialogState>(null)
  const [skipOverwritePromptChecked, setSkipOverwritePromptChecked] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState('')
  const [exportAllPages, setExportAllPages] = useState(false)

  const activeDocumentRef = useRef<PDFDocumentProxy | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const viewerRef = useRef<HTMLDivElement | null>(null)
  const splitLayoutRef = useRef<HTMLDivElement | null>(null)
  const rightPanelRef = useRef<HTMLElement | null>(null)
  const taskPollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const documentLoadSeqRef = useRef(0)

  const isZh = locale === 'zh'
  const statusText = useMemo(() => getStatusText(locale, status), [locale, status])
  const displayFileName = currentDocumentMeta?.original_file_name ?? (isZh ? '未选择文档' : 'No document selected')
  const folderParentMap = useMemo(
    () => new Map(libraryFolders.map((folder) => [folder.id, folder.parent_id])),
    [libraryFolders],
  )
  const selectedBatchPages = useMemo(
    () => parsePageSelection(batchRangeInput, pageCount),
    [batchRangeInput, pageCount],
  )
  const isCurrentPageInBatch = selectedBatchPages.includes(currentPage)
  const currentPagePrompt = pagePrompts[currentPage] ?? ''
  const currentPageFollowUps = followUps[currentPage] ?? []
  const currentFollowUpDraft = followUpDrafts[currentPage] ?? ''
  const isCurrentPageFollowUpMode = followUpModePage === currentPage
  const currentPageExplanation = explanations[currentPage]?.trim() ?? ''
  const configuredPromptCount = useMemo(
    () => Object.values(pagePrompts).filter((value) => value.trim()).length,
    [pagePrompts],
  )
  const isCurrentPageParsing = parsingPages.includes(currentPage)

  const syncDocumentIntoShelf = useCallback((document: LibraryDocument) => {
    setCurrentDocumentMeta(document)
    setLibraryDocuments((prev) => {
      const withoutTarget = prev.filter((item) => item.id !== document.id)
      return [document, ...withoutTarget]
    })
  }, [])

  const applyFollowUpsToPage = useCallback((pageNumber: number, items: FollowUpRecord[]) => {
    setFollowUps((prev) => {
      if (items.length === 0) {
        if (!(pageNumber in prev)) {
          return prev
        }
        const next = { ...prev }
        delete next[pageNumber]
        return next
      }

      return {
        ...prev,
        [pageNumber]: items,
      }
    })
  }, [])

  const resetReaderState = useCallback(() => {
    if (activeDocumentRef.current) {
      void activeDocumentRef.current.destroy()
      activeDocumentRef.current = null
    }
    setCurrentDocumentMeta(null)
    setPdfDocument(null)
    setPdfHash('')
    setPdfFileName('No file loaded')
    setPageCount(0)
    setCurrentPage(1)
    setJumpInput('1')
    setExplanations({})
    setParsingPages([])
    setPagePrompts({})
    setFollowUps({})
    setFollowUpDrafts({})
    setFollowUpModePage(null)
    setOverwriteDialog(null)
    setSkipOverwritePromptChecked(false)
    setActiveTask(null)
    setStatus({ key: 'idle' })
  }, [])

  const refreshLibraryDocuments = useCallback(async (silent = false) => {
    if (!silent) {
      setIsLibraryLoading(true)
    }
    setLibraryError('')
    try {
      const snapshot = await listLibrary()
      setLibraryFolders(snapshot.folders)
      setLibraryDocuments(snapshot.documents)
      setCurrentFolderId((prev) => (prev && snapshot.folders.some((folder) => folder.id === prev) ? prev : null))
      setCurrentDocumentMeta((prev) => {
        if (!prev) return prev
        return snapshot.documents.find((document) => document.id === prev.id) ?? null
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load library.'
      setLibraryError(message)
    } finally {
      if (!silent) {
        setIsLibraryLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    document.title = isZh ? 'BookLearning 阅读器' : 'BookLearning Reader'
  }, [isZh])

  useEffect(() => {
    void refreshLibraryDocuments()
  }, [refreshLibraryDocuments])

  useEffect(() => {
    return () => {
      documentLoadSeqRef.current += 1
      if (activeDocumentRef.current) {
        void activeDocumentRef.current.destroy()
      }
    }
  }, [])

  useEffect(() => {
    setJumpInput(String(currentPage))
  }, [currentPage])

  useEffect(() => {
    setOverwriteDialog(null)
    setSkipOverwritePromptChecked(false)
  }, [currentPage])

  useEffect(() => {
    if (viewMode !== 'reader' || !currentDocumentMeta || pageCount === 0) return
    const timeout = window.setTimeout(() => {
      void updateDocumentProgress(currentDocumentMeta.id, currentPage)
        .then((updated) => {
          syncDocumentIntoShelf(updated)
        })
        .catch(() => { /* ignore progress sync errors */ })
    }, 800)
    return () => window.clearTimeout(timeout)
  }, [currentDocumentMeta, currentPage, pageCount, syncDocumentIntoShelf, viewMode])

  // Resize splitter
  useEffect(() => {
    if (!isResizing) return
    const handlePointerMove = (event: PointerEvent) => {
      if (!splitLayoutRef.current) return
      const rect = splitLayoutRef.current.getBoundingClientRect()
      const nextRatio = ((event.clientX - rect.left) / rect.width) * 100
      setViewerRatio(clamp(nextRatio, MIN_VIEWER_RATIO, MAX_VIEWER_RATIO))
    }
    const stopResizing = () => setIsResizing(false)
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', stopResizing)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', stopResizing)
    }
  }, [isResizing])

  useEffect(() => {
    if (!isRightPanelResizing) return
    const handlePointerMove = (event: PointerEvent) => {
      if (!rightPanelRef.current) return
      const rect = rightPanelRef.current.getBoundingClientRect()
      const nextRatio = ((event.clientY - rect.top) / rect.height) * 100
      setRightTopRatio(clamp(nextRatio, MIN_RIGHT_TOP_RATIO, MAX_RIGHT_TOP_RATIO))
    }
    const stopResizing = () => setIsRightPanelResizing(false)
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', stopResizing)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', stopResizing)
    }
  }, [isRightPanelResizing])

  // Render current page
  useEffect(() => {
    if (viewMode !== 'reader' || !pdfDocument || !canvasRef.current || pageCount === 0) return
    let cancelled = false
    const renderCurrentPage = async () => {
      setRenderError('')
      setStatus({ key: 'renderingPage', page: currentPage, pageCount, zoom: Math.round(scale * 100) })
      try {
        const page = await pdfDocument.getPage(currentPage)
        if (cancelled || !canvasRef.current) return
        await renderPdfPageToCanvas(page, canvasRef.current, scale)
        if (!cancelled && viewerRef.current) {
          viewerRef.current.scrollTo({ top: 0, left: 0, behavior: 'smooth' })
        }
        if (!cancelled) {
          setStatus({ key: 'loadedPage', fileName: pdfFileName, page: currentPage, pageCount })
        }
      } catch (error) {
        if (cancelled) return
        const message = error instanceof Error ? error.message : 'Failed to render the current PDF page.'
        setRenderError(message)
        setStatus({ key: 'renderFailed' })
      } finally {
        // no-op
      }
    }
    void renderCurrentPage()
    return () => { cancelled = true }
  }, [currentPage, pageCount, pdfDocument, pdfFileName, scale, viewMode])

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (viewMode !== 'reader' || !pdfDocument || pageCount === 0) return
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return

      if (event.key === 'ArrowRight' || event.key === 'PageDown') {
        event.preventDefault()
        setCurrentPage((p) => clamp(p + 1, 1, pageCount))
      } else if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
        event.preventDefault()
        setCurrentPage((p) => clamp(p - 1, 1, pageCount))
      } else if (event.key === 'Home') {
        event.preventDefault()
        setCurrentPage(1)
      } else if (event.key === 'End') {
        event.preventDefault()
        setCurrentPage(pageCount)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [pageCount, pdfDocument, viewMode])

  // Poll active task
  useEffect(() => {
    if (!activeTask || (activeTask.status !== 'pending' && activeTask.status !== 'running' && activeTask.status !== 'paused')) {
      if (taskPollRef.current) {
        clearInterval(taskPollRef.current)
        taskPollRef.current = null
      }
      return
    }

    const pollTaskStatus = async () => {
      try {
        const updated = await getTaskStatus(activeTask.task_id)
        setActiveTask(updated)
        if (updated.results) {
          setExplanations((prev) => ({ ...prev, ...updated.results }))
          if (pdfHash) {
            const savedFollowUps = await loadSavedFollowUps(pdfHash).catch(() => null)
            if (savedFollowUps?.pages) {
              const mapped: Record<number, FollowUpRecord[]> = {}
              for (const [k, v] of Object.entries(savedFollowUps.pages)) {
                mapped[Number(k)] = v
              }
              setFollowUps(mapped)
            }
          }
        }
        if (updated.status !== 'pending' && updated.status !== 'running' && updated.status !== 'paused') {
          setBatchRangeInput('')
          if (taskPollRef.current) {
            clearInterval(taskPollRef.current)
            taskPollRef.current = null
          }
        }
      } catch { /* ignore polling errors */ }
    }

    void pollTaskStatus()
    taskPollRef.current = setInterval(() => {
      void pollTaskStatus()
    }, 1500)
    return () => {
      if (taskPollRef.current) {
        clearInterval(taskPollRef.current)
        taskPollRef.current = null
      }
    }
  }, [activeTask?.task_id, activeTask?.status, pdfHash])

  const openLibraryDocument = useCallback(async (document: LibraryDocument) => {
    const requestSeq = documentLoadSeqRef.current + 1
    documentLoadSeqRef.current = requestSeq

    setViewMode('reader')
    setCurrentDocumentMeta(document)
    setIsLoadingPdf(true)
    setLoadError('')
    setRenderError('')
    setParseError('')
    setExplanations({})
    setParsingPages([])
    setPagePrompts({})
    setFollowUps({})
    setFollowUpDrafts({})
    setFollowUpModePage(null)
    setOverwriteDialog(null)
    setSkipOverwritePromptChecked(false)
    setActiveTask(null)
    setBatchRangeInput('')
    setBatchPreparationStatus('')
    setExportProgress('')
    setPdfDocument(null)
    setPdfHash(document.pdf_hash)
    setPdfFileName(document.original_file_name)
    setPageCount(0)
    setCurrentPage(1)
    setJumpInput(String(document.last_read_page || 1))
    setScale(DEFAULT_SCALE)
    setStatus({ key: 'loadingPdf', fileName: document.original_file_name })
    setLibraryError('')
    setLibraryActionMessage('')

    try {
      const bytes = await downloadDocumentPdf(document.id)
      if (requestSeq !== documentLoadSeqRef.current) return

      const nextDocument = await loadPdfDocument(bytes)
      if (requestSeq !== documentLoadSeqRef.current) {
        await nextDocument.destroy()
        return
      }

      if (activeDocumentRef.current) await activeDocumentRef.current.destroy()
      activeDocumentRef.current = nextDocument
      setPdfDocument(nextDocument)

      const nextPageCount = nextDocument.numPages
      const nextPage = clamp(document.last_read_page || 1, 1, nextPageCount)
      const openedDocument: LibraryDocument = {
        ...document,
        page_count: nextPageCount,
        last_read_page: nextPage,
        last_opened_at: new Date().toISOString(),
      }

      setPageCount(nextPageCount)
      setCurrentPage(nextPage)
      setJumpInput(String(nextPage))
      syncDocumentIntoShelf(openedDocument)

      const cached = await loadAllCachedExplanations(document.pdf_hash).catch(() => null)
      if (requestSeq !== documentLoadSeqRef.current || !cached) return

      if (cached.pages && Object.keys(cached.pages).length > 0) {
        const mapped: Record<number, string> = {}
        for (const [k, v] of Object.entries(cached.pages)) {
          mapped[Number(k)] = v
        }
        setExplanations(mapped)
      }

      const savedFollowUps = await loadSavedFollowUps(document.pdf_hash).catch(() => null)
      if (requestSeq !== documentLoadSeqRef.current || !savedFollowUps) return

      if (savedFollowUps.pages && Object.keys(savedFollowUps.pages).length > 0) {
        const mapped: Record<number, FollowUpRecord[]> = {}
        for (const [k, v] of Object.entries(savedFollowUps.pages)) {
          mapped[Number(k)] = v
        }
        setFollowUps(mapped)
      }
    } catch (error) {
      if (requestSeq !== documentLoadSeqRef.current) return
      const message = error instanceof Error ? error.message : 'Failed to load the PDF file.'
      setLoadError(message)
      setStatus({ key: 'renderFailed' })
      setViewMode('library')
      setLibraryError(message)
    } finally {
      if (requestSeq === documentLoadSeqRef.current) {
        setIsLoadingPdf(false)
      }
    }
  }, [syncDocumentIntoShelf])

  const isFolderWithin = useCallback((folderId: string | null, ancestorId: string) => {
    let current = folderId
    while (current) {
      if (current === ancestorId) return true
      current = folderParentMap.get(current) ?? null
    }
    return false
  }, [folderParentMap])

  const handleImportLibraryDocument = useCallback(async (file: File, targetFolderId: string | null) => {
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      setLibraryError(isZh ? '请选择 PDF 文件。' : 'Please choose a PDF file.')
      return
    }

    setIsImportingDocument(true)
    setLibraryError('')
    setLibraryActionMessage('')
    try {
      const result = await importDocument(file, targetFolderId)
      await refreshLibraryDocuments(true)
      setLibraryActionMessage(
        result.created
          ? (isZh ? `已导入《${result.document.title}》。` : `Imported "${result.document.title}".`)
          : (isZh ? `《${result.document.title}》已经在书架中了。` : `"${result.document.title}" is already on the shelf.`),
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to import PDF.'
      setLibraryError(message)
    } finally {
      setIsImportingDocument(false)
    }
  }, [isZh, refreshLibraryDocuments])

  const handleCreateFolder = useCallback(async (parentFolderId: string | null) => {
    setLibraryError('')
    setLibraryActionMessage('')
    try {
      const created = await createFolder({
        name: isZh ? '新建文件夹' : 'New Folder',
        parent_folder_id: parentFolderId,
      })
      await refreshLibraryDocuments(true)
      setCurrentFolderId(parentFolderId)
      setLibraryActionMessage(
        isZh ? `已创建文件夹「${created.name}」。` : `Created folder "${created.name}".`,
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create folder.'
      setLibraryError(message)
    }
  }, [isZh, refreshLibraryDocuments])

  const handleRenameLibraryDocument = useCallback(async (document: LibraryDocument, name: string) => {
    setLibraryError('')
    setLibraryActionMessage('')
    try {
      const updated = await renameDocument(document.id, name)
      syncDocumentIntoShelf(updated)
      await refreshLibraryDocuments(true)
      setLibraryActionMessage(
        isZh ? `已重命名为《${updated.title}》。` : `Renamed to "${updated.title}".`,
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to rename document.'
      setLibraryError(message)
    }
  }, [isZh, refreshLibraryDocuments, syncDocumentIntoShelf])

  const handleRenameLibraryFolder = useCallback(async (folder: LibraryFolder, name: string) => {
    setLibraryError('')
    setLibraryActionMessage('')
    try {
      const updated = await renameFolder(folder.id, name)
      await refreshLibraryDocuments(true)
      setLibraryActionMessage(
        isZh ? `已重命名文件夹为「${updated.name}」。` : `Renamed folder to "${updated.name}".`,
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to rename folder.'
      setLibraryError(message)
    }
  }, [isZh, refreshLibraryDocuments])

  const handleMoveLibraryDocument = useCallback(async (document: LibraryDocument, targetFolderId: string | null) => {
    setLibraryError('')
    setLibraryActionMessage('')
    try {
      const updated = await moveDocument(document.id, targetFolderId)
      syncDocumentIntoShelf(updated)
      await refreshLibraryDocuments(true)
      setLibraryActionMessage(
        isZh ? `已移动《${updated.title}》。` : `Moved "${updated.title}".`,
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to move document.'
      setLibraryError(message)
    }
  }, [isZh, refreshLibraryDocuments, syncDocumentIntoShelf])

  const handleMoveLibraryFolder = useCallback(async (folder: LibraryFolder, targetFolderId: string | null) => {
    setLibraryError('')
    setLibraryActionMessage('')
    try {
      const updated = await moveFolder(folder.id, targetFolderId)
      await refreshLibraryDocuments(true)
      setLibraryActionMessage(
        isZh ? `已移动文件夹「${updated.name}」。` : `Moved folder "${updated.name}".`,
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to move folder.'
      setLibraryError(message)
    }
  }, [isZh, refreshLibraryDocuments])

  const handleDeleteLibraryDocument = useCallback(async (document: LibraryDocument, removeCache: boolean) => {
    const confirmed = window.confirm(
      removeCache
        ? (isZh
            ? `删除《${document.title}》并清除该 PDF 的缓存讲解？`
            : `Delete "${document.title}" and remove its cached explanations?`)
        : (isZh
            ? `将《${document.title}》移出书架，但保留缓存讲解？`
            : `Remove "${document.title}" from the shelf but keep its cached explanations?`),
    )
    if (!confirmed) return

    setLibraryError('')
    setLibraryActionMessage('')
    try {
      await deleteDocument(document.id, removeCache)
      await refreshLibraryDocuments(true)
      if (currentDocumentMeta?.id === document.id) {
        resetReaderState()
      }
      setLibraryActionMessage(
        removeCache
          ? (isZh ? `已删除《${document.title}》及其缓存。` : `Deleted "${document.title}" and its cache.`)
          : (isZh ? `已将《${document.title}》移出书架，缓存已保留。` : `Removed "${document.title}" from the shelf and kept cache.`),
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete document.'
      setLibraryError(message)
    }
  }, [currentDocumentMeta?.id, isZh, refreshLibraryDocuments, resetReaderState])

  const handleDeleteLibraryFolder = useCallback(async (folder: LibraryFolder) => {
    const confirmed = window.confirm(
      isZh
        ? `删除文件夹「${folder.name}」以及其中全部书本？缓存默认保留。`
        : `Delete folder "${folder.name}" and all books inside it? Cached explanations will be kept by default.`,
    )
    if (!confirmed) return

    setLibraryError('')
    setLibraryActionMessage('')
    try {
      await deleteFolder(folder.id, false)
      if (isFolderWithin(currentFolderId, folder.id)) {
        setCurrentFolderId(folder.parent_id)
      }
      if (currentDocumentMeta && isFolderWithin(currentDocumentMeta.parent_folder_id, folder.id)) {
        resetReaderState()
      }
      await refreshLibraryDocuments(true)
      setLibraryActionMessage(
        isZh ? `已删除文件夹「${folder.name}」。` : `Deleted folder "${folder.name}".`,
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete folder.'
      setLibraryError(message)
    }
  }, [currentDocumentMeta, currentFolderId, isFolderWithin, isZh, refreshLibraryDocuments, resetReaderState])

  const handleBackToLibrary = useCallback(() => {
    setViewMode('library')
    if (currentDocumentMeta && pageCount > 0) {
      void updateDocumentProgress(currentDocumentMeta.id, currentPage)
        .then((updated) => {
          syncDocumentIntoShelf(updated)
        })
        .catch(() => { /* ignore progress sync errors */ })
    }
    void refreshLibraryDocuments(true)
  }, [currentDocumentMeta, currentPage, pageCount, refreshLibraryDocuments, syncDocumentIntoShelf])

  const goToPage = (pageNumber: number) => {
    if (!pdfDocument || pageCount === 0) return
    setCurrentPage(clamp(pageNumber, 1, pageCount))
  }

  const handleJumpSubmit = () => {
    const targetPage = Number.parseInt(jumpInput, 10)
    if (Number.isFinite(targetPage)) goToPage(targetPage)
  }

  const handleJumpKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') handleJumpSubmit()
  }

  const changeScale = (delta: number) => {
    setScale((p) => clamp(Number((p + delta).toFixed(2)), MIN_SCALE, MAX_SCALE))
  }

  const handleViewerWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (!event.ctrlKey && !event.metaKey) return
    event.preventDefault()
    setScale((p) => clamp(Number((p + (event.deltaY < 0 ? 0.08 : -0.08)).toFixed(2)), MIN_SCALE, MAX_SCALE))
  }

  const runCurrentPageAction = useCallback(async (forceExplanationOverwrite: boolean) => {
    if (!pdfDocument || !pdfHash) return
    const pageToParse = currentPage
    if (parsingPages.includes(pageToParse)) return

    setParsingPages((prev) => [...prev, pageToParse])
    setParseError('')
    setStatus({ key: 'parsing', page: pageToParse })
    try {
      const image = await renderPdfPageToDataUrl(pdfDocument, pageToParse, DEFAULT_EXPORT_SCALE)
      const base64 = image.dataUrl.replace(/^data:image\/png;base64,/, '')
      if (isCurrentPageFollowUpMode) {
        const question = currentFollowUpDraft.trim()
        if (!question) {
          throw new Error(isZh ? '请输入追问内容后再发送。' : 'Enter a follow-up question before sending.')
        }
        if (!currentPageExplanation) {
          throw new Error(isZh ? '当前页还没有主讲解，暂时不能追问。' : 'A main explanation is required before follow-up.')
        }

        const result = await followUpPage({
          pdf_hash: pdfHash,
          page_number: pageToParse,
          image_base64: base64,
          question,
          current_explanation: currentPageExplanation,
        })
        applyFollowUpsToPage(pageToParse, [...(followUps[pageToParse] ?? []), result.follow_up])
      } else {
        const result = await parseSinglePage({
          pdf_hash: pdfHash,
          page_number: pageToParse,
          image_base64: base64,
          page_prompt: currentPagePrompt.trim() || undefined,
          force: forceExplanationOverwrite,
        })
        setExplanations((prev) => ({ ...prev, [pageToParse]: result.explanation }))
      }
      setStatus({ key: 'parsed', page: pageToParse })
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Parse failed'
      setParseError(msg)
      setStatus({ key: 'parseFailed', error: msg })
    } finally {
      setParsingPages((prev) => prev.filter((page) => page !== pageToParse))
    }
  }, [
    applyFollowUpsToPage,
    currentFollowUpDraft,
    currentPage,
    currentPageExplanation,
    currentPagePrompt,
    followUps,
    isCurrentPageFollowUpMode,
    isZh,
    parsingPages,
    pdfDocument,
    pdfHash,
  ])

  const handleParseCurrent = useCallback(async () => {
    if (isCurrentPageFollowUpMode) {
      await runCurrentPageAction(false)
      return
    }

    if (currentPageExplanation && !skipOverwritePrompt) {
      setOverwriteDialog({ page: currentPage })
      setSkipOverwritePromptChecked(false)
      return
    }

    await runCurrentPageAction(Boolean(currentPageExplanation))
  }, [
    currentPage,
    currentPageExplanation,
    isCurrentPageFollowUpMode,
    runCurrentPageAction,
    skipOverwritePrompt,
  ])

  const handleConfirmOverwriteParse = useCallback(() => {
    const targetPage = overwriteDialog?.page
    if (targetPage !== currentPage) {
      setOverwriteDialog(null)
      return
    }
    if (skipOverwritePromptChecked) {
      setSkipOverwritePrompt(true)
    }
    setOverwriteDialog(null)
    void runCurrentPageAction(true)
  }, [currentPage, overwriteDialog?.page, runCurrentPageAction, skipOverwritePromptChecked])

  const handleToggleFollowUpMode = useCallback(() => {
    if (!currentPageExplanation) return
    setFollowUpModePage((prev) => (prev === currentPage ? null : currentPage))
    setParseError('')
  }, [currentPage, currentPageExplanation])

  const handleParseRange = useCallback(async (rangeStr: string, force: boolean) => {
    if (!pdfDocument || !pdfHash) return
    const pages = parsePageSelection(rangeStr, pageCount)
    if (pages.length === 0) return

    setParseError('')
    try {
      setBatchPreparationStatus(
        isZh ? `正在准备批量任务 0/${pages.length} 页...` : `Preparing batch task 0/${pages.length}...`,
      )
      const imagesBase64: Record<number, string> = {}
      for (let index = 0; index < pages.length; index += 1) {
        const p = pages[index]
        const img = await renderPdfPageToDataUrl(pdfDocument, p, DEFAULT_EXPORT_SCALE)
        imagesBase64[p] = img.dataUrl.replace(/^data:image\/png;base64,/, '')
        setBatchPreparationStatus(
          isZh
            ? `正在准备批量任务 ${index + 1}/${pages.length} 页...`
            : `Preparing batch task ${index + 1}/${pages.length}...`,
        )
      }
      const selectedPagePrompts = Object.fromEntries(
        pages
          .map((page) => [page, pagePrompts[page]?.trim() ?? ''] as const)
          .filter(([, prompt]) => prompt),
      )
      const task = await parseRange({
        pdf_hash: pdfHash,
        pages,
        images_base64: imagesBase64,
        page_prompts: Object.keys(selectedPagePrompts).length > 0 ? selectedPagePrompts : undefined,
        force,
      })
      setActiveTask(task)
      setBatchPreparationStatus('')
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed'
      setParseError(msg)
      setBatchPreparationStatus('')
    }
  }, [pdfDocument, pdfHash, pageCount, pagePrompts, isZh])

  const handleCurrentPagePromptChange = useCallback((value: string) => {
    if (isCurrentPageFollowUpMode) {
      setFollowUpDrafts((prev) => {
        const trimmed = value.trim()
        if (!trimmed) {
          if (!(currentPage in prev)) {
            return prev
          }
          const next = { ...prev }
          delete next[currentPage]
          return next
        }

        return {
          ...prev,
          [currentPage]: value,
        }
      })
      return
    }

    setPagePrompts((prev) => {
      const trimmed = value.trim()
      if (!trimmed) {
        if (!(currentPage in prev)) {
          return prev
        }
        const next = { ...prev }
        delete next[currentPage]
        return next
      }

      return {
        ...prev,
        [currentPage]: value,
      }
    })
  }, [currentPage, isCurrentPageFollowUpMode])

  const handleToggleCurrentPageInBatch = useCallback((checked: boolean) => {
    if (pageCount === 0) return

    const nextPages = new Set(selectedBatchPages)
    if (checked) {
      nextPages.add(currentPage)
    } else {
      nextPages.delete(currentPage)
    }

    setBatchRangeInput(formatPageSelection([...nextPages]))
  }, [currentPage, pageCount, selectedBatchPages])

  const hasExplanations = Object.keys(explanations).length > 0
  const isPrimaryActionDisabled = !pdfDocument
    || isCurrentPageParsing
    || (isCurrentPageFollowUpMode && (!currentPageExplanation || !currentFollowUpDraft.trim()))

  const handleExportJson = useCallback(() => {
    if (!pdfHash) return
    exportAsJson(pdfHash, pdfFileName, explanations, pageCount)
  }, [pdfHash, pdfFileName, explanations, pageCount])

  const handleExportHtml = useCallback(async () => {
    if (!pdfDocument || !hasExplanations) return
    setIsExporting(true)
    setExportProgress(isZh ? '准备导出...' : 'Preparing...')
    try {
      await exportAsHtml(pdfDocument, pdfFileName, explanations, pageCount, DEFAULT_EXPORT_SCALE, exportAllPages, (done, total) => {
        setExportProgress(isZh ? `渲染页面 ${done}/${total}...` : `Rendering ${done}/${total}...`)
      })
      setExportProgress(isZh ? '导出完成' : 'Done')
    } catch (e) {
      setExportProgress(isZh ? `导出失败：${e}` : `Failed: ${e}`)
    } finally {
      setIsExporting(false)
      setTimeout(() => setExportProgress(''), 3000)
    }
  }, [pdfDocument, pdfFileName, explanations, pageCount, hasExplanations, isZh, exportAllPages])

  const handleExportPdf = useCallback(async () => {
    if (!pdfDocument || !hasExplanations) return
    setIsExporting(true)
    setExportProgress(isZh ? '准备导出...' : 'Preparing...')
    try {
      await exportAsPdf(pdfDocument, pdfFileName, explanations, pageCount, DEFAULT_EXPORT_SCALE, exportAllPages, (progress: PdfExportProgress) => {
        if (progress.phase === 'render') {
          setExportProgress(isZh ? `渲染页面 ${progress.done}/${progress.total}...` : `Rendering ${progress.done}/${progress.total}...`)
          return
        }

        if (progress.phase === 'upload') {
          const uploadedText = progress.total > 0
            ? `${progress.done}/${progress.total}`
            : `${progress.done}`
          setExportProgress(isZh ? `上传导出页 ${uploadedText}...` : `Uploading sheets ${uploadedText}...`)
          return
        }

        setExportProgress(isZh ? '正在合成 PDF...' : 'Finalizing PDF...')
      })
      setExportProgress(isZh ? '导出完成' : 'Export complete')
    } catch (e) {
      setExportProgress(isZh ? `导出失败：${e}` : `Failed: ${e}`)
    } finally {
      setIsExporting(false)
      setTimeout(() => setExportProgress(''), 5000)
    }
  }, [pdfDocument, pdfFileName, explanations, pageCount, hasExplanations, isZh, exportAllPages])

  return (
    <div className="app-shell">
      {showAiConfig && <AiConfigPanel locale={locale} onClose={() => setShowAiConfig(false)} />}
      {showPromptEditor && <PromptEditor locale={locale} onClose={() => setShowPromptEditor(false)} />}

      <header className="top-bar">
        <div className="top-bar-left">
          <span className="top-bar-brand">BookLearning</span>
          {viewMode === 'reader' ? (
            <>
              <button type="button" className="top-bar-btn" onClick={handleBackToLibrary}>
                {isZh ? '返回书架' : 'Back to shelf'}
              </button>
              <span className="top-bar-filename">{displayFileName}</span>
            </>
          ) : (
            <span className="top-bar-library-tag">{isZh ? '本地书架' : 'Local shelf'}</span>
          )}
        </div>
        <div className="top-bar-right">
          {viewMode === 'reader' && (
            <>
              <span className="top-bar-page-info">
                {pageCount > 0 && (isZh ? `${currentPage} / ${pageCount} 页` : `${currentPage} / ${pageCount}`)}
              </span>
              <div className="top-bar-zoom">
                <button type="button" onClick={() => changeScale(-0.1)} disabled={!pdfDocument || scale <= MIN_SCALE}>-</button>
                <span>{Math.round(scale * 100)}%</span>
                <button type="button" onClick={() => changeScale(0.1)} disabled={!pdfDocument || scale >= MAX_SCALE}>+</button>
              </div>
            </>
          )}
          <button type="button" className="top-bar-btn" onClick={() => setShowAiConfig(true)}>
            {isZh ? 'AI 配置' : 'AI Config'}
          </button>
          <button type="button" className="top-bar-btn" onClick={() => setShowPromptEditor(true)}>
            {isZh ? '提示词' : 'Prompts'}
          </button>
          <div className="top-bar-lang">
            <button type="button" className={locale === 'zh' ? 'lang-btn lang-btn--active' : 'lang-btn'} onClick={() => setLocale('zh')}>中</button>
            <button type="button" className={locale === 'en' ? 'lang-btn lang-btn--active' : 'lang-btn'} onClick={() => setLocale('en')}>En</button>
          </div>
        </div>
      </header>

      {viewMode === 'library' ? (
        <Bookshelf
          locale={locale}
          folders={libraryFolders}
          documents={libraryDocuments}
          currentFolderId={currentFolderId}
          currentDocumentId={currentDocumentMeta?.id ?? null}
          loading={isLibraryLoading}
          importing={isImportingDocument}
          error={libraryError}
          actionMessage={libraryActionMessage}
          onNavigateFolder={setCurrentFolderId}
          onCreateFolder={handleCreateFolder}
          onImport={handleImportLibraryDocument}
          onOpen={(document) => { void openLibraryDocument(document) }}
          onRenameDocument={handleRenameLibraryDocument}
          onRenameFolder={handleRenameLibraryFolder}
          onMoveDocument={handleMoveLibraryDocument}
          onMoveFolder={handleMoveLibraryFolder}
          onDelete={handleDeleteLibraryDocument}
          onDeleteFolder={handleDeleteLibraryFolder}
        />
      ) : (
        <main
          ref={splitLayoutRef}
          className={`main-layout${isResizing ? ' main-layout--resizing' : ''}`}
          style={{ gridTemplateColumns: `${viewerRatio}fr 8px ${100 - viewerRatio}fr` }}
        >
          <section className="viewer-pane">
            <div className="viewer-toolbar">
              <span>{displayFileName}</span>
              <span>
                {isZh
                  ? `第 ${currentPage} / ${pageCount || 0} 页`
                  : `Page ${currentPage} / ${pageCount || 0}`}
              </span>
            </div>
            <div ref={viewerRef} className="single-page-stage" onWheel={handleViewerWheel}>
              {pageCount === 0 ? (
                <div className="empty-reader">
                  <p>{isZh ? '正在从本地书架载入 PDF...' : 'Loading PDF from your local shelf...'}</p>
                </div>
              ) : (
                <div className="single-page-card">
                  <canvas ref={canvasRef} className="pdf-canvas" />
                </div>
              )}
            </div>
          </section>

          <div
            className="splitter"
            role="separator"
            aria-orientation="vertical"
            onPointerDown={() => setIsResizing(true)}
          />

          <aside
            ref={rightPanelRef}
            className={`right-panel${isRightPanelResizing ? ' right-panel--resizing' : ''}`}
            style={
              {
                '--right-top-size': `${rightTopRatio}fr`,
                '--right-bottom-size': `${100 - rightTopRatio}fr`,
              } as CSSProperties
            }
          >
            <div className="right-top">
              <ExplanationPanel
                locale={locale}
                currentPage={currentPage}
                explanations={explanations}
                followUps={currentPageFollowUps}
                isFollowUpMode={isCurrentPageFollowUpMode}
                isLoading={isCurrentPageParsing}
                pageCount={pageCount}
                pdfHash={pdfHash}
                onExplanationUpdate={(page, text) => {
                  setExplanations((prev) => ({ ...prev, [page]: text }))
                }}
                onFollowUpsUpdate={applyFollowUpsToPage}
                onToggleFollowUpMode={handleToggleFollowUpMode}
              />
            </div>

            <div
              className="right-splitter"
              role="separator"
              aria-orientation="horizontal"
              onPointerDown={() => setIsRightPanelResizing(true)}
            />

            <div className="right-bottom">
              <div className="control-dock">
                <div className="control-grid">
                  <section className="control-card control-card--hero">
                    <div className="control-card-heading">
                      <div>
                        <span className="control-card-kicker">{isZh ? 'Primary Action' : 'Primary Action'}</span>
                        <h4>
                          {isCurrentPageFollowUpMode
                            ? (isZh ? '当前页追问' : 'Current page follow-up')
                            : (isZh ? '当前页解析' : 'Current page parse')}
                        </h4>
                      </div>
                      <label className="ctrl-check ctrl-check--pill">
                        <input
                          type="checkbox"
                          checked={isCurrentPageInBatch}
                          onChange={(e) => handleToggleCurrentPageInBatch(e.target.checked)}
                          disabled={!pdfDocument}
                        />
                        {isZh ? '加入批量队列' : 'Add to batch'}
                      </label>
                    </div>
                    <div className="control-action-row">
                      <button type="button" className="ctrl-btn ctrl-btn--soft" onClick={() => goToPage(currentPage - 1)} disabled={!pdfDocument || currentPage <= 1}>
                        {isZh ? '上一页' : 'Prev'}
                      </button>
                      <button type="button" className="ctrl-btn ctrl-btn--soft" onClick={() => goToPage(currentPage + 1)} disabled={!pdfDocument || currentPage >= pageCount}>
                        {isZh ? '下一页' : 'Next'}
                      </button>
                      <button type="button" className="ctrl-btn ctrl-btn--primary ctrl-btn--flex" onClick={handleParseCurrent} disabled={isPrimaryActionDisabled}>
                        {isCurrentPageParsing
                          ? (isZh ? '处理中...' : 'Running...')
                          : isCurrentPageFollowUpMode
                            ? (isZh ? '发送' : 'Send')
                            : (isZh ? '解析当前页' : 'Parse page')}
                      </button>
                    </div>
                  </section>

                  <section className="control-card control-card--compact">
                    <div className="control-card-heading">
                      <div>
                        <span className="control-card-kicker">{isZh ? 'Navigation' : 'Navigation'}</span>
                        <h4>{isZh ? '快速跳转' : 'Quick jump'}</h4>
                      </div>
                    </div>
                    <div className="control-inline-fields">
                      <label className="ctrl-field">
                        <span className="ctrl-field-label">{isZh ? '目标页码' : 'Target page'}</span>
                        <input className="ctrl-input" type="text" value={jumpInput} onChange={(e) => setJumpInput(e.target.value)} onKeyDown={handleJumpKeyDown} placeholder="12" />
                      </label>
                      <button type="button" className="ctrl-btn ctrl-btn--block-mobile" onClick={handleJumpSubmit} disabled={!pdfDocument}>{isZh ? '跳转' : 'Go'}</button>
                    </div>
                  </section>
                </div>

                <ParseControls
                  locale={locale}
                  disabled={!pdfDocument}
                  activeTask={activeTask}
                  selectedBatchCount={selectedBatchPages.length}
                  rangeInput={batchRangeInput}
                  onRangeInputChange={setBatchRangeInput}
                  onParseRange={handleParseRange}
                  pagePrompt={isCurrentPageFollowUpMode ? currentFollowUpDraft : currentPagePrompt}
                  onPagePromptChange={handleCurrentPagePromptChange}
                  configuredPromptCount={configuredPromptCount}
                  onTaskUpdate={setActiveTask}
                  batchPreparationStatus={batchPreparationStatus}
                  isFollowUpMode={isCurrentPageFollowUpMode}
                />

                <section className="control-card">
                  <div className="control-card-heading">
                    <div>
                      <span className="control-card-kicker">{isZh ? 'Export' : 'Export'}</span>
                      <h4>{isZh ? '学习资料导出' : 'Export study assets'}</h4>
                    </div>
                    <label className="ctrl-check ctrl-check--pill">
                      <input type="checkbox" checked={exportAllPages} onChange={(e) => setExportAllPages(e.target.checked)} disabled={!pdfDocument} />
                      {isZh ? '包含全部页' : 'All pages'}
                    </label>
                  </div>
                  <div className="control-action-row">
                    <button type="button" className="ctrl-btn ctrl-btn--soft" onClick={handleExportJson} disabled={!hasExplanations || isExporting}>
                      {isZh ? '导出数据' : 'Export JSON'}
                    </button>
                    <button type="button" className="ctrl-btn ctrl-btn--soft" onClick={handleExportHtml} disabled={!hasExplanations || isExporting}>
                      {isZh ? '导出 HTML' : 'Export HTML'}
                    </button>
                    <button type="button" className="ctrl-btn ctrl-btn--soft" onClick={handleExportPdf} disabled={!hasExplanations || isExporting}>
                      {isZh ? '导出 PDF' : 'Export PDF'}
                    </button>
                  </div>
                  {exportProgress && (
                    <div className="control-banner control-banner--neutral">
                      <span>{exportProgress}</span>
                    </div>
                  )}
                </section>

                <div className="control-banner control-banner--status">
                  <span>{isLoadingPdf ? getStatusText(locale, { key: 'loadingPdf', fileName: pdfFileName }) : statusText}</span>
                </div>

                {(loadError || renderError || parseError) && (
                  <div className="control-banner control-banner--error">
                    {loadError && <p>{loadError}</p>}
                    {renderError && <p>{renderError}</p>}
                    {parseError && <p>{parseError}</p>}
                  </div>
                )}
              </div>
            </div>
          </aside>
        </main>
      )}

      {overwriteDialog && (
        <div className="modal-overlay" onClick={() => setOverwriteDialog(null)}>
          <div className="modal-content confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{isZh ? '覆盖当前讲解？' : 'Replace current explanation?'}</h3>
              <button type="button" className="modal-close" onClick={() => setOverwriteDialog(null)}>×</button>
            </div>
            <div className="confirm-dialog-copy">
              <p>
                {isZh
                  ? `第 ${overwriteDialog.page} 页已经有讲解。重新生成后会直接覆盖当前讲解。`
                  : `Page ${overwriteDialog.page} already has an explanation. Regenerating it will replace the current one.`}
              </p>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={skipOverwritePromptChecked}
                  onChange={(e) => setSkipOverwritePromptChecked(e.target.checked)}
                />
                {isZh ? '本次使用不再提示' : 'Do not ask again this session'}
              </label>
            </div>
            <div className="button-row confirm-dialog-actions">
              <button type="button" onClick={handleConfirmOverwriteParse}>
                {isZh ? '继续覆盖' : 'Replace'}
              </button>
              <button type="button" className="secondary" onClick={() => setOverwriteDialog(null)}>
                {isZh ? '取消' : 'Cancel'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
