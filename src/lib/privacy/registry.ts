import type { Lang } from '@/lib/menu/types'
import { ACK_KEY } from './notice'

// The storage registry: the ONE list of everything this site keeps on a
// visitor's device — cookies, localStorage, sessionStorage.
//
// Why it exists (2026-10-04). A privacy notice is only worth anything while it
// is TRUE, and the way a notice stops being true is that somebody adds a
// feature that writes a new localStorage key and nobody updates a page that
// lives somewhere else. So the page (`/cookies`), the one-time notice, the
// "delete what this site stored" button and the check that guards all of them
// read THIS file, and `scripts/check-privacy.mjs` fails when the code writes a
// key that is not declared here, or when this file declares one the code no
// longer writes. Adding a feature that stores something is now a two-line
// change in a place that cannot be forgotten.
//
// WHAT THE LAW ASKS (so the shape below is not arbitrary). Israel has no
// cookie-specific statute. The Protection of Privacy Law's notice duty (s. 11)
// and its consent standard apply to personal information in general; the
// Authority's consent paper of 25 Feb 2026 does not mention cookies, but says
// that continuing to browse after clear information generally counts as consent
// where the use is connected to the service, and that opt-in is needed for uses
// the service does not need (its example is profiling-based advertising). A 2020
// recommendation of the Authority (non-binding, from a payments guidance) asks
// for opt-in for cookies beyond those strictly necessary. Everything declared
// here is either needed for something the visitor is using or is a choice the
// visitor made, and nothing is analytics or advertising — so what is owed is a
// CLEAR, FINDABLE NOTICE, not a consent gate. The day an analytics or
// advertising item is added this file refuses (CONSENT_MECHANISM_BUILT, below)
// until a real opt-in exists. PLAYBOOK.md §3 has the sources and the reasoning.
// This is engineering, not legal advice.
//
// THE RULES FOR AN ENTRY
//   • `name` is the exact key or cookie name. A `*` stands for the part a
//     library chooses (Supabase puts the project's reference in the middle).
//   • Say what is in it, why, when it is written and how long it stays — in all
//     three languages; Hebrew is the one a regulator would read.
//   • `sentToServer` is true only for cookies. Storage never leaves the device.
//   • `ttlHours`, where there is a real expiry in code, is cross-checked
//     against that constant by the harness, so the sentence cannot drift.

type Text = Record<Lang, string>
const t = (he: string, en: string, ar: string): Text => ({ he, en, ar })

export type StorageKind = 'localStorage' | 'sessionStorage' | 'cookie'
/** `necessary`: needed for something the visitor is using. `functional`: a choice
 *  the visitor made, or a note that something has already been shown. The other
 *  two exist so that adding one is a deliberate act the harness can see. */
export type StorageCategory = 'necessary' | 'functional' | 'analytics' | 'marketing'
/** `table`: only a visitor who typed a code a waiter gave them (remote ordering, 2026-10-13). */
export type StorageAudience = 'everyone' | 'signed-in' | 'table' | 'staff'

export interface StorageItem {
  id: string
  kind: StorageKind
  name: string
  category: StorageCategory
  audience: StorageAudience
  /** Cookies are sent back to our server with every request; storage never is. */
  sentToServer: boolean
  what: Text
  why: Text
  when: Text
  keeps: Text
  /** Technical attributes, shown for cookies (not translated — they are names). */
  attributes?: string
  /** A real expiry that exists in code; the harness compares it to the constant. */
  ttlHours?: number
}

/** The two categories that need an opt-in before they may exist. False until a
 *  real consent mechanism is built — see the harness. */
export const CONSENT_MECHANISM_BUILT = false

/** Shown on /cookies. A human bumps this when the PAGE's meaning changes; the
 *  one-time notice re-appears whenever the inventory itself changes — that is
 *  what `INVENTORY_VERSION` in notice.ts is pinned to (`inventoryVersion`, below). */
export const PRIVACY_PAGE_UPDATED = '2026-10-04'

