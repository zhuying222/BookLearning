import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CSSProperties, MouseEvent as ReactMouseEvent } from 'react'
import 'katex/dist/katex.min.css'
import type { FollowUpRecord } from '../lib/api'
import { deleteFollowUp, saveEditedExplanation, updateFollowUp } from '../lib/api'
import { renderExplanationMarkdown } from '../lib/renderMarkdown'

const MIN_AI_FONT_SIZE = 13
const MAX_AI_FONT_SIZE = 24
const DEFAULT_AI_FONT_SIZE = 15

type Props = {
  locale: 'zh' | 'en'
  currentPage: number
  explanations: Record<number, string>
  followUps: FollowUpRecord[]
  isFollowUpMode: boolean
  isLoading: boolean
  pageCount: number
  pdfHash: string
  onExplanationUpdate: (page: number, text: string) => void
  onFollowUpsUpdate: (page: number, items: FollowUpRecord[]) => void
  onToggleFollowUpMode: () => void
}

type FollowUpMenuState = {
  followUpId: string
  x: number
  y: number
} | null

export default function ExplanationPanel({
  locale,
  currentPage,
  explanations,
  followUps,
  isFollowUpMode,
  isLoading,
  pageCount,
  pdfHash,
  onExplanationUpdate,
  onFollowUpsUpdate,
  onToggleFollowUpMode,
}: Props) {
  const isZh = locale === 'zh'
  const explanation = explanations[currentPage]
  const [isEditing, setIsEditing] = useState(false)
  const [editText, setEditText] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')
  const [fontSize, setFontSize] = useState(DEFAULT_AI_FONT_SIZE)
  const [editingFollowUpId, setEditingFollowUpId] = useState<string | null>(null)
  const [editFollowUpQuestion, setEditFollowUpQuestion] = useState('')
  const [editFollowUpAnswer, setEditFollowUpAnswer] = useState('')
  const [isSavingFollowUp, setIsSavingFollowUp] = useState(false)
  const [followUpMenu, setFollowUpMenu] = useState<FollowUpMenuState>(null)
  const renderedExplanation = useMemo(
    () => renderExplanationMarkdown(explanation || ''),
    [explanation],
  )
  const panelStyle = useMemo(
    () => ({ '--ai-font-size': `${fontSize}px` } as CSSProperties),
    [fontSize],
  )

  useEffect(() => {
    setIsEditing(false)
    setSaveMsg('')
    setEditingFollowUpId(null)
    setFollowUpMenu(null)
  }, [currentPage])

  useEffect(() => {
    if (!followUpMenu) return
    const closeMenu = () => setFollowUpMenu(null)
    window.addEventListener('click', closeMenu)
    window.addEventListener('scroll', closeMenu, true)
    return () => {
      window.removeEventListener('click', closeMenu)
      window.removeEventListener('scroll', closeMenu, true)
    }
  }, [followUpMenu])

  useEffect(() => {
    if (!editingFollowUpId) return
    if (!followUps.some((item) => item.id === editingFollowUpId)) {
      setEditingFollowUpId(null)
    }
  }, [editingFollowUpId, followUps])

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
      setSaveMsg(isZh ? '讲解已保存' : 'Explanation saved')
      setTimeout(() => setSaveMsg(''), 2000)
    } catch {
      setSaveMsg(isZh ? '讲解保存失败' : 'Failed to save explanation')
    } finally {
      setIsSaving(false)
    }
  }, [pdfHash, currentPage, editText, isZh, onExplanationUpdate])

  const handleOpenFollowUpMenu = useCallback((event: ReactMouseEvent, followUpId: string) => {
    event.preventDefault()
    setFollowUpMenu({
      followUpId,
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
    setFollowUpMenu(null)
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
      setSaveMsg(isZh ? '追问已保存' : 'Follow-up saved')
      setTimeout(() => setSaveMsg(''), 2000)
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
    followUps,
    isZh,
    onFollowUpsUpdate,
    pdfHash,
  ])

  const handleDeleteFollowUp = useCallback(async (followUpId: string) => {
    if (!pdfHash) return
    setFollowUpMenu(null)
    try {
      await deleteFollowUp(pdfHash, currentPage, followUpId)
      const nextItems = followUps.filter((item) => item.id !== followUpId)
      onFollowUpsUpdate(currentPage, nextItems)
      if (editingFollowUpId === followUpId) {
        setEditingFollowUpId(null)
      }
      setSaveMsg(isZh ? '追问已删除' : 'Follow-up deleted')
      setTimeout(() => setSaveMsg(''), 2000)
    } catch {
      setSaveMsg(isZh ? '删除追问失败' : 'Failed to delete follow-up')
    }
  }, [currentPage, editingFollowUpId, followUps, isZh, onFollowUpsUpdate, pdfHash])

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

  const menuStyle = followUpMenu
    ? {
        left: Math.max(12, Math.min(followUpMenu.x, window.innerWidth - 176)),
        top: Math.max(12, Math.min(followUpMenu.y, window.innerHeight - 120)),
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

      <div className="explanation-body">
        {isLoading ? (
          <div className="explanation-loading">
            <div className="spinner" />
            <p>{isZh ? '正在处理当前页...' : 'Processing current page...'}</p>
          </div>
        ) : isEditing ? (
          <div className="explanation-editor">
            <textarea
              className="explanation-textarea"
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
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
          <div className="explanation-stack">
            <div
              className="explanation-content"
              dangerouslySetInnerHTML={{ __html: renderedExplanation }}
            />
            {(followUps.length > 0 || isFollowUpMode) && (
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
                {followUps.length > 0 ? (
                  <div className="follow-up-list">
                    {followUps.map((followUp, index) => {
                      const isEditingFollowUp = editingFollowUpId === followUp.id
                      return (
                        <article
                          key={followUp.id}
                          className="follow-up-item"
                          onContextMenu={(event) => handleOpenFollowUpMenu(event, followUp.id)}
                        >
                          <div className="follow-up-item-top">
                            <span className="follow-up-item-index">
                              {isZh ? `追问 ${index + 1}` : `Follow-up ${index + 1}`}
                            </span>
                            <span className="follow-up-item-hint">
                              {isZh ? '右键可编辑或删除' : 'Right click to edit or delete'}
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
          </div>
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
      </div>

      <div className="explanation-footer">
        <div className="explanation-footer-left">
          {saveMsg && <span className="save-msg">{saveMsg}</span>}
        </div>
        {explanation && !isEditing && !isLoading && (
          <div className="explanation-footer-actions">
            <button type="button" className="edit-btn" onClick={handleStartEdit}>
              {isZh ? '编辑讲解' : 'Edit'}
            </button>
            <button type="button" className={`edit-btn${isFollowUpMode ? ' edit-btn--active' : ''}`} onClick={onToggleFollowUpMode}>
              {isFollowUpMode ? (isZh ? '结束追问' : 'Close follow-up') : (isZh ? '追问' : 'Follow-up')}
            </button>
          </div>
        )}
      </div>

      {followUpMenu && (
        <div className="follow-up-context-menu" style={menuStyle}>
          <button type="button" onClick={() => handleStartEditFollowUp(followUpMenu.followUpId)}>
            {isZh ? '编辑追问' : 'Edit follow-up'}
          </button>
          <button type="button" className="follow-up-context-menu__danger" onClick={() => void handleDeleteFollowUp(followUpMenu.followUpId)}>
            {isZh ? '删除追问' : 'Delete follow-up'}
          </button>
        </div>
      )}
    </div>
  )
}
