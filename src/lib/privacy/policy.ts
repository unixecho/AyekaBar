import type { Lang } from '@/components/LanguageSwitch'

// The privacy policy's words — what the SERVER holds about a person (the /cookies page is the
// separate declaration of what is kept on the visitor's own device).
//
// Written from what the code does, and nothing more: every claim here is a thing a reader can
// find in the repo (customers / visit_logs / customer_feedback / the table-ordering tables,
// /api/customer/profile's export + delete, migration 050's retention). If the code changes, this
// changes with it.
//
// STILL NEEDED FROM THE OWNER (see HANDOFF): the legal name of the business that is "the
// controller", and a contact address for privacy requests. Until they exist the page says,
// truthfully, that requests go through the feedback box or the staff at the bar — it does not
// invent a company name or an email. Hebrew is the authoritative text; English and Arabic are
// translations nobody fluent has read yet.
//
// Lives apart from lib/privacy/notice.ts on purpose: only /privacy loads this, never the portal.

type L = Record<Lang, string>
export const PRIVACY_POLICY_UPDATED = '2026-10-17'

export const POLICY: {
  title: L; lead: L; updated: L; back: L
  sections: { title: L; paras?: L[]; bullets?: L[] }[]
  cookiesLink: L
} = {
  title: { he: 'מדיניות פרטיות', en: 'Privacy policy', ar: 'سياسة الخصوصية' },
  lead: {
    he: 'מה אנחנו שומרים עליך כשאת/ה משתמש/ת באתר של אייכה בר, למה, למשך כמה זמן, ומה אפשר לעשות עם זה.',
    en: 'What we keep about you when you use the Ayeka Bar website, why, for how long, and what you can do about it.',
    ar: 'ما نحتفظ به عنك عند استخدام موقع أيكا بار، ولماذا، ولكم من الوقت، وما يمكنك فعله حيال ذلك.',
  },
  updated: { he: 'עודכן לאחרונה:', en: 'Last updated:', ar: 'آخر تحديث:' },
  back: { he: 'חזרה לדף הבית', en: 'Back to the home page', ar: 'العودة إلى الصفحة الرئيسية' },
  cookiesLink: {
    he: 'מה נשמר על המכשיר שלך (עוגיות ואחסון)',
    en: 'What is stored on your device (cookies and storage)',
    ar: 'ما يُخزَّن على جهازك (ملفات تعريف الارتباط والتخزين)',
  },
  sections: [
    {
      title: { he: 'בקצרה', en: 'In short', ar: 'باختصار' },
      bullets: [
        { he: 'אפשר לגלוש באתר ולעיין בתפריט בלי להתחבר ובלי למסור שום פרט.', en: 'You can browse the site and read the menu without signing in and without giving any detail.', ar: 'يمكنك تصفح الموقع وقراءة القائمة دون تسجيل الدخول ودون تقديم أي بيانات.' },
        { he: 'אין באתר פרסומות ואין מעקב אחרי גולשים. אנחנו סופרים ביקורים בעמודים באופן אנונימי, בלי עוגיות ובלי לשמור דבר במכשיר שלך.', en: 'The site has no ads and does not track visitors. We count page visits anonymously, with no cookies and nothing stored on your device.', ar: 'لا يحتوي الموقع على إعلانات ولا يتتبّع الزوار. نعدّ زيارات الصفحات بشكل مجهول، دون ملفات تعريف ارتباط ودون تخزين أي شيء على جهازك.' },
        { he: 'איננו מוכרים ואיננו משתפים מידע עליך לצרכי פרסום.', en: 'We do not sell your information or share it for advertising.', ar: 'لا نبيع معلوماتك ولا نشاركها لأغراض الإعلان.' },
      ],
    },
    {
      title: { he: 'מי אנחנו', en: 'Who we are', ar: 'من نحن' },
      paras: [
        { he: 'האתר מופעל על ידי אייכה בר, חריש. המידע המתואר כאן נשמר עבור הבר ומשמש אותו בלבד.', en: 'The site is run by Ayeka Bar, Harish. The information described here is kept for the bar and used by it alone.', ar: 'يُشغَّل الموقع من قبل أيكا بار، حريش. المعلومات الموصوفة هنا تُحفظ للبار ولا يستخدمها غيره.' },
        { he: 'לבקשות בנושא פרטיות אפשר לפנות אלינו דרך תיבת המשוב בדף הבית, או לצוות בבר.', en: 'For privacy requests, use the feedback box on the home page, or ask the staff at the bar.', ar: 'لطلبات الخصوصية، استخدم صندوق الملاحظات في الصفحة الرئيسية أو اسأل طاقم البار.' },
      ],
    },
    {
      title: { he: 'איזה מידע נשמר, ומתי', en: 'What is kept, and when', ar: 'ما الذي يُحفظ ومتى' },
      bullets: [
        { he: 'גלישה ועיון בתפריט: לא נשמר עליך מידע אישי אצלנו. חברת האחסון של האתר שומרת יומני שרת רגילים (כמו כתובת IP) לצורכי אבטחה ותפעול.', en: 'Browsing and reading the menu: we keep no personal information about you. The company that hosts the site keeps ordinary server logs (such as the IP address) for security and operation.', ar: 'التصفح وقراءة القائمة: لا نحتفظ بأي معلومات شخصية عنك. الشركة المستضيفة للموقع تحتفظ بسجلات خادم عادية (مثل عنوان IP) لأغراض الأمان والتشغيل.' },
        { he: 'ספירת ביקורים: לכל ביקור בעמוד ציבורי נרשמים העמוד, הזמן, האתר שממנו הגעת, אזור גאוגרפי כללי, סוג המכשיר, מערכת ההפעלה והדפדפן — בלי שם, בלי דוא"ל ובלי קישור לכתובת ה-IP שלך. עמודי ההתחברות, האזור האישי, הצוות והבעלים אינם נספרים, ודפדפן ששולח "אל תעקבו" (Do Not Track) או Global Privacy Control אינו נספר.', en: 'Visit counting: for each visit to a public page we record the page, the time, the site you came from, a general region, the device type, the operating system and the browser — with no name, no email and no link to your IP address. The sign-in pages, the personal area and the staff and owner areas are not counted, and a browser that sends "Do Not Track" or Global Privacy Control is not counted.', ar: 'عدّ الزيارات: لكل زيارة لصفحة عامة يُسجَّل: الصفحة والوقت والموقع الذي جئت منه ومنطقة جغرافية عامة ونوع الجهاز ونظام التشغيل والمتصفح — دون اسم ودون بريد إلكتروني ودون ربط بعنوان الـIP الخاص بك. صفحات تسجيل الدخول والمنطقة الشخصية ومنطقتا الطاقم والمالك لا تُحتسب، والمتصفح الذي يرسل "عدم التتبّع" (Do Not Track) أو Global Privacy Control لا يُحتسب.' },
        { he: 'מועדון הנאמנות (רק אם התחברת עם Google): שם וכתובת דוא"ל מחשבון Google שלך (בלי סיסמה), מספר טלפון אם הוספת, נקודות, ביקורים (תאריך, שעה ומספר שולחן), מימושי הטבות, ופרטי הדפדפן בעת צ׳ק-אין.', en: 'The loyalty club (only if you sign in with Google): the name and email address of your Google account (never a password), a phone number if you add one, points, visits (date, time and table number), redeemed rewards, and your browser details at check-in.', ar: 'نادي الولاء (فقط إذا سجّلت الدخول عبر Google): الاسم والبريد الإلكتروني من حساب Google (وليس كلمة المرور)، ورقم الهاتف إن أضفته، والنقاط، والزيارات (التاريخ والوقت ورقم الطاولة)، والمكافآت المستبدلة، وبيانات المتصفح عند تسجيل الحضور.' },
        { he: 'תיבת המשוב: ההודעה שכתבת, כתובת דוא"ל אם בחרת להשאיר, והעמוד שבו היית. כתובת ה-IP שלך אינה נשמרת.', en: 'The feedback box: the message you wrote, an email address if you chose to leave one, and the page you were on. Your IP address is not stored.', ar: 'صندوق الملاحظات: الرسالة التي كتبتها، وبريدك الإلكتروني إن اخترت تركه، والصفحة التي كنت فيها. لا يُخزَّن عنوان IP الخاص بك.' },
        { he: 'הזמנה לשולחן (רק אם מלצר נתן לך קוד): חיבור זמני לשולחן, ובקשות ההזמנה והקריאות למלצר ששלחת.', en: 'Ordering at your table (only if a waiter gave you a code): a temporary link to the table, and the order requests and waiter calls you sent.', ar: 'الطلب إلى الطاولة (فقط إذا أعطاك النادل رمزًا): ارتباط مؤقت بالطاولة، وطلبات الطعام ونداءات النادل التي أرسلتها.' },
      ],
    },
    {
      title: { he: 'למה אנחנו משתמשים בו', en: 'What we use it for', ar: 'لماذا نستخدمها' },
      paras: [
        { he: 'כדי להפעיל את מועדון הנאמנות ולצבור לך נקודות, כדי לקרוא ולענות למשוב, וכדי שמלצר יוכל לקבל את ההזמנה ששלחת. לא לשום מטרה אחרת.', en: 'To run the loyalty club and add up your points, to read and answer feedback, and so a waiter can receive the order you sent. For nothing else.', ar: 'لتشغيل نادي الولاء وجمع نقاطك، ولقراءة الملاحظات والرد عليها، ولكي يستلم النادل الطلب الذي أرسلته. ولا لأي غرض آخر.' },
      ],
    },
    {
      title: { he: 'מי עוד מטפל במידע', en: 'Who else handles it', ar: 'من يتعامل معها أيضًا' },
      bullets: [
        { he: 'Supabase — מסד הנתונים וההתחברות. השרתים באיחוד האירופי (פרנקפורט).', en: 'Supabase — the database and sign-in. The servers are in the European Union (Frankfurt).', ar: 'Supabase — قاعدة البيانات وتسجيل الدخول. الخوادم في الاتحاد الأوروبي (فرانكفورت).' },
        { he: 'Vercel — אחסון האתר, וגם ספירת הביקורים האנונימית (Vercel Web Analytics).', en: 'Vercel — hosts the website, and also does the anonymous visit counting (Vercel Web Analytics).', ar: 'Vercel — استضافة الموقع، وأيضًا عدّ الزيارات المجهول (Vercel Web Analytics).' },
        { he: 'Google — רק כשאת/ה בוחר/ת להתחבר עם חשבון Google.', en: 'Google — only when you choose to sign in with a Google account.', ar: 'Google — فقط عندما تختار تسجيل الدخول بحساب Google.' },
      ],
    },
    {
      title: { he: 'כמה זמן זה נשמר', en: 'How long it is kept', ar: 'كم تُحفظ' },
      bullets: [
        { he: 'ספירת ביקורים: הסימן שמונע ספירה כפולה של אותו מבקר ביום אחד נמחק אחרי 24 שעות; מה שנשאר הוא סטטיסטיקה מצטברת על העמודים.', en: 'Visit counting: the mark that stops the same visitor being counted twice in a day is discarded after 24 hours; what remains is combined statistics about the pages.', ar: 'عدّ الزيارات: العلامة التي تمنع احتساب الزائر نفسه مرتين في اليوم تُحذف بعد 24 ساعة؛ وما يبقى إحصاءات مجمّعة عن الصفحات.' },
        { he: 'מועדון הנאמנות: כל עוד החשבון קיים. מחיקת החשבון מוחקת גם את הנקודות והביקורים.', en: 'The loyalty club: as long as the account exists. Deleting the account deletes the points and visits too.', ar: 'نادي الولاء: ما دام الحساب قائمًا. حذف الحساب يحذف النقاط والزيارات أيضًا.' },
        { he: 'משוב: כתובת הדוא"ל נמחקת אחרי 12 חודשים, וההודעה כולה אחרי 24 חודשים.', en: 'Feedback: the email address is erased after 12 months and the whole message after 24 months.', ar: 'الملاحظات: يُمحى البريد الإلكتروني بعد 12 شهرًا والرسالة كلها بعد 24 شهرًا.' },
        { he: 'חיבור לשולחן: נגמר אחרי שלוש שעות, או כשהמלצר מסיים את הביקור.', en: 'The table link: ends after three hours, or when the waiter ends the visit.', ar: 'الارتباط بالطاولة: ينتهي بعد ثلاث ساعات أو عندما ينهي النادل الزيارة.' },
      ],
    },
    {
      title: { he: 'הזכויות שלך', en: 'Your rights', ar: 'حقوقك' },
      paras: [
        { he: 'מי שנרשם למועדון יכול, באזור האישי, להוריד עותק מכל המידע שנשמר עליו, לתקן את פרטיו, ולמחוק את החשבון. המחיקה מיידית ואינה הפיכה. לכל בקשה אחרת — אפשר לפנות אלינו כמתואר למעלה.', en: 'A club member can, in their personal area, download a copy of everything kept about them, correct their details, and delete the account. Deletion is immediate and cannot be undone. For any other request, contact us as described above.', ar: 'يمكن لعضو النادي، من منطقته الشخصية، تنزيل نسخة من كل ما يُحفظ عنه، وتصحيح بياناته، وحذف الحساب. الحذف فوري ولا يمكن التراجع عنه. لأي طلب آخر، تواصل معنا كما هو موضح أعلاه.' },
      ],
    },
    {
      title: { he: 'אבטחה', en: 'Security', ar: 'الأمان' },
      paras: [
        { he: 'הגישה למידע מוגבלת לבעלים ולצוות המורשים, והתקשורת עם האתר מוצפנת. אין שיטה מושלמת, אבל אנחנו שומרים רק מה שצריך כדי לצמצם את הסיכון.', en: 'Access to the information is limited to the owner and authorised staff, and communication with the site is encrypted. No method is perfect, but we keep only what is needed, to keep the risk small.', ar: 'الوصول إلى المعلومات مقتصر على المالك والطاقم المخوّل، والاتصال بالموقع مشفّر. لا توجد طريقة مثالية، لكننا نحتفظ فقط بما يلزم لتقليل المخاطر.' },
      ],
    },
    {
      title: { he: 'שינויים', en: 'Changes', ar: 'التغييرات' },
      paras: [
        { he: 'אם נשנה את מה שנשמר או את השימוש בו, נעדכן כאן ואת התאריך למעלה. הנוסח העברי הוא המחייב.', en: 'If what we keep, or how we use it, changes, we will update this page and the date above. The Hebrew text is the authoritative one.', ar: 'إذا تغيّر ما نحتفظ به أو كيفية استخدامه، سنحدّث هذه الصفحة والتاريخ أعلاه. النص العبري هو المرجع.' },
      ],
    },
  ],
}
