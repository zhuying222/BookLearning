import { useState } from 'react'
import type { TaskStatus } from '../lib/api'
import { cancelTask, pauseTask, resumeTask } from '../lib/api'

type Props = {
  locale: 'zh' | 'en'
  disabled: boolean
  activeTask: TaskStatus | null
  selectedBatchCount: number
  rangeInput: string
  onRangeInputChange: (value: string) => void
  onParseRange: (pages: string, force: boolean) => void
  pagePrompt: string
  onPagePromptChange: (value: string) => void
  configuredPromptCount: number
  onTaskUpdate: (task: TaskStatus | null) => void
  batchPreparationStatus: string
  isFollowUpMode: boolean
}

export default function ParseControls({
  locale,
  disabled,
  activeTask,
  selectedBatchCount,
  rangeInput,
  onRangeInputChange,
  onParseRange,
  pagePrompt,
  onPagePromptChange,
  configuredPromptCount,
  onTaskUpdate,
  batchPreparationStatus,
  isFollowUpMode,
}: Props) {
  const [forceReparse, setForceReparse] = useState(false)
  const isZh = locale === 'zh'
  const isTaskRunning = activeTask && (
    activeTask.status === 'pending'
    || activeTask.status === 'running'
    || activeTask.status === 'paused'
  )

  const handlePause = async () => {
    if (!activeTask) return
    try {
      await pauseTask(activeTask.task_id)
      onTaskUpdate({ ...activeTask, status: 'paused' })
    } catch { /* ignore */ }
  }

  const handleResume = async () => {
    if (!activeTask) return
    try {
      await resumeTask(activeTask.task_id)
      onTaskUpdate({ ...activeTask, status: 'running' })
    } catch { /* ignore */ }
  }

  const handleCancel = async () => {
    if (!activeTask) return
    try {
      await cancelTask(activeTask.task_id)
      onTaskUpdate({ ...activeTask, status: 'cancelled' })
    } catch { /* ignore */ }
  }

  return (
    <div className="parse-controls">
      <section className="control-card">
        <div className="control-card-heading">
          <div>
            <span className="control-card-kicker">{isFollowUpMode ? 'Follow-up' : 'Page Prompt'}</span>
            <h4>{isFollowUpMode ? (isZh ? '当前页追问输入' : 'Current follow-up input') : (isZh ? '当前页补充说明' : 'Current page note')}</h4>
          </div>
        </div>
        {isFollowUpMode ? (
          <textarea
            className="ctrl-input ctrl-textarea"
            value={pagePrompt}
            onChange={(e) => onPagePromptChange(e.target.value)}
            placeholder={isZh ? '输入你对当前页的追问' : 'Ask a follow-up about the current page'}
            rows={4}
          />
        ) : (
          <input
            className="ctrl-input ctrl-input--wide"
            type="text"
            value={pagePrompt}
            onChange={(e) => onPagePromptChange(e.target.value)}
            placeholder={isZh ? '当前页提示词（可选），如“重点讲解公式”' : 'Prompt for the current page (optional)'}
          />
        )}
        <div className="control-hint">
          <span>
            {isFollowUpMode
              ? (isZh
                ? '会带上当前讲解与页图一起发送，不会覆盖主讲解。'
                : 'Sent with the current explanation and page image without replacing the main explanation.')
              : (isZh
                ? `仅当前页使用，已设置 ${configuredPromptCount} 页提示词。`
                : `Only used for the current page. Configured prompts: ${configuredPromptCount}.`)}
          </span>
        </div>
      </section>

      <section className="control-card">
        <div className="control-card-heading">
          <div>
            <span className="control-card-kicker">Batch Run</span>
            <h4>{isZh ? '批量解析队列' : 'Batch parse queue'}</h4>
          </div>
          <span className="control-card-badge">
            {isZh ? `${selectedBatchCount} 页` : `${selectedBatchCount} pages`}
          </span>
          <label className="ctrl-check ctrl-check--pill">
            <input type="checkbox" checked={forceReparse} onChange={(e) => setForceReparse(e.target.checked)} />
            {isZh ? '强制重跑' : 'Force rerun'}
          </label>
        </div>

        <div className="control-inline-fields">
          <label className="ctrl-field">
            <span className="ctrl-field-label">{isZh ? '页码范围' : 'Pages'}</span>
            <input
              className="ctrl-input"
              type="text"
              value={rangeInput}
              onChange={(e) => onRangeInputChange(e.target.value)}
              placeholder="1-5, 8, 10-12"
            />
          </label>
          <button
            type="button"
            className="ctrl-btn ctrl-btn--primary ctrl-btn--block-mobile"
            disabled={disabled || !rangeInput.trim() || !!isTaskRunning}
            onClick={() => onParseRange(rangeInput, forceReparse)}
          >
            {isZh ? '开始批量解析' : 'Start batch parse'}
          </button>
        </div>

        {batchPreparationStatus && (
          <div className="control-banner control-banner--neutral">
            <span>{batchPreparationStatus}</span>
          </div>
        )}
      </section>

      {activeTask && (
        <section className="control-card control-card--task control-card--full">
          <div className="task-bar">
            <div className="task-bar-header">
              <span>
                {activeTask.status}
                {typeof activeTask.current_page === 'number' && ` · ${isZh ? '当前页' : 'Page'} ${activeTask.current_page}`}
              </span>
              <span>{activeTask.completed_pages}/{activeTask.total_pages}</span>
            </div>
            <div className="progress-bar">
              <div
                className="progress-bar-fill"
                style={{ width: `${activeTask.total_pages > 0 ? (activeTask.completed_pages / activeTask.total_pages) * 100 : 0}%` }}
              />
            </div>
            {activeTask.error && <p className="ctrl-error-text">{activeTask.error}</p>}
            <div className="control-action-row">
              {activeTask.status === 'running' && (
                <button type="button" className="ctrl-btn ctrl-btn--soft" onClick={handlePause}>{isZh ? '暂停任务' : 'Pause task'}</button>
              )}
              {activeTask.status === 'paused' && (
                <button type="button" className="ctrl-btn ctrl-btn--primary" onClick={handleResume}>{isZh ? '继续任务' : 'Resume task'}</button>
              )}
              {isTaskRunning && (
                <button type="button" className="ctrl-btn ctrl-btn--danger" onClick={handleCancel}>{isZh ? '取消任务' : 'Cancel task'}</button>
              )}
            </div>
          </div>
        </section>
      )}
    </div>
  )
}
