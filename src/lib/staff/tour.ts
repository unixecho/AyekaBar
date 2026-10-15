// The employee's first-run tour (2026-10-15) — PURE: no React, no Supabase. scripts/check-join.mjs runs this file.
//
// Owner: "after employee onboarding completes and the account is synced, instead of going to the Home page show the
// employee a quick intro on the dashboard and what they can do in it — explain the schedule, payslips, the OMS, the
// loyalty club". First asked to end at the login panel; corrected the same day: "begin the demo and at the end leave
// them at the dashboard logged in."
//
// So the wizard's last screen (JoinWizard) is this tour rather than a button into the dashboard. Each slide that is
// about a dashboard tile carries that tile's id, and the component draws a miniature of the real dashboard with that
// tile lit — `check-join.mjs` compares the ids and labels here against lib/dashboard/tiles.ts, so the miniature cannot
// drift from the real thing.
//
// Words are Hebrew only: this is a staff surface (same posture as the rest of lib/staff/join.ts).

export type TourTileId = 'my-shifts' | 'payslips' | 'pos' | 'loyalty'

/** The four work tiles as the dashboard shows them, in the dashboard's order. `he`/`icon` must equal the registry. */
export const TOUR_TILES: readonly { id: TourTileId; icon: string; he: string }[] = [
  { id: 'my-shifts', icon: '🗓️', he: 'המשמרות שלי' },
  { id: 'pos',       icon: '🧾', he: 'מערכת קופה' },
  { id: 'loyalty',   icon: '🎁', he: 'מועדון נאמנות' },
  { id: 'payslips',  icon: '💵', he: 'תלושי שכר' },
]

export interface TourSlide {
  key: 'overview' | 'schedule' | 'payslips' | 'pos' | 'loyalty' | 'alerts'
  /** The tile to light in the miniature; null = the whole dashboard (overview) or none (alerts). */
  tile: TourTileId | null
  title: string
  lead: string
  points: readonly string[]
}

export const TOUR_SLIDES: readonly TourSlide[] = [
  {
    key: 'overview', tile: null,
    title: 'זה אזור הצוות שלכם',
    lead: 'כל מה שצריך למשמרת במקום אחד. נעבור על זה בקצרה — כדקה.',
    points: [
      'למעלה: המשמרת הקרובה שלכם, והאם משמרת פתוחה עכשיו.',
      'מתחת: הכפתורים לכל מה שאתם עושים בעבודה.',
      'מנהלים רואים כאן גם כלים נוספים לפי התפקיד.',
    ],
  },
  {
    key: 'schedule', tile: 'my-shifts',
    title: 'המשמרות שלי',
    lead: 'הסידור שהמנהל פרסם — מתי עובדים ובאיזה תפקיד.',
    points: [
      'כל שבוע מסמנים רק את המשמרות שאי אפשר לכם להגיע אליהן. יום שלא סימנתם — אתם זמינים.',
      'אפשר לבקש כמה ימי חופש בשבוע (בדרך כלל עד 2). המנהל מחליט ורואה את הבקשות בזמן שהוא בונה את הסידור.',
      'ההגשה נסגרת ביום שלישי בחצות. שעות מיוחדות והערות — ישירות למנהל.',
    ],
  },
  {
    key: 'payslips', tile: 'payslips',
    title: 'תלושי שכר',
    lead: 'התלושים שלכם, מתי שצריך, בלי לבקש מאף אחד.',
    points: [
      'צופים בתלוש ישר באפליקציה, או מורידים אותו.',
      'רק אתם והנהלה רואים את התלושים שלכם. אף עובד אחר לא.',
      'תלוש מוגן בסיסמה? האפליקציה תבקש אותה — היא לא נשמרת.',
    ],
  },
  {
    key: 'pos', tile: 'pos',
    title: 'מערכת הקופה',
    lead: 'המקום שבו עובדים בזמן משמרת: הזמנות, שולחנות, בר ומטבח.',
    points: [
      'מלצרים לוקחים הזמנות ומשלחים אותן לבר ולמטבח; הן מופיעות שם מיד.',
      'נכנסים עם אותו חשבון Google שחיברתם עכשיו.',
      'הזמנות שלקוחות שולחים מהטלפון, וקריאות למלצר, מגיעות אליכם לשם.',
    ],
  },
  {
    key: 'loyalty', tile: 'loyalty',
    title: 'מועדון הנאמנות',
    lead: 'לקוחות צוברים נקודות בכל ביקור — ואתם נותנים להם את הקוד.',
    points: [
      'בכפתור תמצאו קוד צבירה שהלקוח סורק כדי לקבל את הנקודות.',
      'כל עוד המועדון עדיין לא נפתח ללקוחות, הכפתור יופיע נעול עם "בקרוב".',
    ],
  },
  {
    key: 'alerts', tile: null,
    title: 'עדכונים בטלפון',
    lead: 'כדי לא לפספס שינוי בסידור או הזמנה שמחכה.',
    points: [
      'אפשר להפעיל התראות עכשיו, או בכל זמן מתחתית אזור הצוות.',
      'בסיום תגיעו ישר לאזור הצוות, כשאתם כבר מחוברים.',
    ],
  },
]

/** Where the tour ends: the dashboard, signed in (owner, 2026-10-15 — first said "the login panel", then corrected:
 *  "at the end leave them at the dashboard logged in"). The person is already signed in from the join step. */
export const TOUR_END_HREF = '/staff/dashboard'

/** Clamp an index into the slide range — the component never trusts its own arithmetic. */
export const clampSlide = (i: number): number => Math.max(0, Math.min(TOUR_SLIDES.length - 1, Math.trunc(Number.isFinite(i) ? i : 0)))
export const isLastSlide = (i: number): boolean => clampSlide(i) === TOUR_SLIDES.length - 1
