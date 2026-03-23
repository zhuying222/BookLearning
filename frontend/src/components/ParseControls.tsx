import { useState } from 'react'
import type { TaskStatus } from '../lib/api'
import { cancelTask, pauseTask, resumeTask } from '../lib/api'

type Props = {
  locale: 'zh' | 'en'
  disabled: boolean
  activeTask: TaskStatus | null
  currentPage: number
  rangeInput: string
  onRangeInputChange: (value: string) => void
  onParseRange: (pages: string, force: boolean) => void
  pagePrompt: string
  onPagePromptChange: (value: string) => void
  configuredPromptCount: number
  onTaskUpdate: (task: TaskStatus | null) => void
  batchPreparationStatus: string
}

export default function ParseControls({
  locale,
  disabled,
  activeTask,
  currentPage,
  rangeInput,
  onRangeInputChange,
  onParseRange,
  pagePrompt,
  onPagePromptChange,
  configuredPromptCount,
  onTaskUpdate,
  batchPreparationStatus,
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
      {/* 页级附加提示词 */}
      <div className="ctrl-row">
        <input
          className="ctrl-input ctrl-input--wide"
          type="text"
          value={pagePrompt}
          onChange={(e) => onPagePromptChange(e.target.value)}
          placeholder={isZh ? `第 ${currentPage} 页提示词（可选），如“重点讲解公式”` : `Prompt for page ${currentPage} (optional)`}
        />
      </div>
      <div className="ctrl-status">
        <span>
          {isZh
            ? `当前输入仅对应第 ${currentPage} 页。批量解析时会按页分别使用已设置的提示词，已设置 ${configuredPromptCount} 页。`
            : `This input only applies to page ${currentPage}. Batch parsing uses saved prompts page by page. Configured pages: ${configuredPromptCount}.`}
        </span>
      </div>

      {/* 批量解析 */}
      <div className="ctrl-row">
        <label className="ctrl-label">{isZh ? '批量' : 'Batch'}</label>
        <input
          className="ctrl-input"
          type="text"
          value={rangeInput}
          onChange={(e) => onRangeInputChange(e.target.value)}
          placeholder="1-5, 8, 10-12"
        />
        <button
          type="button"
          className="ctrl-btn"
          disabled={disabled || !rangeInput.trim() || !!isTaskRunning}
          onClick={() => onParseRange(rangeInput, forceReparse)}
        >
          {isZh ? '开始' : 'Start'}
        </button>
        <label className="ctrl-check">
          <input type="checkbox" checked={forceReparse} onChange={(e) => setForceReparse(e.target.checked)} />
          {isZh ? '重跑' : 'Force'}
        </label>
      </div>

      {batchPreparationStatus && (
        <div className="ctrl-status">
          <span>{batchPreparationStatus}</span>
        </div>
      )}

      {/* 任务进度 */}
      {activeTask && (
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
          <div className="ctrl-row">
            {activeTask.status === 'running' && (
              <button type="button" className="ctrl-btn" onClick={handlePause}>{isZh ? '暂停' : 'Pause'}</button>
            )}
            {activeTask.status === 'paused' && (
              <button type="button" className="ctrl-btn" onClick={handleResume}>{isZh ? '继续' : 'Resume'}</button>
            )}
            {isTaskRunning && (
              <button type="button" className="ctrl-btn ctrl-btn--danger" onClick={handleCancel}>{isZh ? '取消' : 'Cancel'}</button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
