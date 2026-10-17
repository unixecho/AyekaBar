import type { Lang } from '@/lib/menu/types'
import type { StorageAudience, StorageCategory, StorageKind } from './registry'

// Every public word of the /cookies page, in all three languages. Hebrew is the
// authoritative text — it is the one written first and the one a regulator would
// read; English and Arabic are translations and, like the intro's, have not been
// read by a native speaker (HANDOFF owner inputs). The one-time notice's own words
// are in notice.ts.
//
// Claims made here that the code must keep true — each is pinned by
// scripts/check-privacy.mjs, so a feature that breaks one fails the check
// instead of quietly making this page a lie:
//   • "no tracking or advertising cookies; visits are counted anonymously,
//     without cookies" — no registry item in the analytics/marketing categories,
//     and the ONLY analytics dependency is @vercel/analytics, whose code writes
//     no cookie or storage, mounted through lib/analytics.ts (VISIT_COUNTING);
//   • "if you do not sign in you get no cookies" — the only cookies declared are
//     the sign-in ones, audience `signed-in`;
//   • "loads nothing from other companies except Vercel and Supabase" — no
//     remote @import / <script> / <iframe> / font host anywhere in src/;
//   • "not sent to us" — every localStorage / sessionStorage item has
//     sentToServer: false.

type Text = Record<Lang, string>
const t = (he: string, en: string, ar: string): Text => ({ he, en, ar })

