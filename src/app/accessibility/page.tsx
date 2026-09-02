import Link from 'next/link'
import { getAccessibilityStatement, getAccessibilityStatementUpdatedAt } from '@/lib/settings/server'

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

export default async function AccessibilityPage() {
  const [s, updatedAt] = await Promise.all([
    getAccessibilityStatement(),
    getAccessibilityStatementUpdatedAt(),
  ])
  const hasPhysical = s.entranceAccess || s.restroomAccess || s.generalNote
  const hasContact = s.contactName || s.contactPhone || s.contactEmail

  return (
    <main id="main" style={{ minHeight: '100dvh', padding: '32px 20px 60px', position: 'relative' }} dir="rtl" lang="he">
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
            אתר זה פועל להנגשה בהתאם לתקן הישראלי (ת"י) 5568 ברמה AA, המבוסס על הנחיות הנגישות
            הבינלאומיות WCAG 2.0.
          </p>
        </Section>

        <Section title="מה בוצע באתר">
          <ul style={listStyle}>
            <li>מבנה סמנטי וכותרות מדורגות בכל עמוד.</li>
            <li>ניגודיות צבעים בין טקסט לרקע בהתאם לרמה AA (4.5:1 לטקסט רגיל).</li>
            <li>אינדיקציה חזותית ברורה למיקוד מקלדת (focus) בכל רכיב אינטראקטיבי.</li>
            <li>תמיכה בניווט מלא באמצעות מקלדת.</li>
            <li>כיבוד הגדרת "הפחתת תנועה" (prefers-reduced-motion) של הדפדפן/מערכת ההפעלה.</li>
            <li>תמיכה מלאה בכיווניות טקסט מימין-לשמאל (RTL) עבור עברית וערבית.</li>
          </ul>
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
