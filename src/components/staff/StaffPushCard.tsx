'use client'

import { useEffect, useState } from 'react'
import { Bell, BellOff, BellRing, CalendarClock, ConciergeBell, Repeat2, RotateCw, Share, Smartphone } from 'lucide-react'
import { haptic } from '@/lib/haptics'
import { isIosDevice, isPushSupported, isStandaloneDisplay, isStaffPushActive, subscribeStaffPush } from '@/lib/push/client'
import '@/components/staff/staff-push.css'

type Stage = 'checking' | 'install' | 'unsupported' | 'ask' | 'busy' | 'on' | 'denied' | 'failed'

const BENEFITS = [
  { icon: CalendarClock, text: 'שינוי במשמרת, פרסום סידור ותזכורת לפני שהמשמרת מתחילה' },
  { icon: Repeat2, text: 'עובדים שמוסרים משמרת, ובקשות החלפה שמחכות לך' },
  { icon: ConciergeBell, text: 'עדכונים חשובים מהבר בזמן אמת' },
]

export default function StaffPushCard({ variant = 'home' }: { variant?: 'home' | 'wizard' }) {
  const [stage, setStage] = useState<Stage>('checking')

  useEffect(() => {
    let current = true
    async function check() {
      if (isIosDevice() && !isStandaloneDisplay()) { if (current) setStage('install'); return }
      if (!isPushSupported()) { if (current) setStage('unsupported'); return }
      if (Notification.permission === 'denied') { if (current) setStage('denied'); return }
      if (Notification.permission === 'granted') {
        const active = await isStaffPushActive() || await subscribeStaffPush()
        if (current) setStage(active ? 'on' : 'failed')
        return
      }
      if (current) setStage('ask')
    }
    void check()
    const onFocus = () => { void check() }
    const onVisible = () => { if (document.visibilityState === 'visible') void check() }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisible)
    return () => { current = false; window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onVisible) }
  }, [])

  async function enable() {
    haptic('select')
    setStage('busy')
    try {
      const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission()
      if (permission !== 'granted') { setStage(permission === 'denied' ? 'denied' : 'ask'); return }
      const active = await subscribeStaffPush()
      if (active) haptic('impact')
      setStage(active ? 'on' : 'failed')
    } catch { setStage('failed') }
  }

  // Permission alone is insufficient: this device must have a server-registered subscription.
  if (stage === 'checking' || stage === 'on') return null

  if (stage === 'install') return (
    <section className={`app-push app-push--required app-push--${variant}`} aria-label="הפעלת התראות נדרשת">
      <div className="app-push__head">
        <span className="app-push__icon"><Smartphone size={24} aria-hidden="true" /></span>
        <div><span className="app-push__required">נדרש להפעלה</span><h2>הוסיפו את אייכה בר למסך הבית</h2><p>באייפון, התראות פועלות מתוך האפליקציה שבמסך הבית.</p></div>
      </div>
      <ol className="app-install__steps">
        <li>פתחו את האתר ב־Safari.</li>
        <li><span>הקישו על שיתוף <Share size={16} style={{ verticalAlign: 'middle', display: 'inline' }} aria-hidden="true" /> בסרגל הדפדפן.</span></li>
        <li>בחרו „הוספה למסך הבית”.</li>
        <li>פתחו את האפליקציה מהסמל במסך הבית, התחברו שוב וחזרו להפעלת ההתראות.</li>
      </ol>
    </section>
  )

  if (stage === 'unsupported') return (
    <section className="app-push app-push--required" aria-label="הפעלת התראות נדרשת" role="status">
      <div className="app-push__row"><BellOff size={24} aria-hidden="true" /><div><span className="app-push__required">נדרש להפעלה</span><strong>הדפדפן הזה אינו תומך בהתראות</strong><small>פתחו את אייכה בר בדפדפן שתומך בהתראות, או התקינו את האפליקציה במסך הבית באייפון.</small></div></div>
    </section>
  )

  if (stage === 'denied') return (
    <section className="app-push app-push--required app-push--denied" aria-label="הפעלת התראות נדרשת" role="status">
      <div className="app-push__row"><BellOff size={24} aria-hidden="true" /><div><span className="app-push__required">נדרש להפעלה</span><strong>ההתראות חסומות במכשיר</strong><small>אפשרו התראות לאתר בהגדרות הדפדפן או הטלפון, ואז חזרו לכאן.</small></div></div>
      <button type="button" className="app-install__button app-install__primary press" onClick={() => window.location.reload()}><RotateCw size={18} aria-hidden="true" />בדיקה מחדש</button>
    </section>
  )

  return (
    <section className={`app-push app-push--required app-push--${variant}`} aria-label="הפעלת התראות נדרשת" role="status">
      <div className="app-push__head">
        <span className="app-push__icon"><BellRing size={24} aria-hidden="true" /></span>
        <div><span className="app-push__required">נדרש להפעלה</span><h2>הפעילו התראות מאייכה בר</h2><p>עדכונים חשובים על משמרות ובקשות צוות יגיעו אליכם בזמן.</p></div>
      </div>
      <ul className="app-push__list">{BENEFITS.map(({ icon: Icon, text }) => <li key={text}><Icon size={18} aria-hidden="true" /><span>{text}</span></li>)}</ul>
      {stage === 'failed' && <p className="app-notifications__error" role="alert">ההרשאה אושרה, אבל המכשיר עדיין לא נרשם להתראות. נסו שוב.</p>}
      <button type="button" className="app-install__button app-install__primary press" disabled={stage === 'busy'} onClick={() => void enable()}><Bell size={19} aria-hidden="true" />{stage === 'busy' ? 'מפעיל…' : 'הפעלת התראות'}</button>
    </section>
  )
}