export const STORAGE_REGISTRY: readonly StorageItem[] = [
  // ── needed for something the visitor is using ───────────────────────────
  {
    id: 'cart', kind: 'localStorage', name: 'ayeka.menu.cart.v1',
    category: 'necessary', audience: 'everyone', sentToServer: false, ttlHours: 8,
    what: t(
      'הפריטים שהוספתם לרשימת ההזמנה, שמות הסועדים שביניהם חילקתם אותה, והערות לפריטים.',
      'The items you added to your order list, the names of the people you split it between, and notes on items.',
      'الأصناف التي أضفتموها إلى قائمة الطلب وأسماء من قسّمتموها بينهم والملاحظات على الأصناف.'),
    why: t(
      'כדי שהרשימה לא תיעלם אם תרעננו את הדף או תחזרו לתפריט. היא נשארת במכשיר שלכם, ונשלחת למלצר רק אם תלחצו על "שליחה למלצר".',
      'So the list is not lost if you refresh the page or come back to the menu. It stays on your device, and goes to a waiter only if you tap "Send to waiter".',
      'لكي لا تضيع القائمة إذا أعدتم تحميل الصفحة أو عدتم إلى القائمة. تبقى على جهازكم، ولا تصل إلى النادل إلا إذا ضغطتم على "إرسال للنادل".'),
    when: t(
      'כשאתם מוסיפים משהו לרשימה או משנים אותה.',
      'When you add to the list or change it.',
      'عند الإضافة إلى القائمة أو تعديلها.'),
    keeps: t(
      '8 שעות מהשינוי האחרון, ואז היא נמחקת. היא נמחקת גם כשהיא מתרוקנת.',
      '8 hours after your last change, then it is discarded. It is also removed when it becomes empty.',
      '8 ساعات بعد آخر تعديل ثم تُحذف. وتُحذف أيضًا عندما تفرغ.'),
  },
  {
    id: 'nav-stack', kind: 'sessionStorage', name: 'ayeka:navStack',
    category: 'necessary', audience: 'everyone', sentToServer: false,
    what: t(
      'רשימת העמודים האחרונים שפתחתם בלשונית הזו — עד 25 כתובות עמוד, בלי תוכן.',
      'The last pages you opened in this tab — up to 25 page addresses, no content.',
      'قائمة آخر الصفحات التي فتحتموها في هذا التبويب — حتى 25 عنوان صفحة بلا أي محتوى.'),
    why: t(
      'כדי שמעבר בין עמודים יחליק לכיוון הנכון — קדימה או אחורה.',
      'So moving between pages slides the right way — forwards or back.',
      'ليكون الانتقال بين الصفحات منزلقًا في الاتجاه الصحيح — إلى الأمام أو إلى الخلف.'),
    when: t(
      'בכל מעבר בין עמודים.',
      'On every move between pages.',
      'عند كل انتقال بين الصفحات.'),
    keeps: t(
      'עד שתסגרו את הלשונית. אחר כך הוא נמחק מעצמו.',
      'Until you close the tab. Then it is deleted automatically.',
      'حتى تغلقوا التبويب. بعدها يُحذف تلقائيًا.'),
  },
  {
    id: 'auth-session', kind: 'cookie', name: 'sb-*-auth-token',
    category: 'necessary', audience: 'signed-in', sentToServer: true,
    attributes: 'Path=/ · SameSite=Lax · Max-Age=400 days · not HttpOnly',
    what: t(
      'אסימון ההתחברות שלכם — מה שמאפשר לאתר לדעת שאתם מחוברים. אם הוא ארוך הוא נשמר בכמה עוגיות ממוספרות.',
      'Your sign-in token — what lets the site know you are signed in. If it is long it is split across several numbered cookies.',
      'رمز تسجيل الدخول الخاص بكم — ما يتيح للموقع معرفة أنكم مسجّلون. إذا كان طويلًا يُقسَّم على عدة ملفات مرقّمة.'),
    why: t(
      'כדי להשאיר אתכם מחוברים בין עמודים. בלעדיו אי אפשר להתחבר.',
      'To keep you signed in between pages. Without it, signing in cannot work.',
      'لإبقائكم مسجّلين الدخول بين الصفحات. بدونه لا يمكن تسجيل الدخول.'),
    when: t(
      'רק אחרי שאתם מתחברים עם חשבון Google. מי שלא מתחבר לא מקבל אותו.',
      'Only after you sign in with a Google account. If you do not sign in, you never get it.',
      'فقط بعد تسجيل الدخول بحساب Google. من لا يسجّل الدخول لا يحصل عليه.'),
    keeps: t(
      'עד שתתנתקו, ולכל היותר 400 יום.',
      'Until you sign out, and at most 400 days.',
      'حتى تسجّلوا الخروج، وبحد أقصى 400 يوم.'),
  },
  {
    id: 'auth-verifier', kind: 'cookie', name: 'sb-*-auth-token-code-verifier',
    category: 'necessary', audience: 'signed-in', sentToServer: true,
    attributes: 'Path=/ · SameSite=Lax · Max-Age=400 days · not HttpOnly',
    what: t(
      'קוד אקראי חד־פעמי.',
      'A one-time random code.',
      'رمز عشوائي يُستخدم مرة واحدة.'),
    why: t(
      'מוכיח שההתחברות שהתחלתם היא זו שמסתיימת — הגנת אבטחה (PKCE).',
      'Proves the sign-in you started is the one that finishes — a security safeguard (PKCE).',
      'يثبت أن تسجيل الدخول الذي بدأتموه هو الذي ينتهي — إجراء أمان (PKCE).'),
    when: t(
      'ברגע שאתם לוחצים להתחבר עם Google.',
      'The moment you press sign in with Google.',
      'لحظة الضغط على تسجيل الدخول عبر Google.'),
    keeps: t(
      'נמחק כשההתחברות מסתיימת. אם לא סיימתם אותה, הוא נשאר עד שתמחקו אותו, ולכל היותר 400 יום.',
      'Deleted when sign-in completes. If you never finish signing in, it stays until you delete it, and at most 400 days.',
      'يُحذف عند اكتمال تسجيل الدخول. وإذا لم تكملوه يبقى حتى تحذفوه، وبحد أقصى 400 يوم.'),
  },
  {
    // Remote ordering (2026-10-13, migration 058). The ONE cookie a customer can receive without an account —
    // and only after typing a code a member of staff gave them. HttpOnly, so no script on the page can read it.
    id: 'table-session', kind: 'cookie', name: 'ayeka_table_session',
    category: 'necessary', audience: 'table', sentToServer: true, ttlHours: 3,
    attributes: 'Path=/ · SameSite=Lax · HttpOnly · Secure · expires with the visit, at most 3 hours',
    what: t(
      'מספר אקראי שמוכיח שהטלפון הזה קיבל מהמלצר קוד לשולחן. אין בו שם, טלפון או כל פרט אישי.',
      'A random number that proves this phone was given a code for a table by a waiter. It holds no name, phone number or personal detail.',
      'رقم عشوائي يثبت أن هذا الهاتف حصل من النادل على رمز لطاولة. لا يحتوي على اسم أو رقم هاتف أو أي تفصيل شخصي.'),
    why: t(
      'כדי שאפשר יהיה לשלוח את הרשימה למלצר, ולחזור אליה אם הדף נסגר או שהטלפון התחלף. הדף עצמו לא יכול לקרוא אותו.',
      'So the list can be sent to a waiter, and picked up again if the page closes or the phone changes. The page itself cannot read it.',
      'لكي يمكن إرسال القائمة إلى النادل واستئنافها إذا أُغلقت الصفحة أو تغيّر الهاتف. لا تستطيع الصفحة نفسها قراءته.'),
    when: t(
      'רק אחרי שהקלדתם קוד שמלצר נתן לכם. מי שלא מקליד קוד לא מקבל אותו.',
      'Only after you type a code a waiter gave you. If you never type one, you never get it.',
      'فقط بعد أن تكتبوا رمزًا أعطاكم إياه النادل. من لا يكتب رمزًا لا يحصل عليه.'),
    keeps: t(
      'עד סוף הביקור בשולחן — לכל היותר 3 שעות מהרגע שהקוד הוקלד, או עד שהמלצר מסיים את הביקור. אפשר לנתק קודם מחלון ההזמנה.',
      'Until your visit at the table ends — at most 3 hours from when the code was first typed, or until the waiter ends the visit. You can disconnect sooner from the order window.',
      'حتى تنتهي زيارتكم للطاولة — بحد أقصى 3 ساعات من أول مرة كُتب فيها الرمز، أو حتى ينهي النادل الزيارة. يمكنكم قطع الاتصال قبل ذلك من نافذة الطلب.'),
  },

  // ── a choice the visitor made, or a note that something was already shown ─
  {
    id: 'site-language', kind: 'localStorage', name: 'siteLanguage',
    category: 'functional', audience: 'everyone', sentToServer: false,
    what: t(
      'השפה שבחרתם — עברית, אנגלית או ערבית.',
      'The language you chose — Hebrew, English or Arabic.',
      'اللغة التي اخترتموها — العبرية أو الإنجليزية أو العربية.'),
    why: t(
      'כדי שהאתר ייפתח בשפה שלכם גם בביקור הבא.',
      'So the site opens in your language next time too.',
      'ليُفتح الموقع بلغتكم في الزيارة القادمة أيضًا.'),
    when: t(
      'כשאתם בוחרים שפה.',
      'When you choose a language.',
      'عند اختياركم لغة.'),
    keeps: t(
      'עד שתמחקו אותה.',
      'Until you delete it.',
      'حتى تحذفوها.'),
  },
  {
    id: 'a11y-prefs', kind: 'localStorage', name: 'ayeka.a11y.prefs.v1',
    category: 'functional', audience: 'everyone', sentToServer: false,
    what: t(
      'ההתאמות שבחרתם בתפריט הנגישות — למשל גודל טקסט, ניגודיות וריווח.',
      'The adjustments you chose in the accessibility menu — for example text size, contrast and spacing.',
      'التعديلات التي اخترتموها في قائمة إمكانية الوصول — مثل حجم النص والتباين والتباعد.'),
    why: t(
      'כדי שההתאמות יישארו פעילות בכל עמוד ובביקורים הבאים.',
      'So your adjustments stay on across pages and on later visits.',
      'لتبقى التعديلات فعّالة في كل صفحة وفي الزيارات القادمة.'),
    when: t(
      'כשאתם משנים הגדרה בתפריט הנגישות.',
      'When you change a setting in the accessibility menu.',
      'عند تغييركم أي إعداد في قائمة إمكانية الوصول.'),
    keeps: t(
      'עד שתאפסו את ההגדרות בתפריט הנגישות או תמחקו את הנתונים.',
      'Until you reset the settings in the accessibility menu or delete the data.',
      'حتى تعيدوا ضبط الإعدادات في قائمة إمكانية الوصول أو تحذفوا البيانات.'),
  },
  {
    id: 'a11y-ui', kind: 'localStorage', name: 'ayeka.a11y.prefs.v1:ui',
    category: 'functional', audience: 'everyone', sentToServer: false,
    what: t(
      'הפינה שבה הצבתם את כפתור הנגישות, והאם ההצגה הראשונה שלו כבר הסתיימה.',
      'The corner where you placed the accessibility button, and whether its first-visit introduction has already played.',
      'الزاوية التي وضعتم فيها زر إمكانية الوصول، وهل انتهى عرضه التعريفي الأول.'),
    why: t(
      'כדי שהכפתור יישאר במקום שבחרתם, ולא נציג את ההצגה הראשונה שלו שוב.',
      'So the button stays where you put it, and its introduction is not replayed.',
      'ليبقى الزر حيث وضعتموه ولا يُعاد عرضه التعريفي.'),
    when: t(
      'כשאתם מזיזים את הכפתור, ובפעם הראשונה שהוא מוצג.',
      'When you move the button, and the first time it is shown.',
      'عند نقلكم الزر، وأول مرة يظهر فيها.'),
    keeps: t(
      'עד שתמחקו אותו.',
      'Until you delete it.',
      'حتى تحذفوه.'),
  },
  {
    id: 'cart-tutorial', kind: 'localStorage', name: 'ayeka.menu.cart.tutorial.v1',
    category: 'functional', audience: 'everyone', sentToServer: false,
    what: t(
      'סימון שהמדריך החד־פעמי לרשימת ההזמנה כבר הוצג.',
      'A marker that the one-time walkthrough of the order list has already been shown.',
      'علامة بأن الشرح الذي يظهر مرة واحدة لقائمة الطلب قد عُرض.'),
    why: t(
      'כדי שלא נציג אותו שוב.',
      'So we do not show it again.',
      'لكي لا نعرضه مرة أخرى.'),
    when: t(
      'כשאתם סוגרים את המדריך.',
      'When you close the walkthrough.',
      'عند إغلاقكم الشرح.'),
    keeps: t(
      'עד שתמחקו אותו.',
      'Until you delete it.',
      'حتى تحذفوه.'),
  },
  {
    id: 'intro-seen', kind: 'localStorage', name: 'ayeka.intro.seen.v1',
    category: 'functional', audience: 'everyone', sentToServer: false,
    what: t(
      'הרגע שבו המכשיר הזה ראה לראשונה את מסך הפתיחה של דף הבית.',
      'The moment this device first saw the home page opening screen.',
      'اللحظة التي رأى فيها هذا الجهاز شاشة الافتتاح للصفحة الرئيسية لأول مرة.'),
    why: t(
      'כדי שבביקור הראשון תראו את הגרסה המלאה, ובכל ביקור אחר כך — גרסה קצרה.',
      'So your first visit gets the full version and every later visit a short one.',
      'لتحصلوا في الزيارة الأولى على النسخة الكاملة وفي كل زيارة بعدها على نسخة قصيرة.'),
    when: t(
      'כשמסך הפתיחה מתחיל לפעול, בדף הבית בלבד.',
      'When the opening screen starts, on the home page only.',
      'عند بدء شاشة الافتتاح، في الصفحة الرئيسية فقط.'),
    keeps: t(
      'עד שתמחקו אותו.',
      'Until you delete it.',
      'حتى تحذفوه.'),
  },
  {
    id: 'privacy-ack', kind: 'localStorage', name: ACK_KEY,
    category: 'functional', audience: 'everyone', sentToServer: false,
    what: t(
      'סימון שראיתם את ההודעה על אחסון במכשיר, ואיזו גרסה שלה.',
      'A marker that you have seen the on-device storage notice, and which version of it.',
      'علامة بأنكم رأيتم إشعار التخزين على الجهاز وأي نسخة منه.'),
    why: t(
      'כדי שלא נציג אותה שוב — אלא אם יתווסף לרשימה הזו משהו חדש.',
      'So we do not show it again — unless something new is added to this list.',
      'لكي لا نعرضه مرة أخرى — إلا إذا أُضيف شيء جديد إلى هذه القائمة.'),
    when: t(
      'כשאתם לוחצים "הבנתי", או כשאתם פותחים את דף העוגיות והאחסון.',
      'When you press "Got it", or when you open the cookies and storage page.',
      'عند الضغط على "فهمت"، أو عند فتح صفحة ملفات تعريف الارتباط والتخزين.'),
    keeps: t(
      'עד שתמחקו אותו.',
      'Until you delete it.',
      'حتى تحذفوه.'),
  },

  // ── staff tools — not part of the public site ───────────────────────────
  {
    id: 'settings-draft', kind: 'sessionStorage', name: 'ayeka:settings-draft:v1:*',
    category: 'functional', audience: 'staff', sentToServer: false,
    what: t(
      'טיוטה של הגדרות סידור העבודה שעדיין לא נשמרה (החלק האחרון בשם הוא מזהה העסק).',
      'A draft of the scheduling settings that has not been saved yet (the last part of the name is the venue id).',
      'مسودة لإعدادات جدولة المناوبات لم تُحفظ بعد (آخر جزء من الاسم هو معرّف المكان).'),
    why: t(
      'כדי שעריכה באמצע לא תלך לאיבוד ברענון או בחזרה למסך. לא בשימוש באתר הציבורי.',
      'So an edit in progress is not lost on a refresh or when coming back to the screen. Not used on the public site.',
      'لكي لا يضيع التعديل الجاري عند التحديث أو العودة إلى الشاشة. لا يُستخدم في الموقع العام.'),
    when: t(
      'רק כשמנהל משנה הגדרות סידור ולא שמר עדיין.',
      'Only while a manager has changed scheduling settings and not saved yet.',
      'فقط عندما يغيّر المدير إعدادات الجدولة ولم يحفظ بعد.'),
    keeps: t(
      'עד סגירת הלשונית, או עד שמירה/ביטול של הטיוטה.',
      'Until the tab is closed, or the draft is saved or discarded.',
      'حتى إغلاق اللسان، أو حفظ المسودة أو إلغائها.'),
  },
  {
    id: 'staff-push-off', kind: 'localStorage', name: 'ayeka:staff-push-off:v1',
    category: 'functional', audience: 'staff', sentToServer: false,
    what: t(
      'סימון שהתראות הטלפון של הצוות כבויות במכשיר הזה.',
      'A mark that the staff phone alerts are switched off on this device.',
      'علامة بأن تنبيهات الهاتف للطاقم متوقفة على هذا الجهاز.'),
    why: t(
      'כדי לכבד את הבחירה שלך ולא לבקש שוב. לא בשימוש באתר הציבורי.',
      'To respect your choice and not ask again. Not used on the public site.',
      'لاحترام اختيارك وعدم السؤال مجدداً. لا يُستخدم في الموقع العام.'),
    when: t(
      'רק כשעובד מכבה את ההתראות במכשיר.',
      'Only when a staff member turns the alerts off on the device.',
      'فقط عندما يوقف أحد أفراد الطاقم التنبيهات على الجهاز.'),
    keeps: t(
      'עד שימחקו אותו או יפעילו את ההתראות מחדש.',
      'Until it is deleted or the alerts are switched on again.',
      'حتى يُحذف أو تُفعَّل التنبيهات من جديد.'),
  },
  {
    id: 'staff-push-snooze', kind: 'localStorage', name: 'ayeka:staff-push-snooze:v1',
    category: 'functional', audience: 'staff', sentToServer: false,
    what: t(
      'מתי להזכיר שוב לעובד להפעיל התראות טלפון.',
      'When to remind a staff member again about phone alerts.',
      'متى نذكّر أحد أفراد الطاقم مجدداً بتنبيهات الهاتف.'),
    why: t(
      'כדי שבקשה שנדחתה לא תחזור בכל ביקור. לא בשימוש באתר הציבורי.',
      'So a request that was postponed does not come back on every visit. Not used on the public site.',
      'لكي لا يعود طلب تم تأجيله في كل زيارة. لا يُستخدم في الموقع العام.'),
    when: t(
      'רק כשעובד בוחר "אחר כך" בכרטיס ההתראות.',
      'Only when a staff member chooses "later" on the alerts card.',
      'فقط عندما يختار أحد أفراد الطاقم "لاحقاً" في بطاقة التنبيهات.'),
    keeps: t(
      'שלושה ימים, ואז היא נמחקת מעצמה.',
      'Three days, then it clears itself.',
      'ثلاثة أيام، ثم تُمحى من تلقاء نفسها.'),
  },
]

