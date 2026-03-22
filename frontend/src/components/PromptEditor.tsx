import { useEffect, useState } from 'react'
import type { PromptConfig } from '../lib/api'
import { getPromptConfig, resetPromptConfig, updatePromptConfig } from '../lib/api'

type Props = {
  locale: 'zh' | 'en'
  onClose: () => void
}

export default function PromptEditor({ locale, onClose }: Props) {
  const [config, setConfig] = useState<PromptConfig | null>(null)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const isZh = locale === 'zh'

  useEffect(() => {
    void getPromptConfig().then(setConfig).catch((e) => setError(e instanceof Error ? e.message : 'Failed'))
  }, [])

  const handleSave = async () => {
    if (!config) return
    try {
      const updated = await updatePromptConfig(config)
      setConfig(updated)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    }
  }

  const handleReset = async () => {
    try {
      const defaultConfig = await resetPromptConfig()
      setConfig(defaultConfig)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Reset failed')
    }
  }

  if (!config) return null

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content modal-content--wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{isZh ? '提示词编辑' : 'Prompt Editor'}</h2>
          <button type="button" className="modal-close" onClick={onClose}>×</button>
        </div>

        {error && <div className="error-block"><p>{error}</p></div>}
        {saved && <div className="success-hint">{isZh ? '已保存' : 'Saved'}</div>}

        <div className="field-group">
          <label>{isZh ? '系统提示词 (System Prompt)' : 'System Prompt'}</label>
          <textarea
            rows={6}
            value={config.system_prompt}
            onChange={(e) => setConfig({ ...config, system_prompt: e.target.value })}
          />
        </div>

        <div className="field-group">
          <label>{isZh ? '用户提示词模板 (User Prompt Template)' : 'User Prompt Template'}</label>
          <textarea
            rows={3}
            value={config.user_prompt_template}
            onChange={(e) => setConfig({ ...config, user_prompt_template: e.target.value })}
          />
        </div>

        <div className="button-row">
          <button type="button" onClick={handleSave}>{isZh ? '保存' : 'Save'}</button>
          <button type="button" className="secondary" onClick={handleReset}>{isZh ? '恢复默认' : 'Reset'}</button>
        </div>
      </div>
    </div>
  )
}
