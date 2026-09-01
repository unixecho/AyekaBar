import Link from 'next/link'

// The accessibility statement (הצהרת נגישות) required by Israel's Equal
// Rights for Persons with Disabilities regulations (תקנות נגישות השירות) —
// a separate, mandatory document regardless of whether the site also
// carries a Privacy Policy or Terms page. Hebrew-only, matching how the
// Privacy Policy / Terms drafts were scoped (a single-language legal
// document is the norm on this site, not a gap — see CLAUDE.md's i18n
// note, which is about product UI strings, not legal filings).
//
// Genuinely known, stated as fact below: every digital-accessibility item
// under "מה בוצע באתר". Everything about the PHYSICAL venue (wheelchair
// access, accessible restroom, etc.) is owner-supplied — marked
// [להשלמה] rather than guessed, same convention as the Privacy Policy /
// Terms drafts' business-identity placeholders.

const STATEMENT_DATE = '01.09.2026'

export default function AccessibilityPage() {
  return (
    <main style={{ minHeight: '100dvh', padding: '32px 20px 60px', position: 'relative' }} dir="rtl" lang="he">
      <div className="app-bg" aria-hidden />
      <div className="app-scrim" aria-hidden />

      <div style={{ maxWidth: 640, margin: '0 auto', position: 'relative' }}>
        <Link href="/" style={{ color: 'var(--text-faint)', fontSize: '0.85rem', textDecoration: 'none' }}>
          ← חזרה לדף הבית
        </Link>

        <h1 style={{ fontSize: '1.7rem', fontWeight: 800, color: 'var(--text)', margin: '18px 0 4px' }}>
          הצהרת נגישות — אייכה בר
        </h1>
        <p style={{ color: 'var(--text-faint)', fontSize: '0.85rem', margin: '0 0 28px' }}>
          עודכן לאחרונה: {STATEMENT_DATE}
        </p>

        <Section title="כללי">
          <p>
            אנו רואים חשיבות רבה במתן שירות שוויוני ונגיש לכלל הציבור, לרבות אנשים עם מוגבלות.
            אתר זה פועל להנגשה בהתאם לתקן הישראלי (ת"י) 5568 ברמה AA, המבוסס על הנחיות הנגישות
            הבינלאומיות WCAG 2.0.
          </p>
        </Section>

        <Section title="מה בוצע באתר (נכון לתאריך עדכון ההצהרה)">
          <ul style={listStyle}>
            <li>מבנה סמנטי וכותרות מדורגות בכל עמוד.</li>
            <li>ניגודיות צבעים בין טקסט לרקע בהתאם לרמה AA (4.5:1 לטקסט רגיל).</li>
            <li>אינדיקציה חזותית ברורה למיקוד מקלדת (focus) בכל רכיב אינטראקטיבי.</li>
            <li>תמיכה בניווט מלא באמצעות מקלדת.</li>
            <li>כיבוד הגדרת "הפחתת תנועה" (prefers-reduced-motion) של הדפדפן/מערכת ההפעלה — למי שמוגדר אצלו כך, אנימציות באתר מצטמצמות אוטומטית.</li>
            <li>תמיכה מלאה בכיווניות טקסט מימין-לשמאל (RTL) עבור עברית וערבית.</li>
          </ul>
        </Section>

        <Section title="דפדפנים שנבדקו">
          <p>Chrome, Safari — גרסאות עדכניות, מחשב ונייד. <span style={pillPh}>[להשלמה: רשימה סופית לאחר סבב בדיקה מלא]</span></p>
        </Section>

        <Section title="נגישות בית העסק הפיזי">
          <p style={pillPh}>[להשלמה ע״י בעל העסק: התאמות נגישות בבית העסק עצמו — גישה לכיסא גלגלים, שירותים נגישים, וכל התאמה פיזית רלוונטית אחרת.]</p>
        </Section>

        <Section title="פטורים">
          <p style={pillPh}>[להשלמה: האם העסק חוסה תחת פטור עסק קטן לפי התקנות — כפוף למחזור ההכנסות השנתי. לבירור מול בעל העסק ו/או יועץ נגישות.]</p>
        </Section>

        <Section title="לא הצלחת להשתמש בחלק מהאתר?">
          <p>
            אנו פועלים לשפר את נגישות האתר באופן שוטף. אם נתקלת בקושי או בעיה בנושא נגישות, נשמח
            שתדווח/י לנו כדי שנוכל לטפל בכך:
          </p>
          <p style={pillPh}>[להשלמה: שם רכז/ת הנגישות, טלפון, אימייל]</p>
        </Section>

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
const pillPh: React.CSSProperties = { color: 'var(--neon-soft)', background: 'rgba(255,94,58,0.1)', border: '1px solid rgba(255,94,58,0.25)', borderRadius: 10, padding: '8px 12px', display: 'inline-block' }
