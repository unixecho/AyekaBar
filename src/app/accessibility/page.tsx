import Link from 'next/link'
import { getAccessibilityStatement, getAccessibilityStatementUpdatedAt } from '@/lib/settings/server'
import { WIDGET_COVERAGE } from 'a11y-widget'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'הצהרת נגישות · אייכה בר' }

// The accessibility statement (הצהרת נגישות) required by Israel's Equal
// Rights for Persons with Disabilities regulations (תקנות נגישות השירות) —
// mandatory regardless of whether the site also carries a Privacy Policy or
// Terms page. Hebrew-only, matching how those drafts are scoped (a
// single-language legal document is the norm on this site, not a gap).
//
// 2026-09-01: content is now owner-editable (/owner/accessibility, backed
// by app_settings) rather than hardcoded. Every section below renders only
// if it actually has content — a real visitor never sees a "[להשלמה]"
// placeholder. Whatever's still missing surfaces instead as a dashboard
// signal pointing the owner at the editor (src/lib/owner/signals.ts).
//
// 2026-09-12: rewrote "מה בוצע" and added "מה נבדק ואיך" (both hardcoded,
// not owner-editable — this is a factual record of the actual engineering
// work, not a business-facing field). PLAN_ACCESSIBILITY.md §1.3 item A11
// flagged the previous version as an over-claim: it asserted "תמיכה מלאה
// בניווט מלא באמצעות מקלדת" (full keyboard-navigation support) as already
// true while no one had ever walked a real keyboard journey end to end.
// This version is deliberately narrower and more specific about WHAT was
// verified and HOW, rather than repeating a blanket "full support" claim —
// see that file's own re-audit history for exactly what was and wasn't
// tested before this was last edited.
//
// 2026-09-24: added the "תפריט הנגישות" section, listing WIDGET_COVERAGE
// from the shared a11y-widget package instead of hand-copying its feature
// list here — this is exactly the kind of prose that silently drifted from
// the widget's real behavior once Sarcafe-Portal's independent copy of the
// widget diverged from this app's; sourcing it from the package means a new
// widget feature shows up here automatically instead of needing a second
// edit. Also bumped the claimed standard from WCAG 2.0 to 2.2, matching the
// 2.2-specific success criteria already fixed in this codebase's own commit
// history (2.5.7, 2.5.8, among others) and Sarcafe-Portal's equivalent page.

