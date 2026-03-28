import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  CSSProperties,
  MouseEvent as ReactMouseEvent,
} from 'react'
import 'katex/dist/katex.min.css'
import type { FollowUpRecord, HyperlinkRecord, NoteRecord } from '../lib/api'
import {
  createHyperlink,
  createNote,
  deleteFollowUp,
  deleteNote,
  saveEditedExplanation,
  updateFollowUp,
  updateNote,
} from '../lib/api'
import { renderExplanationMarkdown } from '../lib/renderMarkdown'

const MIN_AI_FONT_SIZE = 13
const MAX_AI_FONT_SIZE = 24
const DEFAULT_AI_FONT_SIZE = 15

type JumpTarget = {
  pageNumber: number
  targetType: 'followup' | 'note'
  targetId: string
} | null

type Props = {
  locale: 'zh' | 'en'
  currentPage: number
  explanations: Record<number, string>
  followUps: FollowUpRecord[]
  notes: NoteRecord[]
  hyperlinks: HyperlinkRecord[]
  activeMode: 'explanation' | 'follow-up' | 'note'
  isLoading: boolean
  pageCount: number
  pdfHash: string
  jumpTarget: JumpTarget
  isCurrentPageBookmarked: boolean
  currentPageBookmarkText: string
  bookmarkDraft: string
  isBookmarkEditorOpen: boolean
  isBookmarkSaving: boolean
  onExplanationUpdate: (page: number, text: string) => void
  onFollowUpsUpdate: (page: number, items: FollowUpRecord[]) => void
  onNotesUpdate: (page: number, items: NoteRecord[]) => void
  onHyperlinkUpsert: (item: HyperlinkRecord) => void
  onPruneHyperlinksForTarget: (pageNumber: number, targetType: 'followup' | 'note', targetId: string) => void
  onJumpToLinkedTarget: (pageNumber: number, targetType: 'followup' | 'note', targetId: string) => void
  onJumpTargetHandled: () => void
  onToggleFollowUpMode: () => void
  onToggleNoteMode: () => void
  onBookmarkDraftChange: (value: string) => void
  onToggleBookmark: (checked: boolean) => void
  onToggleBookmarkEditor: () => void
  onCloseBookmarkEditor: () => void
  onSaveBookmarkText: () => void
}

type ContextMenuKind = 'followup' | 'note'

type ContextMenuState = {
  kind: ContextMenuKind
  id: string
  x: number
  y: number
} | null