// ── what the site loads from other companies, and what it only links to ────
// Not storage, but the same promise: the page says "nothing else is loaded",
// and the harness holds the code to it. Link-out hosts are LINKS the visitor
// follows — nothing is fetched from them until they do.
export const LINK_OUT_HOSTS: readonly string[] = [
  'maps.google.com', 'maps.app.goo.gl', 'maps.apple', 'waze.com',
  'www.instagram.com', 'www.facebook.com', 'www.gov.il', 'staff.ayeka.bar',
]

// Links that exist ONLY on the developer's dashboard (/owner/dev), behind a
// sign-in no visitor has: Supabase, Vercel and GitHub, the places the system is
// run from. They are not part of anything a visitor of the public site sees, so
// they are kept apart from LINK_OUT_HOSTS and are never listed on /cookies. They
// are still listed HERE so scripts/check-privacy.mjs keeps its promise that every
// host named in src/ is accounted for. (Added 2026-10-13 with lib/dashboard/tiles.ts.)
//
// `wa.me` (2026-10-14): the owner's "send on WhatsApp" button in the join-link sheet on /owner/staff
// (lib/staff/join.ts). It is a plain link the owner chooses to follow; nothing is fetched from it, and it carries the
// join link the owner is about to send — to the owner's own WhatsApp, not to us. Behind the owner sign-in.
export const STAFF_ONLY_LINK_OUT_HOSTS: readonly string[] = [
  'supabase.com', 'vercel.com', 'github.com', 'wa.me',
]