// The words of the page — and ONLY the page. The footer link's label, the path and
// the one-time notice's words live in notice.ts, which the portal and the menu
// load; this file is large and belongs to the /cookies route alone.
export const COOKIES_COPY = {
  title: t('עוגיות ואחסון במכשיר', 'Cookies and on-device storage', 'ملفات تعريف الارتباط والتخزين على جهازكم'),
  lead: t(
    'כאן מפורט בדיוק מה האתר שומר במכשיר שלכם, למה, ולכמה זמן — ואיך מוחקים הכול.',
    'This page lists exactly what the site keeps on your device, why, and for how long — and how to delete all of it.',
    'تُفصّل هذه الصفحة بالضبط ما يحفظه الموقع على جهازكم، ولماذا، ولكم من الوقت — وكيف تحذفون كل شيء.'),
  back: t('חזרה לדף הבית', 'Back to the home page', 'العودة إلى الصفحة الرئيسية'),
  updated: t('עודכן לאחרונה:', 'Last updated:', 'آخر تحديث:'),

  shortTitle: t('בקצרה', 'In short', 'باختصار'),
  short: [
    t('אין באתר עוגיות מעקב או פרסום. ביקורים נספרים באופן אנונימי וללא עוגיות.',
      'The site uses no tracking or advertising cookies. Visits are counted anonymously, without cookies.',
      'لا يستخدم الموقع ملفات تتبّع أو إعلانات. تُعدّ الزيارات بشكل مجهول ودون ملفات تعريف ارتباط.'),
    t('מי שלא מתחבר לחשבון ולא מקליד קוד שמלצר נתן לו — לא מקבל אף עוגייה.',
      'If you do not sign in and do not type a code a waiter gave you, you get no cookies at all.',
      'من لا يسجّل الدخول إلى حساب ولا يكتب رمزًا أعطاه إياه النادل لا يحصل على أي ملف تعريف ارتباط.'),
    t('ההגדרות שלכם — שפה, נגישות ורשימת הזמנה — נשמרות באחסון של הדפדפן במכשיר שלכם. רשימת ההזמנה מגיעה אלינו רק אם תלחצו על "שליחה למלצר".',
      'Your settings — language, accessibility, order list — are kept in your browser’s own storage on your device. The order list reaches us only if you tap "Send to waiter".',
      'إعداداتكم — اللغة وإمكانية الوصول وقائمة الطلب — تُحفظ في تخزين المتصفح على جهازكم. لا تصل قائمة الطلب إلينا إلا إذا ضغطتم على "إرسال للنادل".'),
    t('האתר לא טוען גופנים, סקריפטים או תוספים מחברות אחרות. הוא פונה רק לשני ספקי שירות שפועלים עבורנו — הפרטים למטה.',
      'The site loads no fonts, scripts or plug-ins from other companies. It only contacts the two service providers that work for us — details below.',
      'لا يحمّل الموقع خطوطًا أو سكربتات أو إضافات من شركات أخرى. يتصل فقط بمزوّدَي الخدمة اللذين يعملان لصالحنا — التفاصيل أدناه.'),
  ],

  storedTitle: t('מה נשמר במכשיר שלכם', 'What is kept on your device', 'ما يُحفظ على جهازكم'),
  storedIntro: t(
    'זו הרשימה המלאה. מה שלא כתוב כאן — האתר לא שומר.',
    'This is the complete list. Anything not written here, the site does not keep.',
    'هذه هي القائمة الكاملة. ما لم يُذكر هنا لا يحفظه الموقع.'),
  groups: {
    necessary: {
      title: t('נחוץ לתפקוד האתר', 'Needed for the site to work', 'ضروري لعمل الموقع'),
      note: t(
        'דברים שהאתר לא יכול בלעדיהם כשאתם משתמשים בתכונה שביקשתם.',
        'Things the site cannot do without when you use a feature you asked for.',
        'أشياء لا يستطيع الموقع العمل بدونها عندما تستخدمون ميزة طلبتموها.'),
    },
    functional: {
      title: t('זוכר את הבחירות שלכם', 'Remembers your choices', 'يتذكّر اختياراتكم'),
      note: t(
        'בחירות שעשיתם, וסימונים שמשהו כבר הוצג לכם — כדי שלא נטריד אתכם בו שוב.',
        'Choices you made, and notes that something was already shown to you — so we do not bother you with it again.',
        'اختيارات قمتم بها وعلامات بأن شيئًا ما قد عُرض عليكم — لكي لا نزعجكم به مرة أخرى.'),
    },
    staff: {
      title: t('כלי צוות — לא חלק מהאתר הציבורי', 'Staff tools — not part of the public site', 'أدوات الطاقم — ليست جزءًا من الموقع العام'),
      note: t(
        'מופיע רק אצל מי שמשתמש במצב ההדגמה של מערכת השיבוצים.',
        'Only appears for someone using the scheduling tool’s demo mode.',
        'يظهر فقط لدى من يستخدم الوضع التجريبي لأداة الجدولة.'),
    },
  } as Record<'necessary' | 'functional' | 'staff', { title: Text; note: Text }>,
  noneLine: t(
    'ספירת ביקורים: אנונימית, בלי לשמור דבר במכשיר. פרסום: אין.',
    'Visit counting: anonymous, nothing stored on your device. Advertising: none.',
    'عدّ الزيارات: مجهول ودون تخزين أي شيء على جهازكم. الإعلانات: لا شيء.'),

  // The one thing the site measures — see lib/analytics.ts and VISIT_COUNTING in registry.ts.
  countingTitle: t('ספירת ביקורים', 'Counting visits', 'عدّ الزيارات'),
  countingIntro: t(
    'כדי לדעת אילו עמודים משמשים אנשים, האתר סופר ביקורים באמצעות Vercel Web Analytics — שירות של חברת האחסון שלנו. הספירה אנונימית, ואינה שומרת דבר במכשיר שלכם.',
    'To know which pages people use, the site counts visits with Vercel Web Analytics — a service of the company that hosts us. The counting is anonymous and stores nothing on your device.',
    'لمعرفة أي الصفحات يستخدمها الناس، يعدّ الموقع الزيارات عبر Vercel Web Analytics — خدمة تابعة للشركة التي تستضيفنا. العدّ مجهول ولا يخزّن أي شيء على جهازكم.'),
  counting: [
    t('בלי עוגיות, בלי אחסון במכשיר ובלי מזהה קבוע. כדי לא לספור אותו אדם פעמיים באותו יום משתמשים בסימן שנוצר מהבקשה עצמה, והוא נמחק אחרי 24 שעות.',
      'No cookies, nothing stored on your device and no lasting identifier. To avoid counting the same person twice in a day, a mark made from the request itself is used, and it is discarded after 24 hours.',
      'لا ملفات تعريف ارتباط ولا تخزين على جهازكم ولا معرّف دائم. ولكي لا يُحتسب الشخص نفسه مرتين في اليوم تُستخدم علامة تُنشأ من الطلب نفسه، وتُحذف بعد 24 ساعة.'),
    t('לכל ביקור נרשמים: העמוד, הזמן, האתר שממנו הגעתם, אזור גאוגרפי כללי, סוג המכשיר, מערכת ההפעלה והדפדפן. שום דבר מזה אינו מקושר לשמכם, לדוא"ל או לכתובת ה־IP שלכם.',
      'For each visit the page, the time, the site you came from, a general region, the device type, the operating system and the browser are recorded. None of it is tied to your name, your email or your IP address.',
      'يُسجَّل لكل زيارة: الصفحة والوقت والموقع الذي جئتم منه ومنطقة جغرافية عامة ونوع الجهاز ونظام التشغيل والمتصفح. لا شيء من ذلك مرتبط باسمكم أو بريدكم الإلكتروني أو عنوان الـIP الخاص بكم.'),
    t('עמודי ההתחברות, האזור האישי, הצוות והבעלים, וקישורים אישיים — לא נספרים כלל. וכתובת שנספרת נשלחת בלי מה שאחרי סימן השאלה.',
      'The sign-in pages, the personal area, the staff and owner areas, and personal links are not counted at all. And an address that is counted is sent without anything after the question mark.',
      'صفحات تسجيل الدخول والمنطقة الشخصية ومنطقتا الطاقم والمالك والروابط الشخصية لا تُحتسب إطلاقًا. والعنوان الذي يُحتسب يُرسل دون ما يلي علامة الاستفهام.'),
    t('אם הדפדפן שלכם שולח אות "אל תעקבו" (Do Not Track) או Global Privacy Control — לא נספור אתכם.',
      'If your browser sends a "Do Not Track" or Global Privacy Control signal, we do not count you.',
      'إذا أرسل متصفحكم إشارة "عدم التتبّع" (Do Not Track) أو Global Privacy Control فلن نحتسبكم.'),
    t('הנתונים משמשים רק לסטטיסטיקה מצטברת על העמודים — לא לפרסום ולא למכירה.',
      'The data is used only for combined statistics about the pages — not for advertising and not sold.',
      'تُستخدم البيانات فقط لإحصاءات مجمّعة عن الصفحات — لا للإعلانات ولا تُباع.'),
  ],
  cacheNote: t(
    'הדפדפן שומר גם עותקים של קבצי האתר (תמונות, סקריפטים) כדי לטעון מהר יותר, כמו בכל אתר. הם אינם מכילים מידע עליכם.',
    'Your browser also keeps copies of the site’s files (images, scripts) so it loads faster, as with any website. They hold no information about you.',
    'يحتفظ المتصفح أيضًا بنسخ من ملفات الموقع (الصور والسكربتات) ليحمّلها أسرع، كما في أي موقع. لا تحتوي على أي معلومات عنكم.'),
  legacyNote: t(
    'אם ביקרתם באתר לפני שהחלפנו את תוסף הנגישות הקודם (Negishot), ייתכן שנשארו בדפדפן שלכם קבצים שלו. האתר כבר לא משתמש בהם, ומוחק אותם אוטומטית בביקור הבא.',
    'If you visited before we replaced our previous accessibility add-on (Negishot), your browser may still hold files from it. The site no longer uses them and removes them automatically on your next visit.',
    'إذا زرتم الموقع قبل أن نستبدل إضافة إمكانية الوصول السابقة (Negishot) فقد تبقى في متصفحكم ملفات تخصها. لم يعد الموقع يستخدمها، ويحذفها تلقائيًا عند زيارتكم القادمة.'),

  labels: {
    what: t('מה נשמר', 'What is stored', 'ما الذي يُحفظ'),
    why: t('למה', 'Why', 'لماذا'),
    when: t('מתי נכתב', 'When it is written', 'متى يُكتب'),
    keeps: t('כמה זמן', 'How long', 'كم من الوقت'),
    how: t('איך נשמר', 'How it is stored', 'كيف يُحفظ'),
    who: t('למי רלוונטי', 'Applies to', 'لمن ينطبق'),
    attributes: t('מאפיינים', 'Attributes', 'الخصائص'),
  },
  kindName: {
    localStorage: t('אחסון דפדפן', 'Browser storage', 'تخزين المتصفح'),
    sessionStorage: t('אחסון לשונית', 'Tab storage', 'تخزين التبويب'),
    cookie: t('עוגייה', 'Cookie', 'ملف تعريف ارتباط'),
  } as Record<StorageKind, Text>,
  kindHow: {
    localStorage: t(
      'באחסון הדפדפן (localStorage) — נשאר בדפדפן הזה, במכשיר הזה. השרת שלנו לא מקבל אותו.',
      'In the browser’s own storage (localStorage) — it stays in this browser on this device. Our server never receives it.',
      'في تخزين المتصفح (localStorage) — يبقى في هذا المتصفح على هذا الجهاز. لا يستقبله خادمنا.'),
    sessionStorage: t(
      'באחסון הלשונית (sessionStorage) — נמחק כשסוגרים אותה. השרת שלנו לא מקבל אותו.',
      'In the tab’s own storage (sessionStorage) — it is deleted when the tab closes. Our server never receives it.',
      'في تخزين التبويب (sessionStorage) — يُحذف عند إغلاقه. لا يستقبله خادمنا.'),
    cookie: t(
      'עוגייה בדומיין של האתר — הדפדפן שולח אותה לשרת עם כל בקשה לאתר.',
      'A cookie on the site’s own domain — your browser sends it to our server with each request to the site.',
      'ملف تعريف ارتباط على نطاق الموقع نفسه — يرسله متصفحكم إلى خادمنا مع كل طلب إلى الموقع.'),
  } as Record<StorageKind, Text>,
  audience: {
    everyone: t('כל מי שמבקר באתר', 'Everyone who visits', 'كل من يزور الموقع'),
    'signed-in': t('רק מי שמתחבר לחשבון', 'Only people who sign in', 'فقط من يسجّل الدخول إلى حساب'),
    table: t('רק מי שמקליד קוד שמלצר נתן לו', 'Only people who type a code a waiter gave them', 'فقط من يكتب رمزًا أعطاه إياه النادل'),
    staff: t('רק צוות ובעלים', 'Staff and owner only', 'الطاقم والمالك فقط'),
    join: t('רק מי שמצטרף לצוות דרך קישור הצטרפות', 'Only people joining the team through a join link', 'فقط من ينضم إلى الطاقم عبر رابط انضمام'),
  } as Record<StorageAudience, Text>,
  category: {
    necessary: t('נחוץ', 'Needed', 'ضروري'),
    functional: t('בחירות', 'Choices', 'اختيارات'),
    analytics: t('אנליטיקה', 'Analytics', 'تحليلات'),
    marketing: t('פרסום', 'Advertising', 'إعلانات'),
  } as Record<StorageCategory, Text>,

  othersTitle: t('מה האתר טוען מחברות אחרות', 'What the site loads from other companies', 'ما يحمّله الموقع من شركات أخرى'),
  othersIntro: t(
    'שני ספקי שירות פועלים עבורנו. הדפדפן שלכם פונה אליהם, ולכן כתובת ה־IP שלכם מגיעה אליהם — כמו בכל אתר:',
    'Two service providers work for us. Your browser contacts them, so your IP address reaches them — as with any website:',
    'يعمل لصالحنا مزوّدا خدمة. يتصل متصفحكم بهما، لذا يصلهما عنوان الـIP الخاص بكم — كما في أي موقع:'),
  others: [
    { name: 'Vercel', text: t(
      'אחסון האתר. כל עמוד שאתם פותחים מגיע ממנה, והיא גם סופרת ביקורים באופן אנונימי (ראו "ספירת ביקורים").',
      'Hosts the site. Every page you open comes from it, and it also counts visits anonymously (see "Counting visits").',
      'تستضيف الموقع. كل صفحة تفتحونها تأتي منها، وهي أيضًا تعدّ الزيارات بشكل مجهول (انظروا "عدّ الزيارات").') },
    { name: 'Supabase', text: t(
      'מסד הנתונים וההתחברות שלנו. עמוד התפריט פונה אליה ישירות מהדפדפן שלכם כדי להציג את התפריט העדכני.',
      'Our database and sign-in. The menu page asks it directly, from your browser, for the up-to-date menu.',
      'قاعدة بياناتنا وتسجيل الدخول لدينا. تطلب منها صفحة القائمة مباشرة من متصفحكم القائمة المحدّثة.') },
  ] as { name: string; text: Text }[],
  othersNotes: [
    t('ספקים אלה אינם מציבים באתר עוגיות משלהם, מלבד עוגיות ההתחברות שברשימה למעלה.',
      'These providers set no cookies of their own on the site, apart from the sign-in cookies listed above.',
      'لا يضع هذان المزوّدان ملفات تعريف ارتباط خاصة بهما في الموقع، باستثناء ملفات تسجيل الدخول المذكورة أعلاه.'),
    t('ההתחברות עצמה מתבצעת בעמוד של Google, אליו עוברים רק אם בוחרים להתחבר. ל־Google מדיניות פרטיות משלה.',
      'Signing in itself happens on a Google page, which you only go to if you choose to sign in. Google has its own privacy policy.',
      'يتم تسجيل الدخول نفسه في صفحة تابعة لـ Google، لا تنتقلون إليها إلا إذا اخترتم تسجيل الدخول. ولدى Google سياسة خصوصية خاصة بها.'),
    t('קישורים החוצה — מפות, Waze, אינסטגרם, פייסבוק וביקורות — נפתחים רק כשלוחצים עליהם. לאתרים האלה עוגיות ומדיניות משלהם.',
      'Links out — maps, Waze, Instagram, Facebook and reviews — only open when you tap them. Those sites have their own cookies and policies.',
      'الروابط الخارجية — الخرائط وWaze وإنستغرام وفيسبوك والتقييمات — لا تُفتح إلا عند الضغط عليها. ولتلك المواقع ملفاتها وسياساتها الخاصة.'),
  ],

  deleteTitle: t('מחיקה', 'Deleting it', 'الحذف'),
  deleteBody: t(
    'אפשר למחוק את כל מה שהאתר שמר באחסון הדפדפן שלכם בלחיצה אחת. השפה והגדרות הנגישות יחזרו לברירת המחדל, והדף ייטען מחדש.',
    'You can delete everything the site stored in your browser’s storage with one press. Your language and accessibility settings go back to their defaults, and the page reloads.',
    'يمكنكم حذف كل ما حفظه الموقع في تخزين متصفحكم بضغطة واحدة. تعود اللغة وإعدادات إمكانية الوصول إلى الوضع الافتراضي وتُعاد تحميل الصفحة.'),
  deleteButton: t('מחיקת הנתונים השמורים במכשיר הזה', 'Delete the data stored on this device', 'حذف البيانات المحفوظة على هذا الجهاز'),
  deleteConfirmTitle: t('למחוק את הנתונים השמורים?', 'Delete the stored data?', 'حذف البيانات المحفوظة؟'),
  deleteConfirmBody: t(
    'רשימת ההזמנה, השפה והגדרות הנגישות יימחקו מהמכשיר הזה.',
    'Your order list, language and accessibility settings will be removed from this device.',
    'ستُحذف قائمة الطلب واللغة وإعدادات إمكانية الوصول من هذا الجهاز.'),
  deleteConfirmLabel: t('מחיקה', 'Delete', 'حذف'),
  deleteCancel: t('ביטול', 'Cancel', 'إلغاء'),
  deleteDone: t('נמחק. טוענים את הדף מחדש…', 'Deleted. Reloading the page…', 'تم الحذف. جارٍ إعادة تحميل الصفحة…'),
  cookiesNote: t(
    'עוגיות ההתחברות אינן נמחקות בכפתור הזה. הן נמחקות כשמתנתקים מהחשבון, או דרך הגדרות הדפדפן.',
    'The sign-in cookies are not removed by this button. They are removed when you sign out, or in your browser’s settings.',
    'لا يحذف هذا الزر ملفات تسجيل الدخول. تُحذف عند تسجيل الخروج من الحساب أو من إعدادات المتصفح.'),
  browserNote: t(
    'אפשר גם למחוק הכול דרך הגדרות הדפדפן (מחיקת נתוני אתרים).',
    'You can also delete everything in your browser’s settings (clear site data).',
    'يمكنكم أيضًا حذف كل شيء من إعدادات المتصفح (مسح بيانات المواقع).'),
}
