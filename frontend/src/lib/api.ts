const API_BASE = 'http://localhost:8000/api/v1'

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`API ${response.status}: ${body}`)
  }
  return response.json()
}

// AI Config
export type AiConfig = {
  id: string
  name: string
  base_url: string
  api_key: string
  model_name: string
  max_tokens: number
  temperature: number
  is_default: boolean
}

export type AiConfigCreate = Omit<AiConfig, 'id'>

export function listAiConfigs() {
  return request<AiConfig[]>('/ai-configs/')
}

export function createAiConfig(data: AiConfigCreate) {
  return request<AiConfig>('/ai-configs/', { method: 'POST', body: JSON.stringify(data) })
}

export function updateAiConfig(id: string, data: Partial<AiConfigCreate>) {
  return request<AiConfig>(`/ai-configs/${id}`, { method: 'PUT', body: JSON.stringify(data) })
}

export function deleteAiConfig(id: string) {
  return request<{ ok: boolean }>(`/ai-configs/${id}`, { method: 'DELETE' })
}

// Prompts
export type PromptConfig = {
  system_prompt: string
  user_prompt_template: string
}

export function getPromptConfig() {
  return request<PromptConfig>('/prompts/')
}

export function updatePromptConfig(data: Partial<PromptConfig>) {
  return request<PromptConfig>('/prompts/', { method: 'PUT', body: JSON.stringify(data) })
}

export function resetPromptConfig() {
  return request<PromptConfig>('/prompts/reset', { method: 'POST' })
}

// Parse
export type ParsePageResponse = {
  pdf_hash: string
  page_number: number
  explanation: string
  model_name: string
  cached: boolean
}

export type TaskStatus = {
  task_id: string
  status: string
  total_pages: number
  completed_pages: number
  current_page: number | null
  results: Record<number, string>
  error: string | null
}

export function parseSinglePage(data: {
  pdf_hash: string
  page_number: number
  image_base64: string
  config_id?: string
  page_prompt?: string
  force?: boolean
}) {
  return request<ParsePageResponse>('/parse/page', { method: 'POST', body: JSON.stringify(data) })
}

export function parseRange(data: {
  pdf_hash: string
  pages: number[]
  images_base64: Record<number, string>
  config_id?: string
  page_prompts?: Record<number, string>
  force?: boolean
}) {
  return request<TaskStatus>('/parse/range', { method: 'POST', body: JSON.stringify(data) })
}

export function getTaskStatus(taskId: string) {
  return request<TaskStatus>(`/parse/task/${taskId}`)
}

export function pauseTask(taskId: string) {
  return request<{ ok: boolean; status: string }>(`/parse/task/${taskId}/pause`, { method: 'POST' })
}

export function resumeTask(taskId: string) {
  return request<{ ok: boolean; status: string }>(`/parse/task/${taskId}/resume`, { method: 'POST' })
}

export function cancelTask(taskId: string) {
  return request<{ ok: boolean; status: string }>(`/parse/task/${taskId}/cancel`, { method: 'POST' })
}

// Cache / Edit
export function saveEditedExplanation(pdfHash: string, pageNumber: number, explanation: string) {
  return request<{ ok: boolean }>(`/parse/cache/${pdfHash}/${pageNumber}`, {
    method: 'PUT',
    body: JSON.stringify({ explanation }),
  })
}

export function loadAllCachedExplanations(pdfHash: string) {
  return request<{ pdf_hash: string; pages: Record<number, string> }>(`/parse/cache/${pdfHash}`)
}