// ── the inventory's fingerprint ───────────────────────────────────────────
// A short, deterministic hash of WHAT is stored (kind, name, category,
// audience) — deliberately not of the wording. The one-time notice remembers it:
// change the inventory and everybody who acknowledged the old one sees the notice
// again; fix a typo in a sentence and nobody is bothered. FNV-1a, 32 bit — a
// change detector, not a security boundary.
//
// It is PINNED as INVENTORY_VERSION in notice.ts (a literal, so the portal and the
// menu need not load this file), and scripts/check-privacy.mjs fails — printing the
// value to paste — when the two disagree.
export function inventoryVersion(items: readonly StorageItem[] = STORAGE_REGISTRY): string {
  const lines = items
    .map((i) => [i.kind, i.name, i.category, i.audience].join('|'))
    .sort()
    .join('\n')
  let h = 0x811c9dc5
  for (let i = 0; i < lines.length; i++) {
    h ^= lines.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

// ── helpers the page and the harness share ────────────────────────────────
export const itemsByCategory = (
  category: StorageCategory, items: readonly StorageItem[] = STORAGE_REGISTRY,
): StorageItem[] => items.filter((i) => i.category === category && i.audience !== 'staff')

export const staffItems = (items: readonly StorageItem[] = STORAGE_REGISTRY): StorageItem[] =>
  items.filter((i) => i.audience === 'staff')
