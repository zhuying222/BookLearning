import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { formatPageSelection } from '../lib/pageSelection'

type Locale = 'zh' | 'en'

export type ParseNotificationKind = 'page' | 'batch' | 'follow-up'

export type ParseNotification = {
  id: string
  kind: ParseNotificationKind
  pages: number[]
  targetPage: number | null
  durationMs: number
}

type Props = {
  locale: Locale
  notifications: ParseNotification[]
  onDismiss: (id: string) => void
  onActivate: (id: string, targetPage: number | null) => void
}

type NotificationText = {
  badge: string
  title: string
  detail: string | null
}

const EXIT_ANIMATION_MS = 260

function getNotificationText(locale: Locale, notification: ParseNotification): NotificationText {
  const isZh = locale === 'zh'
  const rangeText = formatPageSelection(notification.pages)
  const targetPage = notification.targetPage ?? notification.pages[0] ?? null

  switch (notification.kind) {
    case 'page':
      return {
        badge: isZh ? '单页解析' : 'Page Parse',
        title: isZh ? `第 ${rangeText} 页已解析完毕` : `Page ${rangeText} is ready`,
        detail: targetPage === null
          ? null
          : (isZh ? `点击跳转到第 ${targetPage} 页` : `Click to jump to page ${targetPage}`),
      }
    case 'follow-up':
      return {
        badge: isZh ? '追问解析' : 'Follow-up',
        title: isZh ? `第 ${rangeText} 页追问已解析完毕` : `Follow-up for page ${rangeText} is ready`,
        detail: targetPage === null
          ? null
          : (isZh ? `点击跳转到第 ${targetPage} 页` : `Click to jump to page ${targetPage}`),
      }
    case 'batch':
      return {
        badge: isZh ? '批量解析' : 'Batch Parse',
        title: isZh ? `第 ${rangeText} 页批量解析已完成` : `Batch parse completed for pages ${rangeText}`,
        detail: targetPage === null
          ? null
          : (isZh ? `点击跳转到第 ${targetPage} 页` : `Click to jump to page ${targetPage}`),
      }
  }
}

function NotificationCard({
  locale,
  notification,
  isLeaving,
  onRequestDismiss,
  onRequestActivate,
  onElement,
}: {
  locale: Locale
  notification: ParseNotification
  isLeaving: boolean
  onRequestDismiss: (notification: ParseNotification) => void
  onRequestActivate: (notification: ParseNotification) => void
  onElement: (id: string, element: HTMLDivElement | null) => void
}) {
  useEffect(() => {
    if (isLeaving) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      onRequestDismiss(notification)
    }, notification.durationMs)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [isLeaving, notification, onRequestDismiss])

  const text = getNotificationText(locale, notification)

  return (
    <div
      ref={(element) => onElement(notification.id, element)}
      className={`parse-toast${isLeaving ? ' parse-toast--leaving' : ''}`}
    >
      <button
        type="button"
        className="parse-toast__main"
        onClick={() => onRequestActivate(notification)}
        aria-label={text.title}
      >
        <span className="parse-toast__badge">{text.badge}</span>
        <strong className="parse-toast__title">{text.title}</strong>
        {text.detail && <span className="parse-toast__detail">{text.detail}</span>}
      </button>
      <button
        type="button"
        className="parse-toast__close"
        aria-label={locale === 'zh' ? '关闭通知' : 'Close notification'}
        onClick={(event) => {
          event.stopPropagation()
          onRequestDismiss(notification)
        }}
      >
        ×
      </button>
    </div>
  )
}

