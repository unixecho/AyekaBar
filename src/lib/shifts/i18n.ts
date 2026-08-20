// Every user-facing string in the module, in Hebrew, English and Arabic.
//
// The project rule is that a new string is added to all three languages at
// once, and the reliable way to enforce that is a single dictionary where a
// missing language is a type error rather than a missing translation someone
// notices in production. `t()` falls back he → en so a half-finished addition
// still renders something readable.

import type { AuditAction, Lang, Tri } from './types'
import type { WarningCode } from './rules'

export const S = {
  // ── shell ──
  title:            { he: 'סידור עבודה',        en: 'Schedule',            ar: 'جدول العمل' },
  managerTitle:     { he: 'ניהול סידור',        en: 'Schedule manager',    ar: 'إدارة الجدول' },
  staffTitle:       { he: 'המשמרות שלי',        en: 'My shifts',           ar: 'ورديّاتي' },
  back:             { he: 'חזרה',               en: 'Back',                ar: 'رجوع' },
  close:            { he: 'סגירה',              en: 'Close',               ar: 'إغلاق' },
  cancel:           { he: 'ביטול',              en: 'Cancel',              ar: 'إلغاء' },
  save:             { he: 'שמירה',              en: 'Save',                ar: 'حفظ' },
  saving:           { he: 'שומר…',              en: 'Saving…',             ar: 'جارٍ الحفظ…' },
  done:             { he: 'סיום',               en: 'Done',                ar: 'تم' },
  next:             { he: 'המשך',               en: 'Continue',            ar: 'متابعة' },
  add:              { he: 'הוספה',              en: 'Add',                 ar: 'إضافة' },
  remove:           { he: 'הסרה',               en: 'Remove',              ar: 'إزالة' },
  edit:             { he: 'עריכה',              en: 'Edit',                ar: 'تعديل' },
  optional:         { he: 'לא חובה',            en: 'Optional',            ar: 'اختياري' },

  // ── tabs ──
  tabWeek:          { he: 'שבוע',               en: 'Week',                ar: 'أسبوع' },
  tabWarnings:      { he: 'התראות',             en: 'Warnings',            ar: 'تنبيهات' },
  tabSettings:      { he: 'הגדרות',             en: 'Settings',            ar: 'إعدادات' },
  tabRequests:      { he: 'בקשות',              en: 'Requests',            ar: 'طلبات' },
  tabAudit:         { he: 'יומן',               en: 'Log',                 ar: 'سجل' },

  // ── week bar ──
  prevWeek:         { he: 'שבוע קודם',          en: 'Previous week',       ar: 'الأسبوع السابق' },
  nextWeek:         { he: 'שבוע הבא',           en: 'Next week',           ar: 'الأسبوع التالي' },
  thisWeek:         { he: 'השבוע',              en: 'This week',           ar: 'هذا الأسبوع' },
  draft:            { he: 'טיוטה',              en: 'Draft',               ar: 'مسودة' },
  published:        { he: 'פורסם',              en: 'Published',           ar: 'منشور' },
  hasChanges:       { he: 'יש שינויים שלא פורסמו', en: 'Unpublished changes', ar: 'تغييرات غير منشورة' },
  publish:          { he: 'פרסום הסידור',       en: 'Publish schedule',    ar: 'نشر الجدول' },
  republish:        { he: 'פרסום מחדש',         en: 'Publish changes',     ar: 'إعادة النشر' },
  publishing:       { he: 'מפרסם…',             en: 'Publishing…',         ar: 'جارٍ النشر…' },
  unpublish:        { he: 'החזרה לטיוטה',       en: 'Return to draft',     ar: 'إرجاع لمسودة' },
  draftHint:        { he: 'הצוות לא רואה כלום עד הפרסום.', en: 'Staff see nothing until you publish.', ar: 'لا يرى الطاقم شيئًا حتى النشر.' },
  publishedHint:    { he: 'הצוות רואה את הגרסה שפורסמה.', en: 'Staff see the published version.', ar: 'يرى الطاقم النسخة المنشورة.' },
  version:          { he: 'גרסה',               en: 'Version',             ar: 'إصدار' },

  // ── builder ──
  addShift:         { he: 'הוספת משמרת',        en: 'Add shift',           ar: 'إضافة وردية' },
  emptyDay:         { he: 'אין משמרות',         en: 'No shifts',           ar: 'لا ورديات' },
  closedDay:        { he: 'סגור',               en: 'Closed',              ar: 'مغلق' },
  assign:           { he: 'שיבוץ עובד/ת',       en: 'Assign someone',      ar: 'إسناد موظف' },
  unassigned:       { he: 'לא מאויש',           en: 'Unstaffed',           ar: 'غير مأهول' },
  station:          { he: 'עמדה',               en: 'Station',             ar: 'محطة' },
  noStation:        { he: 'ללא עמדה',           en: 'No station',          ar: 'بدون محطة' },
  role:             { he: 'תפקיד',              en: 'Role',                ar: 'دور' },
  requirements:     { he: 'תקן משמרת',          en: 'Required roles',      ar: 'الأدوار المطلوبة' },
  shiftNote:        { he: 'הערה למשמרת',        en: 'Shift note',          ar: 'ملاحظة الوردية' },
  dayNote:          { he: 'הערה ליום',          en: 'Day note',            ar: 'ملاحظة اليوم' },
  notePlaceholder:  { he: 'למשל: אספקה ב-19:00, ספירת מלאי בסגירה', en: 'e.g. delivery at 19:00, stock count at close', ar: 'مثال: توريد الساعة 19:00' },
  hours:            { he: 'שעות',               en: 'hours',               ar: 'ساعات' },
  weekHours:        { he: 'שעות השבוע',         en: 'Hours this week',     ar: 'ساعات الأسبوع' },
  preset:           { he: 'תבנית',              en: 'Preset',              ar: 'قالب' },
  customShift:      { he: 'משמרת מותאמת',       en: 'Custom shift',        ar: 'وردية مخصصة' },
  startTime:        { he: 'משעה',               en: 'From',                ar: 'من' },
  endTime:          { he: 'עד שעה',             en: 'Until',               ar: 'حتى' },
  overnight:        { he: 'המשמרת נמשכת אחרי חצות', en: 'Runs past midnight', ar: 'تمتد بعد منتصف الليل' },
  copyLastWeek:     { he: 'העתקת השבוע הקודם',  en: 'Copy last week',      ar: 'نسخ الأسبوع الماضي' },
  clearWeek:        { he: 'ניקוי השבוע',        en: 'Clear the week',      ar: 'مسح الأسبوع' },
  clearWeekBody:    { he: 'כל המשמרות והשיבוצים בשבוע הזה יימחקו מהטיוטה.', en: 'Every shift and assignment in this week is removed from the draft.', ar: 'ستُحذف كل الورديات والإسنادات من المسودة.' },
  deleteShift:      { he: 'מחיקת המשמרת',       en: 'Delete shift',        ar: 'حذف الوردية' },
  deleteShiftBody:  { he: 'המשמרת והשיבוצים שלה יימחקו.', en: 'The shift and its assignments are removed.', ar: 'ستُحذف الوردية وإسناداتها.' },
  noStaff:          { he: 'אין עובדים פעילים ברשימה', en: 'No active staff on the roster', ar: 'لا يوجد طاقم فعّال' },

  // ── warnings ──
  warnings:         { he: 'התראות',             en: 'Warnings',            ar: 'تنبيهات' },
  noWarnings:       { he: 'הסידור נקי — אין התראות.', en: 'The week is clean — no warnings.', ar: 'الجدول سليم — لا تنبيهات.' },
  errorsLabel:      { he: 'שגיאות',             en: 'Errors',              ar: 'أخطاء' },
  warnsLabel:       { he: 'אזהרות',             en: 'Warnings',            ar: 'تنبيهات' },
  infosLabel:       { he: 'הערות',              en: 'Notes',               ar: 'ملاحظات' },
  publishAnyway:    { he: 'פרסום בכל זאת',      en: 'Publish anyway',      ar: 'انشر رغم ذلك' },
  publishWithErrors:{ he: 'לפרסם עם שגיאות?',   en: 'Publish with errors?', ar: 'النشر مع وجود أخطاء؟' },
  publishErrorsBody:{ he: 'יש שגיאות פתוחות בסידור. אפשר לפרסם — רק תדע/י מה יוצא לצוות.', en: 'This week still has errors. You can publish — just know what the team is getting.', ar: 'ما زالت هناك أخطاء. يمكنك النشر — لكن اعرف ما سيصل للطاقم.' },
  andNMoreErrors:   { he: 'ועוד {n} שגיאות',     en: 'and {n} more',        ar: 'و{n} أخرى' },
  showInfoNotices:  { he: 'הצגת הערות מידע',     en: 'Show info notices',   ar: 'إظهار ملاحظات إعلامية' },
  showDismissed:    { he: 'הצגת {n} התראות מוסתרות', en: 'Show {n} dismissed', ar: 'إظهار {n} مخفية' },
  hideDismissed:    { he: 'הסתרת התראות מוסתרות', en: 'Hide dismissed',     ar: 'إخفاء المخفية' },
  dismissedSectionTitle: { he: 'התראות מוסתרות', en: 'Dismissed',          ar: 'مخفية' },
  dismiss:          { he: 'הסתרה',               en: 'Dismiss',             ar: 'إخفاء' },
  restore:          { he: 'שחזור',               en: 'Restore',             ar: 'استعادة' },
  warningSensitivity:     { he: 'רגישות התראות', en: 'Warning sensitivity', ar: 'حساسية التنبيهات' },
  warningSensitivityHint: { he: 'סוגי התראה שכבויים כאן לא יוצגו יותר, בשום שבוע — לצמיתות, עד שיופעלו מחדש.', en: 'A warning type turned off here stops appearing entirely, in every week — permanently, until switched back on.', ar: 'نوع التنبيه المُطفأ هنا لن يظهر بعد الآن، في أي أسبوع — بشكل دائم حتى إعادة تفعيله.' },

  // ── settings / onboarding ──
  setupTitle:       { he: 'הקמת הסידור',        en: 'Schedule setup',      ar: 'إعداد الجدول' },
  setupIntro:       { he: 'כמה שאלות קצרות, ואפשר להתחיל לשבץ. הכל ניתן לשינוי בכל רגע מההגדרות.', en: 'A few short questions and you can start scheduling. Everything stays editable in Settings.', ar: 'أسئلة قصيرة ثم يمكنك البدء. كل شيء قابل للتعديل لاحقًا.' },
  stepDays:         { he: 'ימי פעילות',         en: 'Working days',        ar: 'أيام العمل' },
  stepDaysHint:     { he: 'באילו ימים הבר פתוח.', en: 'Which days the bar is open.', ar: 'الأيام التي يفتح فيها البار.' },
  stepHours:        { he: 'שעות פעילות',        en: 'Operating hours',     ar: 'ساعات العمل' },
  stepHoursHint:    { he: 'שעת פתיחה וסגירה. סגירה מוקדמת מהפתיחה נחשבת אחרי חצות.', en: 'Opening and closing time. A close earlier than the open means after midnight.', ar: 'وقت الفتح والإغلاق. إغلاق أبكر من الفتح يعني بعد منتصف الليل.' },
  dayHoursTitle:    { he: 'שעות מותאמות לפי יום', en: 'Custom hours per day', ar: 'ساعات مخصصة لكل يوم' },
  dayHoursHint:     { he: 'שישי ושבת בדרך כלל קצרים יותר — אפשר להתאים כל יום בנפרד; ימים שלא הותאמו משתמשים בשעות הכלליות למעלה.', en: 'Friday and Saturday usually run shorter — override any day on its own; a day left alone uses the general hours above.', ar: 'الجمعة والسبت عادة أقصر — يمكن تخصيص أي يوم؛ الأيام غير المخصصة تستخدم الساعات العامة أعلاه.' },
  dayHoursCustom:   { he: 'שעות מותאמות',        en: 'Custom hours',        ar: 'ساعات مخصصة' },
  dayHoursDefault:  { he: 'כברירת מחדל',         en: 'Using default',      ar: 'الافتراضي' },
  stepPresets:      { he: 'תבניות משמרת',       en: 'Shift presets',       ar: 'قوالب الورديات' },
  stepPresetsHint:  { he: 'המשמרות הקבועות שלך — ערב, לילה, הכנה. הן הופכות ללחיצה אחת בבניית השבוע.', en: 'Your recurring shifts — evening, night, prep. Each becomes one tap when building a week.', ar: 'ورديّاتك المتكررة. كل واحدة تصبح نقرة واحدة.' },
  stepRoles:        { he: 'תפקידים',            en: 'Roles',               ar: 'الأدوار' },
  stepRolesHint:    { he: 'התפקידים שמשובצים במשמרת, ומה התקן שלהם.', en: 'The roles you staff a shift with, and how many of each.', ar: 'الأدوار في الوردية وعدد كل منها.' },
  stepStations:     { he: 'עמדות',              en: 'Stations',            ar: 'المحطات' },
  stepStationsHint: { he: 'איפה עומדים — בר ראשי, פטיו, סגירה.', en: 'Where people stand — main bar, patio, closing prep.', ar: 'أين يقف الطاقم — البار، الفناء، الإغلاق.' },

  // ── catalog editors (shift types / roles / stations) ──
  quickStartRoles:  { he: 'התחלה מהירה — תפקידים נפוצים בלחיצה אחת. את/ה יכול/ה להוסיף, לשנות שם ולמחוק כל תפקיד למטה.', en: 'Quick start — common roles, one tap each. Add, rename, or delete any role below.', ar: 'بداية سريعة — أدوار شائعة بنقرة واحدة. أضف أو أعد التسمية أو احذف أي دور أدناه.' },
  newPreset:        { he: 'משמרת חדשה',         en: 'New shift type',      ar: 'نوع وردية جديد' },
  newRole:          { he: 'תפקיד חדש',          en: 'New role',            ar: 'دور جديد' },
  newStation:       { he: 'עמדה חדשה',          en: 'New station',         ar: 'محطة جديدة' },
  addPreset:        { he: 'הוספת סוג משמרת',    en: 'Add a shift type',    ar: 'إضافة نوع وردية' },
  addRole:          { he: 'הוספת תפקיד',        en: 'Add a role',          ar: 'إضافة دور' },
  addStation:       { he: 'הוספת עמדה',         en: 'Add a station',       ar: 'إضافة محطة' },
  color:            { he: 'צבע',                en: 'Colour',              ar: 'اللون' },
  defaultStation:   { he: 'עמדת ברירת מחדל',    en: 'Default station',     ar: 'المحطة الافتراضية' },
  staffingNeeded:   { he: 'תקן איוש',           en: 'Staffing needed',     ar: 'التوظيف المطلوب' },
  noRolesYet:       { he: 'אין עדיין תפקידים מוגדרים — הוסיפו למטה תחת "תפקידים".', en: 'No roles defined yet — add some under "Roles" below.', ar: 'لا توجد أدوار بعد — أضف تحت "الأدوار" أدناه.' },
  linkedBadge:      { he: 'תפקיד מקושר בצוות',  en: 'Linked staff title',  ar: 'اللقب المرتبط بالطاقم' },
  noBadgeLink:      { he: 'ללא קישור',          en: 'No link',             ar: 'بدون ربط' },
  restrictToRoles:  { he: 'הגבלה לתפקידים',     en: 'Restrict to roles',   ar: 'تقييد بالأدوار' },
  noRoleRestriction:{ he: 'פתוח לכל התפקידים',  en: 'Open to every role',  ar: 'مفتوح لكل الأدوار' },
  deletePresetImpact:{ he: '{n} משמרות בשבועות המוצגים כרגע נוצרו מהתבנית הזו — הן יישארו, רק בלי הקישור לתבנית.', en: '{n} shifts in the weeks currently shown were created from this type — they will stay, just without the link back to it.', ar: '{n} وردية في الأسابيع المعروضة أُنشئت من هذا النوع — ستبقى، فقط دون الربط بالنوع.' },
  deleteRoleImpact: { he: '{n} שיבוצים/תקנים בשבועות המוצגים כרגע מתייחסים לתפקיד הזה — הם יסומנו כתפקיד שהוסר.', en: '{n} assignments/requirements in the weeks currently shown reference this role — they will show as a removed role.', ar: '{n} إسناد/متطلب في الأسابيع المعروضة يشير لهذا الدور — سيظهر كدور محذوف.' },
  deleteStationImpact:{ he: '{n} משמרות בשבועות המוצגים כרגע מוגדרות עם העמדה הזו — הן יישארו, רק בלי עמדה.', en: '{n} shifts in the weeks currently shown are set to this station — they will stay, just without a station.', ar: '{n} وردية في الأسابيع المعروضة محددة بهذه المحطة — ستبقى، فقط دون محطة.' },
  deleteNoImpact:   { he: 'שום דבר בשבועות המוצגים כרגע לא מתייחס לזה.', en: 'Nothing in the weeks currently shown references this.', ar: 'لا شيء في الأسابيع المعروضة يشير لهذا.' },
  removedRole:      { he: 'תפקיד שהוסר',        en: 'Removed role',        ar: 'دور محذوف' },
  langHebrew:       { he: 'עברית',              en: 'Hebrew',              ar: 'العبرية' },
  langEnglish:      { he: 'אנגלית',             en: 'English',             ar: 'الإنجليزية' },
  langArabic:       { he: 'ערבית',              en: 'Arabic',              ar: 'العربية' },
  willShowAs:       { he: 'יוצג בתור:',          en: 'Will show as:',       ar: 'سيظهر باسم:' },
  stepSafety:       { he: 'כללי בטיחות',        en: 'Safety rules',        ar: 'قواعد السلامة' },
  stepSafetyHint:   { he: 'הגבולות שהמערכת תתריע עליהם. היא מתריעה, לא חוסמת.', en: 'The limits the system flags. It warns, it never blocks.', ar: 'الحدود التي ينبّه عليها النظام. ينبّه ولا يمنع.' },
  stepFeatures:     { he: 'יכולות נוספות',      en: 'Optional features',   ar: 'ميزات إضافية' },
  setupDone:        { he: 'הכל מוכן',           en: 'All set',             ar: 'كل شيء جاهز' },
  setupDoneHint:    { he: 'אפשר לבנות את השבוע הראשון. ההגדרות פתוחות לשינוי תמיד.', en: 'Build your first week. Settings stay open for changes forever.', ar: 'ابدأ أسبوعك الأول. الإعدادات تبقى قابلة للتعديل.' },
  startBuilding:    { he: 'לבניית הסידור',      en: 'Start scheduling',    ar: 'ابدأ الجدولة' },
  rerunSetup:       { he: 'הרצת ההקמה מחדש',    en: 'Run setup again',     ar: 'إعادة الإعداد' },

  maxWeeklyHours:   { he: 'מקסימום שעות שבועיות לעובד/ת', en: 'Max weekly hours per employee', ar: 'أقصى ساعات أسبوعية للموظف' },
  minRestHours:     { he: 'מנוחה מינימלית בין משמרות',   en: 'Minimum rest between shifts',   ar: 'أدنى راحة بين الورديات' },
  maxDailyHours:    { he: 'מקסימום שעות במשמרת אחת',     en: 'Max hours in one shift',        ar: 'أقصى ساعات في وردية' },
  maxConsecutive:   { he: 'מקסימום ימים ברצף',           en: 'Max consecutive days',          ar: 'أقصى أيام متتالية' },
  hoursUnit:        { he: 'ש׳',                 en: 'h',                   ar: 'س' },
  daysUnit:         { he: 'ימים',               en: 'days',                ar: 'أيام' },

  featureAvailability:     { he: 'הגשת זמינות',   en: 'Availability submissions', ar: 'تقديم التوفر' },
  featureAvailabilityHint: { he: 'עובדים מגישים אילוצים לשבוע הבא לפני שבונים את הסידור.', en: 'Staff submit constraints for the coming week before you build it.', ar: 'يقدّم الطاقم قيودهم للأسبوع القادم قبل بناء الجدول.' },
  featureSwaps:            { he: 'החלפות משמרת', en: 'Shift swaps',              ar: 'تبديل الورديات' },
  featureSwapsHint:        { he: 'עובדים מציעים משמרת להחלפה, עמית מסכים, והמנהל מאשר.', en: 'Staff offer a shift, a peer takes it, the manager approves.', ar: 'يعرض الموظف وردية، يقبلها زميل، ويوافق المدير.' },
  delegation:              { he: 'הרשאות סידור', en: 'Schedule access',          ar: 'صلاحيات الجدول' },
  delegationHint:          { he: 'הסידור באחריות המנהל/ת הכללי/ת. אפשר להעביר את ההרשאה גם לאחראי/ת משמרת מסוים/ת.', en: 'Scheduling belongs to the general manager. You can hand it to a specific shift manager as well.', ar: 'الجدولة مسؤولية المدير العام. يمكن منحها لمسؤول وردية بعينه.' },
  delegated:               { he: 'רשאי/ת לנהל',  en: 'Can manage',               ar: 'يمكنه الإدارة' },
  byRole:                  { he: 'לפי תפקיד',    en: 'By role',                  ar: 'حسب الدور' },
  rosterTitle:             { he: 'צוות וסידור', en: 'Team & scheduling',        ar: 'الطاقم والجدولة' },
  rosterHint:              { he: 'כל מי שברשימת הצוות. סמנו מי זמין/ה לשיבוץ בסידור, ולמי יש הרשאה לבנות ולפרסם אותו.', en: 'Everyone on the staff list. Mark who can be scheduled, and who may build and publish the schedule.', ar: 'كل من في قائمة الطاقم. حدّد من يمكن جدولته، ومن يملك صلاحية بناء الجدول ونشره.' },
  schedulableLabel:        { he: 'בסידור',       en: 'Schedulable',              ar: 'قابل للجدولة' },
  pendingBadge:            { he: 'ממתין/ה לכניסה ראשונה', en: 'Awaiting first sign-in', ar: 'بانتظار أول تسجيل دخول' },
  noOneSchedulableYet:     { he: 'אף אחד עדיין לא מסומן/ת כזמין/ה לסידור — הסידור לא יוכל להיבנות עד שיסומנו אנשי צוות כאן.', en: 'Nobody is marked schedulable yet — the schedule can\'t be built until people are opted in here.', ar: 'لا أحد محدَّد كقابل للجدولة بعد — لا يمكن بناء الجدول حتى يتم تفعيل أفراد الطاقم هنا.' },

  // ── staff view ──
  notPublished:     { he: 'הסידור לשבוע הזה עוד לא פורסם.', en: 'This week has not been published yet.', ar: 'لم يُنشر جدول هذا الأسبوع بعد.' },
  onlyMine:         { he: 'רק שלי',             en: 'Mine',                ar: 'ورديّاتي' },
  everyone:         { he: 'כל הצוות',           en: 'Everyone',            ar: 'الجميع' },
  withYou:          { he: 'איתך במשמרת',        en: 'On shift with you',   ar: 'معك في الوردية' },
  noShiftsForYou:   { he: 'אין לך משמרות בשבוע הזה.', en: 'You have no shifts this week.', ar: 'لا ورديات لك هذا الأسبوع.' },

  // ── availability ──
  availability:     { he: 'הגשת זמינות',        en: 'Availability',        ar: 'التوفر' },
  availabilityIntro:{ he: 'סמן/י ימים שבהם אינך זמין/ה, או שעות שבהן כן. המנהל/ת רואה את זה בזמן בניית הסידור.', en: 'Mark days you cannot work, or the hours you can. The manager sees this while building the week.', ar: 'حدّد الأيام غير المتاحة أو الساعات المتاحة.' },
  available:        { he: 'זמין/ה',             en: 'Available',           ar: 'متاح' },
  unavailable:      { he: 'לא זמין/ה',          en: 'Unavailable',         ar: 'غير متاح' },
  prefer:           { he: 'מעדיף/ה לעבוד',      en: 'Prefer to work',      ar: 'أفضّل العمل' },
  partial:          { he: 'חלקית',              en: 'Partly',              ar: 'جزئيًا' },
  submitAvailability:{ he: 'הגשה',              en: 'Submit',              ar: 'إرسال' },
  submitted:        { he: 'הוגש',               en: 'Submitted',           ar: 'أُرسل' },
  resubmit:         { he: 'עדכון ההגשה',        en: 'Update submission',   ar: 'تحديث الإرسال' },
  featureOff:       { he: 'היכולת הזו כבויה בהגדרות.', en: 'This feature is switched off in Settings.', ar: 'هذه الميزة مُطفأة في الإعدادات.' },

  // ── swaps ──
  swaps:            { he: 'החלפות',             en: 'Swaps',               ar: 'التبديلات' },
  requestSwap:      { he: 'בקשת החלפה',         en: 'Request a swap',      ar: 'طلب تبديل' },
  offerToAll:       { he: 'הצעה לכל הצוות',     en: 'Offer to everyone',   ar: 'عرض للجميع' },
  offerTo:          { he: 'הצעה ל…',            en: 'Offer to…',           ar: 'عرض لـ…' },
  swapReason:       { he: 'סיבה',               en: 'Reason',              ar: 'السبب' },
  swapOpen:         { he: 'ממתין לעמית/ה',      en: 'Waiting for a peer',  ar: 'بانتظار زميل' },
  swapPeerAccepted: { he: 'ממתין לאישור מנהל/ת', en: 'Waiting for manager', ar: 'بانتظار المدير' },
  swapApproved:     { he: 'אושר',               en: 'Approved',            ar: 'مُعتمد' },
  swapRejected:     { he: 'נדחה',               en: 'Rejected',            ar: 'مرفوض' },
  swapCancelled:    { he: 'בוטל',               en: 'Cancelled',           ar: 'أُلغي' },
  takeShift:        { he: 'אני לוקח/ת',         en: 'I’ll take it',        ar: 'سآخذها' },
  approve:          { he: 'אישור',              en: 'Approve',             ar: 'اعتماد' },
  reject:           { he: 'דחייה',              en: 'Reject',              ar: 'رفض' },
  noSwaps:          { he: 'אין בקשות פתוחות.',  en: 'No open requests.',   ar: 'لا طلبات مفتوحة.' },

  // ── audit ──
  auditTitle:       { he: 'יומן שינויים',       en: 'Change log',          ar: 'سجل التغييرات' },
  noAudit:          { he: 'עוד לא נרשמו שינויים.', en: 'Nothing logged yet.', ar: 'لا تغييرات مسجلة.' },

  // ── print ──
  print:            { he: 'הדפסה / PDF',        en: 'Print / PDF',         ar: 'طباعة / PDF' },
  printHint:        { he: 'תצוגת הדפסה נקייה לתלייה מאחורי הבר.', en: 'A clean sheet to post behind the bar.', ar: 'ورقة نظيفة للتعليق خلف البار.' },
  printedOn:        { he: 'הודפס',              en: 'Printed',             ar: 'طُبع' },
  openPrint:        { he: 'פתיחת חלון ההדפסה',  en: 'Open print dialog',   ar: 'فتح نافذة الطباعة' },

  // ── prototype ──
  prototype:        { he: 'אב־טיפוס',           en: 'Prototype',           ar: 'نموذج أولي' },
  prototypeHint:    { he: 'נתוני הדגמה בדפדפן בלבד — שום דבר לא נשמר בבסיס הנתונים.', en: 'Demo data in this browser only — nothing is written to the database.', ar: 'بيانات تجريبية في المتصفح فقط.' },
  resetDemo:        { he: 'איפוס נתוני הדגמה',  en: 'Reset demo data',     ar: 'إعادة تعيين البيانات' },
  resetDemoBody:    { he: 'הנתונים המקומיים יימחקו והדגמה תיטען מחדש.', en: 'Local demo data is cleared and reseeded.', ar: 'ستُمسح البيانات المحلية ويُعاد تحميل العرض.' },
} satisfies Record<string, Tri>

