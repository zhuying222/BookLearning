import katex from 'katex'
import MarkdownIt from 'markdown-it'
import dollarmathPlugin, { type IRenderOptions } from 'markdown-it-dollarmath'

import { normalizeMathMarkdown, sanitizeMathExpression } from './mathMarkdown'

const markdownRenderer = new MarkdownIt({
  html: false,
  linkify: false,
  breaks: false,
}).use(dollarmathPlugin, {
  allow_space: true,
  allow_digits: true,
  double_inline: true,
  renderer(content: string, { displayMode }: IRenderOptions) {
    return renderMath(content, displayMode)
  },
})

export function renderExplanationMarkdown(markdown: string): string {
  return markdownRenderer.render(normalizeMathMarkdown(markdown))
}

function renderMath(content: string, displayMode: boolean): string {
  const expression = sanitizeMathExpression(content)

  try {
    return katex.renderToString(expression, {
      displayMode,
      throwOnError: false,
      output: 'htmlAndMathml',
      strict: 'ignore',
    })
  } catch {
    return `<code>${escapeHtml(expression)}</code>`
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
