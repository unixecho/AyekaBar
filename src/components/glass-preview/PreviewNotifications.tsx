'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Menu, type MenuEntry } from 'glisse'
import { Bell, BellRing, Check, CircleAlert } from 'lucide-react'

type Notice = { id: string; title: string; body: string | null; created_at: string; read_at: string | null }
const RANGE = /(\d{1,2}:\d{2}[–-]\d{1,2}:\d{2})/
const Isolate = ({ text }: { text: string }) => <>{text.split(RANGE).map((part, i) => i % 2 ? <bdi key={i} dir="ltr">{part}</bdi> : part)}</>

export default function PreviewNotifications({ scheduleHref }: { scheduleHref: string }) {
  const router = useRouter()
  const [notices, setNotices] = useState<Notice[] | null>(null)
  const [unread, setUnread] = useState<number | null>(null)
  const [error, setError] = useState(false)

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/staff/notifications', { cache: 'no-store' })
      if (!response.ok) throw new Error('notifications')
      const data = await response.json() as { notifications: Notice[]; unread: number }
      setNotices(data.notifications)
      setUnread(data.unread)
      setError(false)
    } catch { setError(true) }
  }, [])

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void load() }, 45_000)
    const onVisible = () => { if (document.visibilityState === 'visible') void load() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisible) }
  }, [load])

  const markRead = useCallback(async (ids?: string[]) => {
    try {
      const response = await fetch('/api/shifts/dispatch', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'markNotificationsRead', ...(ids ? { ids } : {}) }),
        keepalive: true,
      })
      if (!response.ok) throw new Error('read')
      await load()
    } catch { setError(true) }
  }, [load])

  const items = useMemo<MenuEntry[]>(() => {
    if (!notices) return [{ label: error ? 'לא הצלחנו לטעון התראות · נסו שוב' : 'טוען התראות…', icon: <CircleAlert size={16} />, disabled: !error, onSelect: () => void load() }]
    const head: MenuEntry = { label: unread ? `סימון הכול כנקרא · ${unread} חדשות` : 'אין התראות חדשות', icon: <Check size={16} />,
      disabled: !unread, onSelect: () => void markRead() }
    const rows: MenuEntry[] = notices.slice(0, 15).map((notice) => ({
      icon: notice.read_at ? <Bell size={17} /> : <BellRing size={17} />,
      label: <span className="ag-notice">
        <span className="ag-notice-head"><strong><Isolate text={notice.title} /></strong>{!notice.read_at && <span className="ag-notice-pill">חדש</span>}</span>
        {notice.body && <small className="ag-notice-body"><Isolate text={notice.body} /></small>}
        <small className="ag-notice-time">{new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(notice.created_at))}</small>
      </span>,
      onSelect: () => { if (!notice.read_at) void markRead([notice.id]); router.push(scheduleHref) },
    }))
    if (error) rows.unshift({ label: 'לא הצלחנו לעדכן התראות · נסו שוב', icon: <CircleAlert size={16} />, onSelect: () => void load() })
    return notices.length ? [head, 'separator', ...rows] : [head, { label: 'כאן יופיעו בקשות, תשובות ושינויים בסידור.', disabled: true }]
  }, [notices, unread, error, load, markRead, router, scheduleHref])

  return <span className="ag-notifications">
    <Menu aria-label={unread ? `התראות, ${unread} חדשות` : 'התראות'} align="start" icon={<Bell size={20} />} items={items} />
    {unread !== null && unread > 0 && <span className="ag-notification-count" aria-hidden="true">{unread > 99 ? '99+' : unread}</span>}
  </span>
}