export type StringKey = keyof typeof S

export function t(key: StringKey, lang: Lang): string {
  const entry = S[key] as Tri
  return entry[lang] || entry.he || entry.en
}

/** Audit vocabulary, rendered for the log view. */
export const AUDIT_LABELS: Record<AuditAction, Tri> = {
  'settings.update':      { he: 'עדכון הגדרות',        en: 'Settings updated',     ar: 'تحديث الإعدادات' },
  'onboarding.complete':  { he: 'סיום הקמה',           en: 'Setup completed',      ar: 'اكتمل الإعداد' },
  'week.create':          { he: 'פתיחת שבוע',          en: 'Week created',         ar: 'إنشاء أسبوع' },
  'week.publish':         { he: 'פרסום סידור',         en: 'Schedule published',   ar: 'نشر الجدول' },
  'week.unpublish':       { he: 'החזרה לטיוטה',        en: 'Returned to draft',    ar: 'إرجاع لمسودة' },
  'member.update':        { he: 'עדכון סידור צוות',    en: 'Roster updated',       ar: 'تحديث الجدولة' },
  'warning.dismiss':      { he: 'הסתרת התראה',        en: 'Warning dismissed',    ar: 'إخفاء تنبيه' },
  'shift.create':         { he: 'יצירת משמרת',         en: 'Shift created',        ar: 'إنشاء وردية' },
  'shift.update':         { he: 'עדכון משמרת',         en: 'Shift updated',        ar: 'تحديث وردية' },
  'shift.delete':         { he: 'מחיקת משמרת',         en: 'Shift deleted',        ar: 'حذف وردية' },
  'assignment.create':    { he: 'שיבוץ',               en: 'Assigned',             ar: 'إسناد' },
  'assignment.delete':    { he: 'ביטול שיבוץ',         en: 'Unassigned',           ar: 'إلغاء إسناد' },
  'note.update':          { he: 'עדכון הערה',          en: 'Note updated',         ar: 'تحديث ملاحظة' },
  'availability.submit':  { he: 'הגשת זמינות',         en: 'Availability submitted', ar: 'إرسال التوفر' },
  'swap.request':         { he: 'בקשת החלפה',          en: 'Swap requested',       ar: 'طلب تبديل' },
  'swap.peer_accept':     { he: 'עמית/ה לקח/ה משמרת',  en: 'Peer accepted',        ar: 'قبول زميل' },
  'swap.approve':         { he: 'אישור החלפה',         en: 'Swap approved',        ar: 'اعتماد التبديل' },
  'swap.reject':          { he: 'דחיית החלפה',         en: 'Swap rejected',        ar: 'رفض التبديل' },
  'swap.cancel':          { he: 'ביטול בקשה',          en: 'Request cancelled',    ar: 'إلغاء الطلب' },
}

