const API_BASE = 'http://localhost:8000/api/v1'

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const headers = new Headers(options?.headers ?? {})
  if (!(options?.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  const response = await fetch(`${API_BASE}${path}`, {
    headers,
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
  cost_info: ParseCostInfo | null
}

export type ParseCostInfo = {
  input_tokens: number | null
  output_tokens: number | null
  total_tokens: number | null
  cost_amount: number | null
  cost_unit: string | null
  cost_display: string | null
}

export type TaskStatus = {
  task_id: string
  status: string
  total_pages: number
  completed_pages: number
  current_page: number | null
  results: Record<number, string>
  page_costs: Record<number, ParseCostInfo>
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
  return request<{ pdf_hash: string; pages: Record<number, string>; page_costs: Record<number, ParseCostInfo> }>(`/parse/cache/${pdfHash}`)
}

// Documents
export type LibraryDocument = {
  id: string
  pdf_hash: string
  title: string
  original_file_name: string
  storage_file_name: string
  file_size_bytes: number
  page_count: number | null
  imported_at: string
  updated_at: string
  last_opened_at: string | null
  last_read_page: number
  cached_pages: number
}

export type DocumentImportResponse = {
  created: boolean
  document: LibraryDocument
}

export function listDocuments() {
  return request<LibraryDocument[]>('/documents/')
}

export function importDocument(file: File) {
  const body = new FormData()
  body.append('file', file)
  return request<DocumentImportResponse>('/documents/import', {
    method: 'POST',
    body,
  })
}

export function deleteDocument(documentId: string, removeCache = true) {
  return request<{ ok: boolean; document_id: string; remove_cache: boolean }>(
    `/documents/${documentId}?remove_cache=${removeCache ? 'true' : 'false'}`,
    { method: 'DELETE' },
  )
}

export function updateDocumentProgress(documentId: string, lastReadPage: number) {
  return request<LibraryDocument>(`/documents/${documentId}/progress`, {
    method: 'PATCH',
    body: JSON.stringify({ last_read_page: lastReadPage }),
  })
}

export async function downloadDocumentPdf(documentId: string): Promise<Uint8Array> {
  const response = await fetch(`${API_BASE}/documents/${documentId}/file`)
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`API ${response.status}: ${body}`)
  }
  return new Uint8Array(await response.arrayBuffer())
}
