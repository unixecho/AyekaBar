// Every string the feedback box shows a customer, in all three languages the
// site speaks. Same rule and same flat shape as `lib/cart/i18n.ts`: a new
// user-facing string is added to `he`, `en` AND `ar` in the same edit, or it
// isn't added, and keeping them in one object means a gap is visible by
// reading down a column. `scripts/check-feedback.mjs` fails the build-adjacent
// harness if any of them is missing.

import type { Lang } from '@/lib/menu/types'
import type { FeedbackError } from './validate'

type Tri = { he: string; en: string; ar: string }

export const FEEDBACK_UI = {
  // ── The launcher on the portal ─────────────────────────────────────
  open:    { he: 'שליחת משוב',     en: 'Send feedback',   ar: 'إرسال ملاحظات' },

  // ── The sheet ──────────────────────────────────────────────────────
  title:   { he: 'מה דעתכם?',      en: 'Tell us what you think', ar: 'ما رأيك؟' },
  intro: {
    he: 'כל הערה עוזרת לנו להשתפר — על הבר עצמו או על האתר.',
    en: 'Every note helps us get better — about the bar itself, or about this site.',
    ar: 'كل ملاحظة تساعدنا على التحسّن — عن البار نفسه أو عن هذا الموقع.',
  },
  close:   { he: 'סגירה',          en: 'Close',           ar: 'إغلاق' },

  // ── The category choice ────────────────────────────────────────────
  // Asked first, deliberately: it is the one thing the owner triages on, and
  // guessing it from the text afterwards would be guessing.
  categoryLabel: { he: 'על מה המשוב?', en: 'What is this about?', ar: 'عن ماذا الملاحظة؟' },
  business:      { he: 'על הבר',        en: 'The bar',            ar: 'عن البار' },
  businessHint: {
    he: 'שירות, אוכל ושתייה, המקום, המחירים',
    en: 'Service, food and drink, the venue, prices',
    ar: 'الخدمة، المأكولات والمشروبات، المكان، الأسعار',
  },
  technical:     { he: 'על האתר',       en: 'The website',        ar: 'عن الموقع' },
  technicalHint: {
    he: 'משהו לא עובד, נראה שבור, קישור שגוי',
    en: 'Something is broken, looks wrong, or a bad link',
    ar: 'شيء لا يعمل، يبدو معطوباً، أو رابط خاطئ',
  },

  // ── The fields ─────────────────────────────────────────────────────
  messageLabel:       { he: 'מה תרצו לספר לנו?', en: 'What would you like to tell us?', ar: 'ماذا تودّ أن تخبرنا؟' },
  messagePlaceholder: { he: 'כתבו כאן…',          en: 'Write here…',                    ar: 'اكتب هنا…' },
  emailLabel:         { he: 'אימייל לחזרה (לא חובה)', en: 'Email for a reply (optional)', ar: 'بريد للردّ (اختياري)' },
  emailPlaceholder:   { he: 'you@example.com',   en: 'you@example.com',                ar: 'you@example.com' },
  emailHint: {
    he: 'רק אם תרצו שנחזור אליכם. אפשר גם להשאיר ריק.',
    en: 'Only if you want us to get back to you. Leaving it blank is fine.',
    ar: 'فقط إذا أردت أن نعود إليك. يمكنك تركه فارغاً.',
  },

  // ── The privacy line ───────────────────────────────────────────────
  // Short, present before the button, and honest about the two things that
  // are not obvious: the page address travels with the message, and a
  // signed-in visitor's feedback is linked to their account.
  privacy: {
    he: 'לא נשמרת כתובת ה-IP שלכם. נשמרת כתובת העמוד שממנו נשלח המשוב, וכן — אם אתם מחוברים לחשבון — הקישור לחשבון.',
    en: 'We do not store your IP address. We do store which page you sent this from, and — if you are signed in — the link to your account.',
    ar: 'لا نحتفظ بعنوان IP الخاص بك. نحتفظ بعنوان الصفحة التي أرسلت منها الملاحظة، وكذلك — إن كنت مسجّل الدخول — الربط بحسابك.',
  },

  submit:   { he: 'שליחה',   en: 'Send',     ar: 'إرسال' },
  sending:  { he: 'שולח…',   en: 'Sending…', ar: 'جارٍ الإرسال…' },

  // ── After ──────────────────────────────────────────────────────────
  thanksTitle: { he: 'תודה!', en: 'Thank you!', ar: 'شكراً!' },
  thanksBody: {
    he: 'המשוב נשלח והוא יגיע ישירות אלינו.',
    en: 'Your feedback was sent and comes straight to us.',
    ar: 'تم إرسال ملاحظتك وستصل إلينا مباشرة.',
  },
  done: { he: 'סגירה', en: 'Done', ar: 'إغلاق' },

  // ── Errors ─────────────────────────────────────────────────────────
  errGeneric: {
    he: 'השליחה נכשלה. אפשר לנסות שוב בעוד רגע.',
    en: 'Sending failed. Please try again in a moment.',
    ar: 'فشل الإرسال. حاول مرة أخرى بعد قليل.',
  },
  errOffline: {
    he: 'אין חיבור לרשת כרגע.',
    en: 'No network connection right now.',
    ar: 'لا يوجد اتصال بالشبكة حالياً.',
  },
  errEmpty: {
    he: 'צריך לכתוב משהו לפני השליחה.',
    en: 'Please write something before sending.',
    ar: 'يرجى كتابة شيء قبل الإرسال.',
  },
  errTooLong: {
    he: 'ההודעה ארוכה מדי.',
    en: 'That message is too long.',
    ar: 'الرسالة طويلة جداً.',
  },
  errEmail: {
    he: 'כתובת האימייל לא נראית תקינה.',
    en: 'That email address doesn’t look right.',
    ar: 'يبدو أن البريد الإلكتروني غير صحيح.',
  },
  errRateLimited: {
    he: 'נשלחו כבר כמה הודעות. אפשר לנסות שוב בעוד כמה דקות.',
    en: 'A few messages have already been sent. Try again in a few minutes.',
    ar: 'تم إرسال عدة رسائل بالفعل. حاول مرة أخرى بعد بضع دقائق.',
  },
  errClosed: {
    he: 'תיבת המשוב סגורה כרגע. אפשר לפנות אלינו דרך אינסטגרם או פייסבוק.',
    en: 'The feedback box is closed right now. You can reach us on Instagram or Facebook.',
    ar: 'صندوق الملاحظات مغلق حالياً. يمكنك التواصل معنا عبر إنستغرام أو فيسبوك.',
  },
} satisfies Record<string, Tri>

export type FeedbackUiKey = keyof typeof FEEDBACK_UI

export function ft(key: FeedbackUiKey, lang: Lang): string {
  return FEEDBACK_UI[key][lang]
}

/** Map a server error code onto a message in the customer's own language.
 *  An unrecognised code falls back to the generic line rather than rendering
 *  the raw code or an empty string — see validate.ts's header for why codes
 *  cross the wire in the first place. */
export function feedbackErrorText(code: string | undefined, lang: Lang): string {
  const map: Record<FeedbackError | 'rate_limited' | 'disabled', FeedbackUiKey> = {
    bad_request: 'errGeneric',
    bad_category: 'errGeneric',
    message_empty: 'errEmpty',
    message_too_long: 'errTooLong',
    bad_email: 'errEmail',
    rate_limited: 'errRateLimited',
    disabled: 'errClosed',
  }
  const key = code && code in map ? map[code as keyof typeof map] : 'errGeneric'
  return FEEDBACK_UI[key][lang]
}