/** Generic per-code labels — for the warnings panel's group headers and the
 *  severity settings panel. Distinct from a `Warning.message`, which is
 *  generated per-instance with real context ("2 × Bartender missing on the
 *  18:00 shift"); this is just "what kind of thing is this", the same job
 *  AUDIT_LABELS does for the audit log. */
export const WARNING_LABELS: Record<WarningCode, Tri> = {
  overlap:               { he: 'חפיפת משמרות',           en: 'Overlapping shifts',        ar: 'تداخل الورديات' },
  duplicate:             { he: 'שיבוץ כפול',             en: 'Duplicate assignment',       ar: 'إسناد مكرر' },
  min_rest:              { he: 'מנוחה לא מספקת',         en: 'Insufficient rest',          ar: 'راحة غير كافية' },
  max_weekly_hours:      { he: 'חריגה משעות שבועיות',    en: 'Over weekly hours',          ar: 'تجاوز الساعات الأسبوعية' },
  max_daily_hours:       { he: 'משמרת ארוכה מדי',        en: 'Shift too long',             ar: 'وردية طويلة جدًا' },
  max_consecutive_days:  { he: 'ימים רצופים רבים מדי',   en: 'Too many consecutive days',  ar: 'أيام متتالية كثيرة جدًا' },
  missing_role:          { he: 'חסר בתקן',               en: 'Understaffed role',          ar: 'نقص في الدور' },
  over_role_max:         { he: 'חריגה מהתקן',            en: 'Over the role cap',          ar: 'تجاوز حد الدور' },
  unassigned_shift:      { he: 'משמרת ללא איוש',         en: 'Unstaffed shift',            ar: 'وردية بدون طاقم' },
  unavailable:           { he: 'התנגשות עם אי-זמינות',   en: 'Conflicts with unavailability', ar: 'تعارض مع عدم التوفر' },
  partial_conflict:      { he: 'התנגשות חלקית עם זמינות', en: 'Partial availability conflict', ar: 'تعارض جزئي مع التوفر' },
  non_working_day:       { he: 'יום סגור',               en: 'Non-working day',            ar: 'يوم إغلاق' },
  outside_hours:         { he: 'מחוץ לשעות הפעילות',     en: 'Outside operating hours',    ar: 'خارج ساعات العمل' },
  inactive_staff:        { he: 'עובד/ת לא פעיל/ה בסידור', en: 'Not schedulable',           ar: 'غير قابل للجدولة' },
  unknown_role:          { he: 'תפקיד שהוסר',            en: 'Removed role',               ar: 'دور محذوف' },
}
