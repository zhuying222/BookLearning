export function normalizeMathMarkdown(input: string): string {
  return replaceEscapedDelimitedMath(
    replaceEscapedDelimitedMath(normalizeFormulaLikeLines(input.replace(/\r\n/g, '\n')), '\\[', '\\]', true),
    '\\(',
    '\\)',
    false,
  )
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

export function sanitizeMathExpression(expr: string): string {
  return expr
    .trim()
    .replace(/\\\[((?:.|\n)*?)\\\]/g, '$1')
    .replace(/\\\(((?:.|\n)*?)\\\)/g, '$1')
    .replace(/\$([^$\n]+)\$(\s*\^\s*(?:\{[^}]+\}|[A-Za-z0-9]))/g, '($1)$2')
    .replace(/(^|[=+\-*/,([{]\s*)\$([^$\n]+)\$(?=\s*(?:\\\\|[A-Za-z([{]))/g, '$1($2)')
    .replace(/\$/g, '')
    .replace(/\\(d?frac|tfrac)(?!\s*\{)\s*([A-Za-z0-9])\s*([A-Za-z0-9])/g, '\\$1{$2}{$3}')
    .replace(/\\sqrt\s*([A-Za-z0-9])/g, '\\sqrt{$1}')
    .replace(/\)\(/g, ')(')
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

function normalizeFormulaLikeLines(input: string): string {
  return input
    .split('\n')
    .map((line) => normalizeFormulaLikeLine(line))
    .join('\n')
}

function normalizeFormulaLikeLine(line: string): string {
  const trimmed = line.trim()
  if (!trimmed) {
    return line
  }

  if (/^(?:[-*+]\s+|\d+\.\s+)/.test(trimmed)) {
    return line
  }

  if (/(^|[^\\])(\\\(|\\\[)/.test(trimmed)) {
    return line
  }

  const colonIndex = Math.max(line.lastIndexOf('：'), line.lastIndexOf(':'))
  if (colonIndex !== -1) {
    const prefix = line.slice(0, colonIndex + 1)
    const suffix = line.slice(colonIndex + 1).trim()
    if (isFormulaLikeCandidate(suffix)) {
      const leadingSpace = line.slice(colonIndex + 1).match(/^\s*/)?.[0] ?? ' '
      return `${prefix}${leadingSpace}$${sanitizeLooseFormula(suffix)}$`
    }
  }

  if (isFormulaLikeCandidate(trimmed)) {
    const leadingSpace = line.match(/^\s*/)?.[0] ?? ''
    const trailingSpace = line.match(/\s*$/)?.[0] ?? ''
    return `${leadingSpace}$$${sanitizeLooseFormula(trimmed)}$$${trailingSpace}`
  }

  return line
}

function isFormulaLikeCandidate(text: string): boolean {
  if (!text) {
    return false
  }

  const stripped = text
    .replace(/^[-*+]\s+/, '')
    .replace(/^\d+\.\s+/, '')
    .replace(/[，。；：、,.]$/, '')
    .trim()

  if (!stripped || /[\u4e00-\u9fff]/.test(stripped)) {
    return false
  }

  const hasMathSignal = /\\[a-zA-Z]+|[=^_{}]|[A-Za-z]\([^)]+\)|\d[A-Za-z]|[A-Za-z]\d/.test(stripped)
  const hasOperator = /[=+\-*/<>]/.test(stripped)
  const hasLatexStructure = /\\(?:frac|sum|prod|sqrt|left|right|cdot|tan|sin|cos|pi|times)/.test(stripped)
  return hasLatexStructure || (hasMathSignal && hasOperator)
}

function sanitizeLooseFormula(text: string): string {
  return sanitizeMathExpression(
    text
      .replace(/[，。；、,.]$/, '')
      .replace(/⁡/g, '')
      .replace(/\b([A-Za-z]+)\s*\(/g, '$1('),
  )
}

function replaceEscapedDelimitedMath(
  input: string,
  opener: string,
  closer: string,
  displayMode: boolean,
): string {
  let result = ''
  let cursor = 0

  while (cursor < input.length) {
    const start = input.indexOf(opener, cursor)
    if (start === -1) {
      result += input.slice(cursor)
      break
    }

    result += input.slice(cursor, start)
    const end = input.indexOf(closer, start + opener.length)
    if (end === -1) {
      result += input.slice(start)
      break
    }

    const expr = input.slice(start + opener.length, end)
    result += convertMarkedMath(expr, displayMode)
    cursor = end + closer.length
  }

  return result
}