export default function ExplanationPanel({
  locale,
  currentPage,
  explanations,
  followUps,
  notes,
  hyperlinks,
  activeMode,
  isLoading,
  pageCount,
  pdfHash,
  jumpTarget,
  isCurrentPageBookmarked,
  currentPageBookmarkText,
  bookmarkDraft,
  isBookmarkEditorOpen,
  isBookmarkSaving,
  onExplanationUpdate,
  onFollowUpsUpdate,
  onNotesUpdate,
  onHyperlinkUpsert,
  onPruneHyperlinksForTarget,
  onJumpToLinkedTarget,
  onJumpTargetHandled,
  onToggleFollowUpMode,
  onToggleNoteMode,
  onBookmarkDraftChange,
  onToggleBookmark,
  onToggleBookmarkEditor,
  onCloseBookmarkEditor,
  onSaveBookmarkText,
}: Props) {
  const isZh = locale === 'zh'
  const explanation = explanations[currentPage]
  const isFollowUpMode = activeMode === 'follow-up'
  const isNoteMode = activeMode === 'note'
  const bookmarkRef = useRef<HTMLDivElement | null>(null)
  const messageTimerRef = useRef<number | null>(null)
  const followUpRefs = useRef<Record<string, HTMLElement | null>>({})
  const noteRefs = useRef<Record<string, HTMLElement | null>>({})
  const [isEditing, setIsEditing] = useState(false)
  const [editText, setEditText] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')
  const [fontSize, setFontSize] = useState(DEFAULT_AI_FONT_SIZE)
  const [editingFollowUpId, setEditingFollowUpId] = useState<string | null>(null)
  const [editFollowUpQuestion, setEditFollowUpQuestion] = useState('')
  const [editFollowUpAnswer, setEditFollowUpAnswer] = useState('')
  const [isSavingFollowUp, setIsSavingFollowUp] = useState(false)
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null)
  const [editNoteContent, setEditNoteContent] = useState('')
  const [isSavingNote, setIsSavingNote] = useState(false)
  const [isCreatingNote, setIsCreatingNote] = useState(false)
  const [newNoteContent, setNewNoteContent] = useState('')
  const [isCreatingNoteSaving, setIsCreatingNoteSaving] = useState(false)
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null)
  const [isHyperlinkDrawerOpen, setIsHyperlinkDrawerOpen] = useState(false)

  const renderedExplanation = useMemo(
    () => renderExplanationMarkdown(explanation || ''),
    [explanation],
  )
  const panelStyle = useMemo(
    () => ({ '--ai-font-size': `${fontSize}px` } as CSSProperties),
    [fontSize],
  )
  const currentPageHyperlinks = useMemo(
    () => hyperlinks.filter((item) => item.page_number === currentPage),
    [currentPage, hyperlinks],
  )
  const groupedHyperlinks = useMemo(() => {
    const groups = new Map<number, HyperlinkRecord[]>()
    for (const hyperlink of hyperlinks) {
      const bucket = groups.get(hyperlink.page_number) ?? []
      bucket.push(hyperlink)
      groups.set(hyperlink.page_number, bucket)
    }
    return [...groups.entries()].sort((left, right) => left[0] - right[0])
  }, [hyperlinks])

  const flashMessage = useCallback((message: string) => {
    setSaveMsg(message)
    if (messageTimerRef.current !== null) {
      window.clearTimeout(messageTimerRef.current)
    }
    messageTimerRef.current = window.setTimeout(() => {
      setSaveMsg('')
      messageTimerRef.current = null
    }, 2200)
  }, [])

  useEffect(() => {
    return () => {
      if (messageTimerRef.current !== null) {
        window.clearTimeout(messageTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    setIsEditing(false)
    setSaveMsg('')
    setEditingFollowUpId(null)
    setEditingNoteId(null)
    setIsCreatingNote(false)
    setNewNoteContent('')
    setContextMenu(null)
  }, [currentPage])

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
    if (!isBookmarkEditorOpen) return
    const handlePointerDown = (event: PointerEvent) => {
      if (bookmarkRef.current && event.target instanceof Node && !bookmarkRef.current.contains(event.target)) {
        onCloseBookmarkEditor()
      }
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onCloseBookmarkEditor()
      }
    }
    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isBookmarkEditorOpen, onCloseBookmarkEditor])

  useEffect(() => {
    if (!editingFollowUpId) return
    if (!followUps.some((item) => item.id === editingFollowUpId)) {
      setEditingFollowUpId(null)
    }
  }, [editingFollowUpId, followUps])

  useEffect(() => {
    if (!editingNoteId) return
    if (!notes.some((item) => item.id === editingNoteId)) {
      setEditingNoteId(null)
    }
  }, [editingNoteId, notes])

  const handleStartEdit = useCallback(() => {
    setEditText(explanation || '')
    setIsEditing(true)
    setSaveMsg('')
  }, [explanation])

  const handleCancelEdit = useCallback(() => {
    setIsEditing(false)
    setSaveMsg('')
  }, [])

  const handleAdjustFontSize = useCallback((delta: number) => {
    setFontSize((prev) => Math.min(MAX_AI_FONT_SIZE, Math.max(MIN_AI_FONT_SIZE, prev + delta)))
  }, [])

  const handleSaveExplanation = useCallback(async () => {
    if (!pdfHash || !editText.trim()) return
    setIsSaving(true)
    setSaveMsg('')
    try {
      await saveEditedExplanation(pdfHash, currentPage, editText)
      onExplanationUpdate(currentPage, editText)
      setIsEditing(false)
      flashMessage(isZh ? '讲解已保存' : 'Explanation saved')
    } catch {
      setSaveMsg(isZh ? '讲解保存失败' : 'Failed to save explanation')
    } finally {
      setIsSaving(false)
    }
  }, [currentPage, editText, flashMessage, isZh, onExplanationUpdate, pdfHash])

  const handleOpenContextMenu = useCallback((event: ReactMouseEvent, kind: ContextMenuKind, id: string) => {
    event.preventDefault()
    event.stopPropagation()
    setContextMenu({
      kind,
      id,
      x: event.clientX,
      y: event.clientY,
    })
  }, [])

  const handleStartEditFollowUp = useCallback((followUpId: string) => {
    const target = followUps.find((item) => item.id === followUpId)
    if (!target) return
    setEditingFollowUpId(followUpId)
    setEditFollowUpQuestion(target.question)
    setEditFollowUpAnswer(target.answer)
    setContextMenu(null)
    setSaveMsg('')
  }, [followUps])

  const handleCancelEditFollowUp = useCallback(() => {
    setEditingFollowUpId(null)
    setEditFollowUpQuestion('')
    setEditFollowUpAnswer('')
  }, [])

  const handleSaveFollowUp = useCallback(async () => {
    if (!pdfHash || !editingFollowUpId || !editFollowUpQuestion.trim() || !editFollowUpAnswer.trim()) {
      return
    }
    setIsSavingFollowUp(true)
    setSaveMsg('')
    try {
      const updated = await updateFollowUp(pdfHash, currentPage, editingFollowUpId, {
        question: editFollowUpQuestion,
        answer: editFollowUpAnswer,
      })
      onFollowUpsUpdate(
        currentPage,
        followUps.map((item) => (item.id === editingFollowUpId ? updated : item)),
      )
      setEditingFollowUpId(null)
      setEditFollowUpQuestion('')
      setEditFollowUpAnswer('')
      flashMessage(isZh ? '追问已保存' : 'Follow-up saved')
    } catch {
      setSaveMsg(isZh ? '追问保存失败' : 'Failed to save follow-up')
    } finally {
      setIsSavingFollowUp(false)
    }
  }, [
    currentPage,
    editFollowUpAnswer,
    editFollowUpQuestion,
    editingFollowUpId,
    flashMessage,
    followUps,
    isZh,
    onFollowUpsUpdate,
    pdfHash,
  ])

  const handleDeleteFollowUp = useCallback(async (followUpId: string) => {
    if (!pdfHash) return
    setContextMenu(null)
    try {
      await deleteFollowUp(pdfHash, currentPage, followUpId)
      const nextItems = followUps.filter((item) => item.id !== followUpId)
      onFollowUpsUpdate(currentPage, nextItems)
      onPruneHyperlinksForTarget(currentPage, 'followup', followUpId)
      if (editingFollowUpId === followUpId) {
        handleCancelEditFollowUp()
      }
      flashMessage(isZh ? '追问已删除' : 'Follow-up deleted')
    } catch {
      setSaveMsg(isZh ? '删除追问失败' : 'Failed to delete follow-up')
    }
  }, [
    currentPage,
    editingFollowUpId,
    flashMessage,
    followUps,
    handleCancelEditFollowUp,
    isZh,
    onFollowUpsUpdate,
    onPruneHyperlinksForTarget,
    pdfHash,
  ])

  const handleStartEditNote = useCallback((noteId: string) => {
    const target = notes.find((item) => item.id === noteId)
    if (!target) return
    setEditingNoteId(noteId)
    setEditNoteContent(target.content)
    setContextMenu(null)
    setSaveMsg('')
  }, [notes])

  const handleCancelEditNote = useCallback(() => {
    setEditingNoteId(null)
    setEditNoteContent('')
  }, [])

  const handleSaveNote = useCallback(async () => {
    if (!pdfHash || !editingNoteId || !editNoteContent.trim()) {
      return
    }
    setIsSavingNote(true)
    setSaveMsg('')
    try {
      const updated = await updateNote(pdfHash, currentPage, editingNoteId, {
        content: editNoteContent,
      })
      onNotesUpdate(
        currentPage,
        notes.map((item) => (item.id === editingNoteId ? updated : item)),
      )
      setEditingNoteId(null)
      setEditNoteContent('')
      flashMessage(isZh ? '笔记已保存' : 'Note saved')
    } catch {
      setSaveMsg(isZh ? '笔记保存失败' : 'Failed to save note')
    } finally {
      setIsSavingNote(false)
    }
  }, [currentPage, editNoteContent, editingNoteId, flashMessage, isZh, notes, onNotesUpdate, pdfHash])

  const handleCreateNote = useCallback(async () => {
    if (!pdfHash || !newNoteContent.trim()) {
      return
    }
    setIsCreatingNoteSaving(true)
    setSaveMsg('')
    try {
      const created = await createNote({
        pdf_hash: pdfHash,
        page_number: currentPage,
        content: newNoteContent,
      })
      onNotesUpdate(currentPage, [...notes, created])
      setIsCreatingNote(false)
      setNewNoteContent('')
      flashMessage(isZh ? '笔记已添加' : 'Note added')
    } catch {
      setSaveMsg(isZh ? '添加笔记失败' : 'Failed to add note')
    } finally {
      setIsCreatingNoteSaving(false)
    }
  }, [currentPage, flashMessage, isZh, newNoteContent, notes, onNotesUpdate, pdfHash])

  const handleDeleteNote = useCallback(async (noteId: string) => {
    if (!pdfHash) return
    setContextMenu(null)
    try {
      await deleteNote(pdfHash, currentPage, noteId)
      const nextItems = notes.filter((item) => item.id !== noteId)
      onNotesUpdate(currentPage, nextItems)
      onPruneHyperlinksForTarget(currentPage, 'note', noteId)
      if (editingNoteId === noteId) {
        handleCancelEditNote()
      }
      flashMessage(isZh ? '笔记已删除' : 'Note deleted')
    } catch {
      setSaveMsg(isZh ? '删除笔记失败' : 'Failed to delete note')
    }
  }, [
    currentPage,
    editingNoteId,
    flashMessage,
    handleCancelEditNote,
    isZh,
    notes,
    onNotesUpdate,
    onPruneHyperlinksForTarget,
    pdfHash,
  ])

  const handleCreateHyperlinkForTarget = useCallback(async (targetType: 'followup' | 'note', targetId: string) => {
    if (!pdfHash) return
    const targetText = targetType === 'followup'
      ? (followUps.find((item) => item.id === targetId)?.question ?? '')
      : (notes.find((item) => item.id === targetId)?.content ?? '')
    const displayText = targetText.trim()
    if (!displayText) {
      setSaveMsg(isZh ? '没有可用的超链接文本' : 'No text available for hyperlink')
      return
    }

    const nextSlot = currentPageHyperlinks.length
    const positionX = 0.08 + (nextSlot % 2) * 0.28
    const positionY = 0.1 + Math.floor(nextSlot / 2) * 0.12

    try {
      const created = await createHyperlink({
        pdf_hash: pdfHash,
        page_number: currentPage,
        target_type: targetType,
        target_id: targetId,
        display_text: displayText,
        position_x: positionX,
        position_y: positionY,
      })
      onHyperlinkUpsert(created)
      setContextMenu(null)
      flashMessage(isZh ? '超链接已生成' : 'Hyperlink created')
    } catch {
      setSaveMsg(isZh ? '生成超链接失败' : 'Failed to create hyperlink')
    }
  }, [currentPage, currentPageHyperlinks.length, flashMessage, followUps, isZh, notes, onHyperlinkUpsert, pdfHash])

  useEffect(() => {
    if (!jumpTarget || jumpTarget.pageNumber !== currentPage) return
    const targetMap = jumpTarget.targetType === 'followup' ? followUpRefs.current : noteRefs.current
    const element = targetMap[jumpTarget.targetId]
    if (!element) return
    element.scrollIntoView({ behavior: 'smooth', block: 'start' })
    onJumpTargetHandled()
  }, [currentPage, jumpTarget, onJumpTargetHandled, followUps, notes])

  const handleActivateHyperlink = useCallback((hyperlink: HyperlinkRecord) => {
    onJumpToLinkedTarget(hyperlink.page_number, hyperlink.target_type, hyperlink.target_id)
  }, [onJumpToLinkedTarget])

  const parsedCount = Object.keys(explanations).length
  const pageStatus = isLoading
    ? (isZh ? '处理中...' : 'Running...')
    : explanation
      ? (isZh ? '已解析' : 'Parsed')
      : (isZh ? '未解析' : 'Not parsed')

  const statusClass = isLoading
    ? 'page-status--loading'
    : explanation
      ? 'page-status--parsed'
      : 'page-status--empty'
  const isFollowUpLoading = isLoading && isFollowUpMode
  const shouldShowMainLoading = isLoading && !isFollowUpLoading

  const menuStyle = contextMenu
    ? {
        left: Math.max(12, Math.min(contextMenu.x, window.innerWidth - 196)),
        top: Math.max(12, Math.min(contextMenu.y, window.innerHeight - 180)),
      }
    : undefined

  return (
    <div className="explanation-panel" style={panelStyle}>
      <div className="explanation-header">
        <div className="explanation-title-row">
          <h3>{isZh ? 'AI 讲解' : 'AI Explanation'}</h3>
          {parsedCount > 0 && (
            <span className="explanation-inline-meta">
              {isZh
                ? `已解析 ${parsedCount} / ${pageCount} 页`
                : `Parsed ${parsedCount} / ${pageCount}`}
            </span>
          )}
        </div>
        <div className="explanation-header-right">
          <button
            type="button"
            className={`edit-btn hyperlink-drawer-toggle${isHyperlinkDrawerOpen ? ' edit-btn--active' : ''}`}
            onClick={() => setIsHyperlinkDrawerOpen((prev) => !prev)}
          >
            {isZh ? `超链接 ${hyperlinks.length > 0 ? `(${hyperlinks.length})` : ''}` : `Links${hyperlinks.length > 0 ? ` (${hyperlinks.length})` : ''}`}
          </button>
          <label className="ctrl-check ctrl-check--pill explanation-bookmark-toggle">
            <input
              type="checkbox"
              checked={isCurrentPageBookmarked}
              onChange={(event) => onToggleBookmark(event.target.checked)}
              disabled={pageCount === 0 || isBookmarkSaving}
            />
            {isZh ? '本页书签' : 'Bookmark page'}
          </label>
          <div className="explanation-font-controls" aria-label={isZh ? 'AI 字体大小控制' : 'AI font size controls'}>
            <button
              type="button"
              onClick={() => handleAdjustFontSize(-1)}
              disabled={fontSize <= MIN_AI_FONT_SIZE}
              aria-label={isZh ? '减小 AI 字体' : 'Decrease AI font size'}
            >
              A-
            </button>
            <span>{fontSize}px</span>
            <button
              type="button"
              onClick={() => handleAdjustFontSize(1)}
              disabled={fontSize >= MAX_AI_FONT_SIZE}
              aria-label={isZh ? '增大 AI 字体' : 'Increase AI font size'}
            >
              A+
            </button>
          </div>
          <span className={`page-status ${statusClass}`}>{pageStatus}</span>
        </div>
      </div>

      <div className="explanation-body-wrap">
        {isHyperlinkDrawerOpen && (
          <aside className="hyperlink-drawer" onPointerDown={(event) => event.stopPropagation()}>
            <div className="hyperlink-drawer__header">
              <strong>{isZh ? '全部超链接' : 'All hyperlinks'}</strong>
              <button type="button" className="edit-btn" onClick={() => setIsHyperlinkDrawerOpen(false)}>
                {isZh ? '收起' : 'Close'}
              </button>
            </div>
            {groupedHyperlinks.length > 0 ? (
              <div className="hyperlink-drawer__list">
                {groupedHyperlinks.map(([pageNumber, items]) => (
                  <section key={pageNumber} className="hyperlink-drawer__group">
                    <div className="hyperlink-drawer__group-title">
                      {isZh ? `第 ${pageNumber} 页` : `Page ${pageNumber}`}
                    </div>
                    <div className="hyperlink-drawer__group-items">
                      {items.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          className="hyperlink-drawer__item"
                          onClick={() => handleActivateHyperlink(item)}
                        >
                          <span className="hyperlink-drawer__item-text">{item.display_text}</span>
                          <span className="hyperlink-drawer__item-meta">
                            {item.target_type === 'followup'
                              ? (isZh ? '追问' : 'Follow-up')
                              : (isZh ? '笔记' : 'Note')}
                          </span>
                        </button>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            ) : (
              <p className="hyperlink-drawer__empty">
                {isZh ? '还没有生成任何超链接。' : 'No hyperlinks yet.'}
              </p>
            )}
          </aside>
        )}

        {isCurrentPageBookmarked && (
          <div ref={bookmarkRef} className="explanation-bookmark-floating">
            <div className="page-bookmark-wrap page-bookmark-wrap--floating">
              <button
                type="button"
                className={`page-bookmark${isBookmarkEditorOpen ? ' page-bookmark--active' : ''}`}
                onClick={onToggleBookmarkEditor}
                aria-expanded={isBookmarkEditorOpen}
                aria-controls="page-bookmark-panel"
              >
                <span>{isZh ? '书签' : 'Bookmark'}</span>
                {currentPageBookmarkText.trim() && <small>{isZh ? '有备注' : 'Note'}</small>}
              </button>
              {isBookmarkEditorOpen && (
                <div id="page-bookmark-panel" className="page-bookmark-panel" onPointerDown={(event) => event.stopPropagation()}>
                  <div className="page-bookmark-panel__header">
                    <strong>{isZh ? `第 ${currentPage} 页书签` : `Bookmark for page ${currentPage}`}</strong>
                    <button type="button" className="edit-btn" onClick={onCloseBookmarkEditor}>
                      {isZh ? '收起' : 'Close'}
                    </button>
                  </div>
                  <textarea
                    className="page-bookmark-textarea"
                    value={bookmarkDraft}
                    onChange={(event) => onBookmarkDraftChange(event.target.value)}
                    placeholder={isZh ? '记录这一页的重点、疑问或稍后回看的原因。' : 'Add a note for why this page matters.'}
                  />
                  <div className="page-bookmark-panel__footer">
                    <span>
                      {bookmarkDraft.trim()
                        ? (isZh ? `${bookmarkDraft.trim().length} 个字符` : `${bookmarkDraft.trim().length} characters`)
                        : (isZh ? '可留空，只保留页码书签。' : 'Leave empty to keep a page-only bookmark.')}
                    </span>
                    <button type="button" className="ctrl-btn ctrl-btn--soft" onClick={onSaveBookmarkText} disabled={isBookmarkSaving}>
                      {isBookmarkSaving ? (isZh ? '保存中...' : 'Saving...') : (isZh ? '保存书签' : 'Save bookmark')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="explanation-body">
          <div className="explanation-stack">
            {shouldShowMainLoading ? (
              <div className="explanation-loading">
                <div className="spinner" />
                <p>{isZh ? '正在处理当前页...' : 'Processing current page...'}</p>
              </div>
            ) : isEditing ? (
              <div className="explanation-editor">
                <textarea
                  className="explanation-textarea"
                  value={editText}
                  onChange={(event) => setEditText(event.target.value)}
                  rows={16}
                />
                <div className="button-row">
                  <button type="button" onClick={handleSaveExplanation} disabled={isSaving}>
                    {isSaving ? (isZh ? '保存中...' : 'Saving...') : (isZh ? '保存' : 'Save')}
                  </button>
                  <button type="button" className="secondary" onClick={handleCancelEdit}>
                    {isZh ? '取消' : 'Cancel'}
                  </button>
                </div>
              </div>
            ) : explanation ? (
              <div
                className="explanation-content"
                dangerouslySetInnerHTML={{ __html: renderedExplanation }}
              />
            ) : (
              <div className="explanation-empty">
                <div className="empty-icon">?</div>
                <p>
                  {isZh
                    ? '当前页尚未解析。点击下方“解析当前页”按钮开始 AI 讲解。'
                    : 'This page has not been parsed yet. Click "Parse current page" below to start.'}
                </p>
              </div>
            )}

            {(followUps.length > 0 || isFollowUpMode || isFollowUpLoading) && (
              <section className={`follow-up-card${isFollowUpMode ? ' follow-up-card--active' : ''}`}>
                <div className="follow-up-card-header">
                  <span>
                    {isZh
                      ? `当前页追问 ${followUps.length > 0 ? `· ${followUps.length} 条` : ''}`
                      : `Current follow-ups${followUps.length > 0 ? ` · ${followUps.length}` : ''}`}
                  </span>
                  {isFollowUpMode && (
                    <span className="follow-up-card-badge">{isZh ? '追问模式' : 'Follow-up mode'}</span>
                  )}
                </div>
                {(followUps.length > 0 || isFollowUpLoading) ? (
                  <div className="follow-up-list">
                    {followUps.map((followUp, index) => {
                      const isEditingFollowUp = editingFollowUpId === followUp.id
                      return (
                        <article
                          key={followUp.id}
                          ref={(node) => {
                            followUpRefs.current[followUp.id] = node
                          }}
                          className="follow-up-item"
                          onContextMenu={(event) => handleOpenContextMenu(event, 'followup', followUp.id)}
                        >
                          <div className="follow-up-item-top">
                            <span className="follow-up-item-index">
                              {isZh ? `追问 ${index + 1}` : `Follow-up ${index + 1}`}
                            </span>
                            <span className="follow-up-item-hint">
                              {isZh ? '右键可编辑、删除或生成超链接' : 'Right click to edit, delete, or create a hyperlink'}
                            </span>
                          </div>
                          {isEditingFollowUp ? (
                            <div className="follow-up-editor">
                              <label className="follow-up-question-label">{isZh ? '问题' : 'Question'}</label>
                              <textarea
                                className="follow-up-textarea follow-up-textarea--question"
                                value={editFollowUpQuestion}
                                onChange={(event) => setEditFollowUpQuestion(event.target.value)}
                                rows={3}
                              />
                              <label className="follow-up-question-label">{isZh ? '回答' : 'Answer'}</label>
                              <textarea
                                className="follow-up-textarea"
                                value={editFollowUpAnswer}
                                onChange={(event) => setEditFollowUpAnswer(event.target.value)}
                                rows={8}
                              />
                              <div className="button-row">
                                <button type="button" onClick={handleSaveFollowUp} disabled={isSavingFollowUp}>
                                  {isSavingFollowUp ? (isZh ? '保存中...' : 'Saving...') : (isZh ? '保存追问' : 'Save follow-up')}
                                </button>
                                <button type="button" className="secondary" onClick={handleCancelEditFollowUp}>
                                  {isZh ? '取消' : 'Cancel'}
                                </button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <p className="follow-up-question">{followUp.question}</p>
                              <div
                                className="follow-up-answer"
                                dangerouslySetInnerHTML={{ __html: renderExplanationMarkdown(followUp.answer) }}
                              />
                            </>
                          )}
                        </article>
                      )
                    })}
                    {isFollowUpLoading && (
                      <article className="follow-up-item follow-up-item--pending">
                        <div className="follow-up-item-top">
                          <span className="follow-up-item-index">
                            {isZh ? '正在追问' : 'Follow-up pending'}
                          </span>
                        </div>
                        <div className="follow-up-pending">
                          <div className="spinner" />
                          <p>{isZh ? '正在生成本次追问回复...' : 'Generating the follow-up reply...'}</p>
                        </div>
                      </article>
                    )}
                  </div>
                ) : (
                  <p className="follow-up-empty">
                    {isZh
                      ? '追问模式已开启。下方输入框会作为追问输入框使用，发送后会继续追加到这里。'
                      : 'Follow-up mode is active. The input below now works as a follow-up composer and new entries will appear here.'}
                  </p>
                )}
              </section>
            )}

            {(notes.length > 0 || isNoteMode) && (
              <section className={`note-card${isNoteMode ? ' note-card--active' : ''}`}>
                <div className="follow-up-card-header">
                  <span>
                    {isZh
                      ? `当前页笔记 ${notes.length > 0 ? `· ${notes.length} 条` : ''}`
                      : `Current notes${notes.length > 0 ? ` · ${notes.length}` : ''}`}
                  </span>
                  {isNoteMode && (
                    <span className="follow-up-card-badge">{isZh ? '笔记模式' : 'Note mode'}</span>
                  )}
                </div>
                {isNoteMode && (
                  <div
                    className={`note-compose-surface${isCreatingNote ? ' note-compose-surface--editing' : ''}`}
                    onClick={() => {
                      if (!isCreatingNote) {
                        setIsCreatingNote(true)
                      }
                    }}
                  >
                    {isCreatingNote ? (
                      <>
                        <textarea
                          className="follow-up-textarea note-compose-textarea"
                          value={newNoteContent}
                          onChange={(event) => setNewNoteContent(event.target.value)}
                          rows={8}
                          autoFocus
                          placeholder={isZh ? '在这里记录这一页的理解、疑问或待回看内容' : 'Write your page note here'}
                        />
                        <div className="button-row">
                          <button type="button" onClick={() => void handleCreateNote()} disabled={isCreatingNoteSaving || !newNoteContent.trim()}>
                            {isCreatingNoteSaving ? (isZh ? '保存中...' : 'Saving...') : (isZh ? '保存笔记' : 'Save note')}
                          </button>
                          <button
                            type="button"
                            className="secondary"
                            onClick={() => {
                              setIsCreatingNote(false)
                              setNewNoteContent('')
                            }}
                            disabled={isCreatingNoteSaving}
                          >
                            {isZh ? '取消' : 'Cancel'}
                          </button>
                        </div>
                      </>
                    ) : (
                      <p className="note-compose-placeholder">
                        {isZh ? '点击这块空白区域，直接开始记录本页笔记。' : 'Click this blank area to start writing a note for this page.'}
                      </p>
                    )}
                  </div>
                )}
                {notes.length > 0 ? (
                  <div className="note-list">
                    {notes.map((note, index) => {
                      const isEditingCurrentNote = editingNoteId === note.id
                      return (
                        <article
                          key={note.id}
                          ref={(node) => {
                            noteRefs.current[note.id] = node
                          }}
                          className="note-item"
                          onContextMenu={(event) => handleOpenContextMenu(event, 'note', note.id)}
                        >
                          <div className="follow-up-item-top">
                            <span className="follow-up-item-index">
                              {isZh ? `笔记 ${index + 1}` : `Note ${index + 1}`}
                            </span>
                            <span className="follow-up-item-hint">
                              {isZh ? '右键可编辑、删除或生成超链接' : 'Right click to edit, delete, or create a hyperlink'}
                            </span>
                          </div>
                          {isEditingCurrentNote ? (
                            <div className="follow-up-editor">
                              <label className="follow-up-question-label">{isZh ? '内容' : 'Content'}</label>
                              <textarea
                                className="follow-up-textarea"
                                value={editNoteContent}
                                onChange={(event) => setEditNoteContent(event.target.value)}
                                rows={7}
                              />
                              <div className="button-row">
                                <button type="button" onClick={handleSaveNote} disabled={isSavingNote}>
                                  {isSavingNote ? (isZh ? '保存中...' : 'Saving...') : (isZh ? '保存笔记' : 'Save note')}
                                </button>
                                <button type="button" className="secondary" onClick={handleCancelEditNote}>
                                  {isZh ? '取消' : 'Cancel'}
                                </button>
                              </div>
                            </div>
                          ) : (
                            <p className="note-item-content">{note.content}</p>
                          )}
                        </article>
                      )
                    })}
                  </div>
                ) : (
                  <p className="follow-up-empty">
                    {isZh
                      ? '当前页还没有笔记。'
                      : 'No notes for this page yet.'}
                  </p>
                )}
              </section>
            )}
          </div>
        </div>
      </div>

      <div className="explanation-footer">
        <div className="explanation-footer-left">
          {saveMsg && <span className="save-msg">{saveMsg}</span>}
        </div>
        {!isEditing && !shouldShowMainLoading && (
          <div className="explanation-footer-actions">
            {explanation && (
              <button type="button" className="edit-btn" onClick={handleStartEdit} disabled={isLoading}>
                {isZh ? '编辑讲解' : 'Edit'}
              </button>
            )}
            <button type="button" className={`edit-btn${isFollowUpMode ? ' edit-btn--active' : ''}`} onClick={onToggleFollowUpMode} disabled={isLoading}>
              {isFollowUpMode ? (isZh ? '结束追问' : 'Close follow-up') : (isZh ? '追问' : 'Follow-up')}
            </button>
            <button type="button" className={`edit-btn${isNoteMode ? ' edit-btn--active' : ''}`} onClick={onToggleNoteMode}>
              {isNoteMode ? (isZh ? '结束笔记' : 'Close notes') : (isZh ? '笔记' : 'Notes')}
            </button>
          </div>
        )}
      </div>

      {contextMenu && (
        <div className="follow-up-context-menu" style={menuStyle}>
          {contextMenu.kind === 'followup' && (
            <>
              <button type="button" onClick={() => handleStartEditFollowUp(contextMenu.id)}>
                {isZh ? '编辑追问' : 'Edit follow-up'}
              </button>
              <button type="button" onClick={() => void handleCreateHyperlinkForTarget('followup', contextMenu.id)}>
                {isZh ? '生成超链接' : 'Create hyperlink'}
              </button>
              <button type="button" className="follow-up-context-menu__danger" onClick={() => void handleDeleteFollowUp(contextMenu.id)}>
                {isZh ? '删除追问' : 'Delete follow-up'}
              </button>
            </>
          )}
          {contextMenu.kind === 'note' && (
            <>
              <button type="button" onClick={() => handleStartEditNote(contextMenu.id)}>
                {isZh ? '编辑笔记' : 'Edit note'}
              </button>
              <button type="button" onClick={() => void handleCreateHyperlinkForTarget('note', contextMenu.id)}>
                {isZh ? '生成超链接' : 'Create hyperlink'}
              </button>
              <button type="button" className="follow-up-context-menu__danger" onClick={() => void handleDeleteNote(contextMenu.id)}>
                {isZh ? '删除笔记' : 'Delete note'}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