export default async function AccessibilityPage() {
  const [s, updatedAt] = await Promise.all([
    getAccessibilityStatement(),
    getAccessibilityStatementUpdatedAt(),
  ])
  const hasPhysical = s.entranceAccess || s.restroomAccess || s.generalNote
  const hasContact = s.contactName || s.contactPhone || s.contactEmail

  return (
    <main id="main" tabIndex={-1} style={{ minHeight: '100dvh', padding: '32px 20px 60px', position: 'relative' }} dir="rtl" lang="he">
      <div className="app-bg" aria-hidden />
      <div className="app-scrim" aria-hidden />

      <div style={{ maxWidth: 640, margin: '0 auto', position: 'relative' }}>
        <Link href="/" style={{ color: 'var(--text-faint)', fontSize: '0.85rem', textDecoration: 'none' }}>
          ← חזרה לדף הבית
        </Link>

        <h1 style={{ fontSize: '1.7rem', fontWeight: 800, color: 'var(--text)', margin: '18px 0 4px' }}>
          הצהרת נגישות — אייכה בר
        </h1>
        {updatedAt && (
          <p style={{ color: 'var(--text-faint)', fontSize: '0.85rem', margin: '0 0 28px' }}>
            עודכן לאחרונה: {new Date(updatedAt).toLocaleDateString('he-IL')}
          </p>
        )}

        <Section title="כללי">
          <p>
            אנו רואים חשיבות רבה במתן שירות שוויוני ונגיש לכלל הציבור, לרבות אנשים עם מוגבלות.
            אתר זה פועל להנגשה בהתאם לתקן הישראלי (ת&quot;י) 5568 ברמה AA, המבוסס על הנחיות הנגישות
            הבינלאומיות העדכניות WCAG 2.2.
          </p>
        </Section>

        <Section title="תפריט הנגישות">
          <p>
            בפינה הימנית התחתונה של המסך מופיע כפתור נגישות (סמל דמות בעיגול). לחיצה עליו — או
            הקשה על <b>F2</b> מהמקלדת בכל מקום באתר — פותחת תפריט התאמות אישיות לביקור זה; אותה
            הקשה, או <b>Esc</b>, סוגרת אותו. ההתאמות נשמרות במכשיר ונשארות פעילות בביקורים הבאים,
            עד לאיפוס ידני מתוך התפריט עצמו.
          </p>
          <p style={{ margin: '10px 0 0', fontWeight: 700 }}>מה יש בתפריט:</p>
          <ul style={listStyle}>
            {WIDGET_COVERAGE.map((item) => (
              <li key={item.id}>{item.labels.he}</li>
            ))}
          </ul>
        </Section>

        <Section title="מה בוצע באתר עצמו (מעבר לתפריט הנגישות)">
          <ul style={listStyle}>
            <li>מבנה סמנטי, כותרות מדורגות (ללא דילוג ברמות) ואזורי ניווט (landmarks) בעמודי הלקוח ובעמודי הניהול המרכזיים.</li>
            <li>ניגודיות צבעים בהתאם לרמה AA — 4.5:1 לטקסט רגיל, 3:1 לגבולות רכיבי ממשק (מתגים, כפתורים, שדות טופס).</li>
            <li>אינדיקציה חזותית ברורה למיקוד מקלדת (focus) בכל רכיב אינטראקטיבי.</li>
            <li>קישור דילוג לתוכן הראשי בתחילת כל עמוד, שמעביר בפועל את המיקוד (ולא רק את הגלילה) לתוכן העמוד.</li>
            <li>לכידת מיקוד (focus trap) בחלונות הפעולה המרכזיים באתר — הזמנה, עגלת הקניות, הגשת משוב — כולל החזרת המיקוד למקומו בסגירת החלון.</li>
            <li>הכרזות קוליות (aria-live) לשינויים שמתרחשים בלי רענון עמוד: הוספה לעגלה, שגיאות בטפסים, עדכוני סטטוס.</li>
            <li>כיבוד הגדרת "הפחתת תנועה" (prefers-reduced-motion) של הדפדפן/מערכת ההפעלה.</li>
            <li>תמיכה מלאה בכיווניות טקסט מימין-לשמאל (RTL) עבור עברית וערבית.</li>
          </ul>
        </Section>

        <Section title="מה נבדק ואיך">
          <p>
            מעבר לסקירת קוד שיטתית מול קריטריוני התקן, בוצעו בדיקות ניווט מלאות באמצעות מקלדת
            בלבד (ללא עכבר) בתהליכים המרכזיים באתר — עמוד הבית, התפריט הדיגיטלי, הוספת פריטים
            לעגלה ופיצולם בין סועדים. חלק מהבדיקות הללו חשפו וטיפלו בבעיות אמיתיות שסקירת קוד
            בלבד לא הייתה מגלה.
          </p>
          <p style={{ margin: '8px 0 0' }}>
            <b>מה עדיין לא נבדק:</b> האתר טרם נבדק על ידי משתמש/ת עצמאי/ת בטכנולוגיה מסייעת
            אמיתית (כגון קורא מסך). זהו החסם המרכזי הנותר, ואנו רואים בו סעיף פתוח, לא נושא שנסגר.
          </p>
        </Section>

        {s.browsersTested && (
          <Section title="דפדפנים שנבדקו">
            <p>{s.browsersTested}</p>
          </Section>
        )}

        {hasPhysical && (
          <Section title="נגישות בית העסק הפיזי">
            <ul style={listStyle}>
              {s.entranceAccess && <li>{s.entranceAccess}</li>}
              {s.restroomAccess && <li>{s.restroomAccess}</li>}
              {s.generalNote && <li>{s.generalNote}</li>}
            </ul>
          </Section>
        )}

        {s.exemptionNote && (
          <Section title="פטורים">
            <p>{s.exemptionNote}</p>
          </Section>
        )}

        {hasContact && (
          <Section title="לא הצלחת להשתמש בחלק מהאתר?">
            <p>
              אנו פועלים לשפר את נגישות האתר באופן שוטף. אם נתקלת בקושי או בעיה בנושא נגישות, נשמח
              שתדווח/י לנו כדי שנוכל לטפל בכך:
            </p>
            <p style={{ margin: '8px 0 0' }}>
              {s.contactName && <>{s.contactName}<br /></>}
              {s.contactPhone && <>{s.contactPhone}<br /></>}
              {s.contactEmail && <>{s.contactEmail}</>}
            </p>
          </Section>
        )}

        <p style={{ color: 'var(--text-faint)', fontSize: '0.78rem', marginTop: 36 }}>
          הצהרה זו מתייחסת לנגישות האתר הדיגיטלי. ר׳ גם{' '}
          <a href="https://www.gov.il/he/departments/general/accessibility_regulations" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--text-faint)' }}>
            תקנות נגישות השירות
          </a>{' '}
          באתר משרד המשפטים.
        </p>
      </div>
    </main>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 26 }}>
      <h2 style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--text)', margin: '0 0 8px' }}>{title}</h2>
      <div style={{ color: 'var(--text-dim)', fontSize: '0.92rem', lineHeight: 1.75 }}>{children}</div>
    </section>
  )
}

const listStyle: React.CSSProperties = { margin: 0, paddingInlineStart: 20, display: 'flex', flexDirection: 'column', gap: 6 }
