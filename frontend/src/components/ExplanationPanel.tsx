import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import 'katex/dist/katex.min.css'
import { saveEditedExplanation } from '../lib/api'
import { renderExplanationMarkdown } from '../lib/renderMarkdown'

const MIN_AI_FONT_SIZE = 13
const MAX_AI_FONT_SIZE = 24
const DEFAULT_AI_FONT_SIZE = 15

type Props = {
  locale: 'zh' | 'en'
  currentPage: number
  explanations: Record<number, string>
  isLoading: boolean
  pageCount: number
  pdfHash: string
  onExplanationUpdate: (page: number, text: string) => void
}

export default function ExplanationPanel({
  locale,
  currentPage,
  explanations,
  isLoading,
  pageCount,
  pdfHash,
  onExplanationUpdate,
}: Props) {
  const isZh = locale === 'zh'
  const explanation = explanations[currentPage]
  const [isEditing, setIsEditing] = useState(false)
  const [editText, setEditText] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')
  const [fontSize, setFontSize] = useState(DEFAULT_AI_FONT_SIZE)
  const renderedExplanation = useMemo(
    () => renderExplanationMarkdown(explanation || ''),
    [explanation],
  )
  const panelStyle = useMemo(
    () => ({ '--ai-font-size': `${fontSize}px` } as CSSProperties),
    [fontSize],
  )

  // 切换页面时退出编辑模式
  useEffect(() => {
    setIsEditing(false)
    setSaveMsg('')
  }, [currentPage])

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

  const handleSave = useCallback(async () => {
    if (!pdfHash || !editText.trim()) return
    setIsSaving(true)
    setSaveMsg('')
    try {
      await saveEditedExplanation(pdfHash, currentPage, editText)
      onExplanationUpdate(currentPage, editText)
      setIsEditing(false)
      setSaveMsg(isZh ? '已保存' : 'Saved')
      setTimeout(() => setSaveMsg(''), 2000)
    } catch {
      setSaveMsg(isZh ? '保存失败' : 'Save failed')
    } finally {
      setIsSaving(false)
    }
  }, [pdfHash, currentPage, editText, isZh, onExplanationUpdate])

  // 计算已解析页数
  const parsedCount = Object.keys(explanations).length

  // 当前页状态标签
  const pageStatus = isLoading
    ? (isZh ? '解析中...' : 'Parsing...')
    : explanation
      ? (isZh ? '已解析' : 'Parsed')
      : (isZh ? '未解析' : 'Not parsed')

  const statusClass = isLoading
    ? 'page-status--loading'
    : explanation
      ? 'page-status--parsed'
      : 'page-status--empty'

  return (
    <div className="explanation-panel" style={panelStyle}>
      <div className="explanation-header">
        <h3>{isZh ? 'AI 讲解' : 'AI Explanation'}</h3>
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
          <span className="explanation-page-info">
            {isZh ? `第 ${currentPage} / ${pageCount} 页` : `Page ${currentPage} / ${pageCount}`}
          </span>
        </div>
      </div>

      <div className="explanation-body">
        {isLoading ? (
          <div className="explanation-loading">
            <div className="spinner" />
            <p>{isZh ? '正在解析当前页...' : 'Parsing current page...'}</p>
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
              <button type="button" onClick={handleSave} disabled={isSaving}>
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
                ? '当前页尚未解析。点击下方"解析当前页"按钮开始 AI 讲解。'
                : 'This page has not been parsed yet. Click "Parse current page" below to start.'}
            </p>
          </div>
        )}
      </div>

      <div className="explanation-footer">
        <div className="explanation-footer-left">
          {parsedCount > 0 && (
            <span className="explanation-stats">
              {isZh
                ? `已解析 ${parsedCount} / ${pageCount} 页`
                : `Parsed ${parsedCount} / ${pageCount} pages`}
            </span>
          )}
          {saveMsg && <span className="save-msg">{saveMsg}</span>}
        </div>
        {explanation && !isEditing && !isLoading && (
          <button type="button" className="edit-btn" onClick={handleStartEdit}>
            {isZh ? '编辑讲解' : 'Edit'}
          </button>
        )}
      </div>
    </div>
  )
}
