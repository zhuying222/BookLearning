import { useCallback, useEffect, useState } from 'react'
import Markdown from 'react-markdown'
import type { ParseCostInfo } from '../lib/api'
import { saveEditedExplanation } from '../lib/api'

type Props = {
  locale: 'zh' | 'en'
  currentPage: number
  explanations: Record<number, string>
  pageCosts: Record<number, ParseCostInfo>
  documentUsageSummary: string
  isLoading: boolean
  pageCount: number
  pdfHash: string
  onExplanationUpdate: (page: number, text: string) => void
  documentCostSummary: string
}

export default function ExplanationPanel({
  locale,
  currentPage,
  explanations,
  pageCosts,
  documentUsageSummary,
  isLoading,
  pageCount,
  pdfHash,
  onExplanationUpdate,
  documentCostSummary,
}: Props) {
  const isZh = locale === 'zh'
  const explanation = explanations[currentPage]
  const [isEditing, setIsEditing] = useState(false)
  const [editText, setEditText] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')
  const currentCost = pageCosts[currentPage]

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
  const totalCostText = documentCostSummary || (isZh ? '暂无（接口未返回价格）' : 'N/A (no price returned)')
  const pageCostText = currentCost?.cost_display || (isZh ? '暂无（接口未返回价格）' : 'N/A (no price returned)')
  const totalUsageText = documentUsageSummary || (isZh ? '暂无' : 'N/A')
  const pageUsageText = formatUsageSummary(currentCost, locale)

  return (
    <div className="explanation-panel">
      <div className="explanation-header">
        <h3>{isZh ? 'AI 讲解' : 'AI Explanation'}</h3>
        <div className="explanation-header-right">
          <span className={`page-status ${statusClass}`}>{pageStatus}</span>
          <span className="explanation-page-info">
            {isZh ? `第 ${currentPage} / ${pageCount} 页` : `Page ${currentPage} / ${pageCount}`}
          </span>
        </div>
      </div>

      <div className="cost-strip">
        <span className="cost-chip">
          {isZh ? `本文档累计成本：${totalCostText}` : `Document total: ${totalCostText}`}
        </span>
        <span className="cost-chip">
          {isZh ? `当前页成本：${pageCostText}` : `Current page: ${pageCostText}`}
        </span>
        <span className="cost-chip">
          {isZh ? `本文档累计 Tokens：${totalUsageText}` : `Document tokens: ${totalUsageText}`}
        </span>
        <span className="cost-chip">
          {isZh ? `当前页 Tokens：${pageUsageText}` : `Current page tokens: ${pageUsageText}`}
        </span>
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
          <div className="explanation-content">
            <Markdown>{explanation}</Markdown>
          </div>
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

function formatUsageSummary(costInfo: ParseCostInfo | undefined, locale: 'zh' | 'en'): string {
  if (!costInfo) {
    return locale === 'zh' ? '暂无' : 'N/A'
  }

  const inputTokens = costInfo.input_tokens || 0
  const outputTokens = costInfo.output_tokens || 0
  const totalTokens = costInfo.total_tokens || 0
  if (!inputTokens && !outputTokens && !totalTokens) {
    return locale === 'zh' ? '暂无' : 'N/A'
  }

  return locale === 'zh'
    ? `输入 ${inputTokens} / 输出 ${outputTokens} / 总计 ${totalTokens}`
    : `in ${inputTokens} / out ${outputTokens} / total ${totalTokens}`
}
