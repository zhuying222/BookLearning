export function normalizeMathMarkdown(input: string): string {
  return input
    .replace(/\r\n/g, '\n')
    .replace(/\\\[((?:.|\n)*?)\\\]/g, (_, expr: string) => convertMarkedMath(expr, true))
    .replace(/\\\(((?:.|\n)*?)\\\)/g, (_, expr: string) => convertMarkedMath(expr, false))
    .replace(/\$\$([\s\S]*?)\$\$/g, (_, expr: string) => convertMarkedMath(expr, true))
    .replace(/(^|[^\$])\$([^$\n]+)\$/g, (_, prefix: string, expr: string) => `${prefix}${convertMarkedMath(expr, false)}`)
    .replace(/\(([^()\n]{1,180})\)/g, (full, expr: string) => {
      const content = expr.trim()
      if (!looksLikeMath(content)) {
        return full
      }
      return `$${sanitizeMathExpression(content)}$`
    })
}

function looksLikeMath(text: string): boolean {
  if (!text || /[\u4e00-\u9fff]/.test(text)) {
    return false
  }

  if (/(\\[a-zA-Z]+)|[\^_]/.test(text)) {
    return true
  }

  const hasVariable = /[a-zA-Z]/.test(text)
  const hasDigit = /\d/.test(text)
  const hasMathOperator = /[=+\-*/<>]/.test(text)
  return hasVariable && (hasDigit || hasMathOperator)
}

function sanitizeMathExpression(expr: string): string {
  return expr
    .trim()
    .replace(/\\\[((?:.|\n)*?)\\\]/g, '$1')
    .replace(/\\\(((?:.|\n)*?)\\\)/g, '$1')
    .replace(/\$/g, '')
    .replace(/\\(d?frac|tfrac)(?!\s*\{)\s*([A-Za-z0-9])\s*([A-Za-z0-9])/g, '\\$1{$2}{$3}')
    .replace(/\\sqrt\s*([A-Za-z0-9])/g, '\\sqrt{$1}')
    .replace(/\{\s+/g, '{')
    .replace(/\s+\}/g, '}')
}

function convertMarkedMath(expr: string, displayMode: boolean): string {
  const sanitized = sanitizeMathExpression(expr)
  if (!shouldTreatAsMath(sanitized)) {
    return sanitized
  }
  return displayMode ? `\n\n$$${sanitized}$$\n\n` : `$${sanitized}$`
}

function shouldTreatAsMath(text: string): boolean {
  if (!text) {
    return false
  }

  if (/[\u4e00-\u9fff]/.test(text) && !/\\text\s*\{/.test(text)) {
    return false
  }

  return looksLikeMath(text) || /[=+\-*/<>|]/.test(text)
}