export default function ParseNotificationCenter({
  locale,
  notifications,
  onDismiss,
  onActivate,
}: Props) {
  const toastRefs = useRef(new Map<string, HTMLDivElement>())
  const leaveTimeoutsRef = useRef(new Map<string, number>())
  const leavingActionsRef = useRef(new Map<string, { action: 'dismiss' | 'activate'; targetPage: number | null }>())
  const latestNotificationIdsRef = useRef(new Set<string>())
  const previousTopsRef = useRef(new Map<string, number>())
  const [leavingIds, setLeavingIds] = useState<Set<string>>(() => new Set())

  useEffect(() => {
    latestNotificationIdsRef.current = new Set(notifications.map((notification) => notification.id))
  }, [notifications])

  useEffect(() => {
    const leaveTimeouts = leaveTimeoutsRef.current
    const leavingActions = leavingActionsRef.current

    return () => {
      for (const timeoutId of leaveTimeouts.values()) {
        window.clearTimeout(timeoutId)
      }
      leaveTimeouts.clear()
      leavingActions.clear()
    }
  }, [])

  useLayoutEffect(() => {
    const nextTops = new Map<string, number>()

    for (const notification of notifications) {
      const element = toastRefs.current.get(notification.id)
      if (!element) {
        continue
      }

      const nextTop = element.getBoundingClientRect().top
      nextTops.set(notification.id, nextTop)

      if (leavingActionsRef.current.has(notification.id)) {
        continue
      }

      const previousTop = previousTopsRef.current.get(notification.id)
      if (previousTop === undefined) {
        continue
      }

      const delta = previousTop - nextTop
      if (Math.abs(delta) < 1) {
        continue
      }

      element.style.transition = 'none'
      element.style.transform = `translate3d(0, ${delta}px, 0)`
      void element.getBoundingClientRect()
      element.style.transition = ''
      element.style.transform = ''
    }

    previousTopsRef.current = nextTops
  }, [leavingIds, notifications])

  const setToastElement = useCallback((id: string, element: HTMLDivElement | null) => {
    if (element) {
      toastRefs.current.set(id, element)
      return
    }
    toastRefs.current.delete(id)
  }, [])

  const startLeaving = useCallback((notification: ParseNotification, action: 'dismiss' | 'activate') => {
    if (leavingActionsRef.current.has(notification.id)) {
      return
    }

    leavingActionsRef.current.set(notification.id, {
      action,
      targetPage: notification.targetPage,
    })
    setLeavingIds((prev) => {
      const next = new Set(prev)
      next.add(notification.id)
      return next
    })

    const timeoutId = window.setTimeout(() => {
      const pending = leavingActionsRef.current.get(notification.id)
      leaveTimeoutsRef.current.delete(notification.id)
      leavingActionsRef.current.delete(notification.id)
      setLeavingIds((prev) => {
        const next = new Set(prev)
        next.delete(notification.id)
        return next
      })

      if (!pending) {
        return
      }

      if (!latestNotificationIdsRef.current.has(notification.id)) {
        return
      }

      if (pending.action === 'activate') {
        onActivate(notification.id, pending.targetPage)
        return
      }

      onDismiss(notification.id)
    }, EXIT_ANIMATION_MS)

    leaveTimeoutsRef.current.set(notification.id, timeoutId)
  }, [onActivate, onDismiss])

  const handleRequestDismiss = useCallback((notification: ParseNotification) => {
    startLeaving(notification, 'dismiss')
  }, [startLeaving])

  const handleRequestActivate = useCallback((notification: ParseNotification) => {
    startLeaving(notification, 'activate')
  }, [startLeaving])

  if (notifications.length === 0) {
    return null
  }

  if (typeof document === 'undefined' || !document.body) {
    return null
  }

  return createPortal((
    <div className="parse-toast-stack" aria-live="polite" aria-atomic="false">
      {notifications.map((notification) => (
        <NotificationCard
          key={notification.id}
          locale={locale}
          notification={notification}
          isLeaving={leavingIds.has(notification.id)}
          onRequestDismiss={handleRequestDismiss}
          onRequestActivate={handleRequestActivate}
          onElement={setToastElement}
        />
      ))}
    </div>
  ), document.body)
}
