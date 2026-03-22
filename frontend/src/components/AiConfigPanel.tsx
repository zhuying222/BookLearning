import { useEffect, useState } from 'react'
import type { AiConfig, AiConfigCreate } from '../lib/api'
import { createAiConfig, deleteAiConfig, listAiConfigs, updateAiConfig } from '../lib/api'

type Props = {
  locale: 'zh' | 'en'
  onClose: () => void
}

const EMPTY_FORM: AiConfigCreate = {
  name: '',
  base_url: '',
  api_key: '',
  model_name: '',
  max_tokens: 4096,
  temperature: 0.7,
  is_default: false,
}

export default function AiConfigPanel({ locale, onClose }: Props) {
  const [configs, setConfigs] = useState<AiConfig[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<AiConfigCreate>({ ...EMPTY_FORM })
  const [error, setError] = useState('')
  const isZh = locale === 'zh'

  const reload = async () => {
    try {
      setConfigs(await listAiConfigs())
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void reload()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [])

  const handleEdit = (config: AiConfig) => {
    setEditingId(config.id)
    setForm({
      name: config.name,
      base_url: config.base_url,
      api_key: config.api_key,
      model_name: config.model_name,
      max_tokens: config.max_tokens,
      temperature: config.temperature,
      is_default: config.is_default,
    })
  }

  const handleNew = () => {
    setEditingId('new')
    setForm({ ...EMPTY_FORM })
  }

  const handleSave = async () => {
    try {
      if (editingId === 'new') {
        await createAiConfig(form)
      } else if (editingId) {
        await updateAiConfig(editingId, form)
      }
      setEditingId(null)
      await reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await deleteAiConfig(id)
      await reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    }
  }

  const handleSetDefault = async (id: string) => {
    try {
      await updateAiConfig(id, { is_default: true })
      await reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed')
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{isZh ? 'AI 配置管理' : 'AI Config Manager'}</h2>
          <button type="button" className="modal-close" onClick={onClose}>×</button>
        </div>

        {error && <div className="error-block"><p>{error}</p></div>}

        {editingId ? (
          <div className="config-form">
            <div className="field-group">
              <label>{isZh ? '配置名称' : 'Name'}</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="field-group">
              <label>{isZh ? '请求地址 (Base URL)' : 'Base URL'}</label>
              <input value={form.base_url} onChange={(e) => setForm({ ...form, base_url: e.target.value })} placeholder="https://api.openai.com" />
            </div>
            <div className="field-group">
              <label>API Key</label>
              <input type="password" value={form.api_key} onChange={(e) => setForm({ ...form, api_key: e.target.value })} />
            </div>
            <div className="field-group">
              <label>{isZh ? '模型名称' : 'Model'}</label>
              <input value={form.model_name} onChange={(e) => setForm({ ...form, model_name: e.target.value })} placeholder="gpt-4o" />
            </div>
            <div className="field-group">
              <label>Max Tokens</label>
              <input type="number" value={form.max_tokens} onChange={(e) => setForm({ ...form, max_tokens: Number(e.target.value) })} />
            </div>
            <div className="field-group">
              <label>Temperature</label>
              <input type="number" step="0.1" min="0" max="2" value={form.temperature} onChange={(e) => setForm({ ...form, temperature: Number(e.target.value) })} />
            </div>
            <label className="checkbox-label">
              <input type="checkbox" checked={form.is_default} onChange={(e) => setForm({ ...form, is_default: e.target.checked })} />
              {isZh ? '设为默认' : 'Set as default'}
            </label>
            <div className="button-row">
              <button type="button" onClick={handleSave}>{isZh ? '保存' : 'Save'}</button>
              <button type="button" className="secondary" onClick={() => setEditingId(null)}>{isZh ? '取消' : 'Cancel'}</button>
            </div>
          </div>
        ) : (
          <>
            <div className="config-list">
              {configs.length === 0 && <p className="empty-hint">{isZh ? '暂无配置，请新增' : 'No configs yet'}</p>}
              {configs.map((c) => (
                <div key={c.id} className={`config-item${c.is_default ? ' config-item--default' : ''}`}>
                  <div className="config-item-info">
                    <strong>{c.name}</strong>
                    <span>{c.model_name}</span>
                    {c.is_default && <span className="badge">{isZh ? '默认' : 'Default'}</span>}
                  </div>
                  <div className="config-item-actions">
                    {!c.is_default && (
                      <button type="button" className="secondary" onClick={() => handleSetDefault(c.id)}>
                        {isZh ? '设为默认' : 'Default'}
                      </button>
                    )}
                    <button type="button" className="secondary" onClick={() => handleEdit(c)}>
                      {isZh ? '编辑' : 'Edit'}
                    </button>
                    <button type="button" className="secondary danger-btn" onClick={() => handleDelete(c.id)}>
                      {isZh ? '删除' : 'Delete'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="button-row">
              <button type="button" onClick={handleNew}>{isZh ? '新增配置' : 'Add Config'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
