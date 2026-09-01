// Every string the cart shows, in all three languages the site speaks.
//
// House rule (CLAUDE.md → Conventions): a new user-facing string is added to
// `he`, `en` AND `ar` in the same edit, or it isn't added. Hebrew is primary;
// the other two are not afterthoughts, they are what a tourist at the bar
// actually reads.
//
// Kept as one flat object rather than per-component maps so that a missing
// translation is visible by reading down a column, which is how they get
// caught.

import type { Lang } from '@/lib/menu/types'

type Tri = { he: string; en: string; ar: string }

export const CART_UI = {
  // ── The cart itself ────────────────────────────────────────────────
  title:      { he: 'ההזמנה שלי',   en: 'My order',      ar: 'طلبي' },
  open:       { he: 'פתיחת ההזמנה', en: 'Open my order', ar: 'فتح الطلب' },
  close:      { he: 'סגירה',        en: 'Close',         ar: 'إغلاق' },
  empty:      { he: 'עוד לא הוספתם כלום.', en: 'Nothing added yet.', ar: 'لم تتم إضافة أي شيء بعد.' },
  /** For one diner's still-empty section — "nothing added yet" reads as a
   *  statement about the whole cart, which is wrong when three other people
   *  already have drinks. */
  nothingYet: { he: 'עדיין כלום',          en: 'Nothing yet',       ar: 'لا شيء بعد' },
  emptyHint: {
    he: 'הקישו על ״הוספה״ ליד פריט בתפריט כדי לבנות את ההזמנה.',
    en: 'Tap “Add” next to an item on the menu to build your order.',
    ar: 'اضغط على «إضافة» بجانب أي صنف في القائمة لبناء طلبك.',
  },

  // ── Adding ─────────────────────────────────────────────────────────
  add:        { he: 'הוספה',  en: 'Add',    ar: 'إضافة' },
  addOne:     { he: 'הוספת פריט אחד',  en: 'Add one',    ar: 'إضافة واحد' },
  removeOne:  { he: 'הסרת פריט אחד',   en: 'Remove one', ar: 'إزالة واحد' },
  inCart:     { he: 'בהזמנה', en: 'In order', ar: 'في الطلب' },
  soldOut:    { he: 'אזל מהמלאי', en: 'Sold out', ar: 'نفد' },

  // ── Diners ─────────────────────────────────────────────────────────
  table:      { he: 'לשולחן',       en: 'For the table', ar: 'للطاولة' },
  addDiner:   { he: 'הוספת סועד',   en: 'Add a diner',   ar: 'إضافة ضيف' },
  dinerName:  { he: 'שם הסועד',     en: 'Diner’s name',  ar: 'اسم الضيف' },
  dinerNameHint: {
    he: 'רק כדי לחלק את ההזמנה ביניכם. השם נשאר במכשיר שלכם.',
    en: 'Just to split the order between you. The name stays on your device.',
    ar: 'فقط لتقسيم الطلب بينكم. يبقى الاسم على جهازك.',
  },
  dinerNamePlaceholder: { he: 'דנה', en: 'Dana', ar: 'دانا' },
  renameDiner: { he: 'שינוי שם',     en: 'Rename',        ar: 'تغيير الاسم' },
  removeDiner: { he: 'הסרת סועד',    en: 'Remove diner',  ar: 'إزالة الضيف' },
  removeDinerBody: {
    he: 'הפריטים שלו יחזרו ל״לשולחן״ — שום דבר לא נמחק.',
    en: 'Their items move back to “For the table” — nothing is deleted.',
    ar: 'ستنتقل أصنافه إلى «للطاولة» — لن يُحذف أي شيء.',
  },
  addingFor:  { he: 'מוסיפים עבור',  en: 'Adding for',    ar: 'الإضافة لـ' },
  assignTo:   { he: 'שיוך הפריט',    en: 'Assign item',   ar: 'إسناد الصنف' },
  assignedTo: { he: 'משויך ל',       en: 'Assigned to',   ar: 'مُسند إلى' },
  dinersFull: { he: 'הגעתם למספר הסועדים המרבי.', en: 'You’ve reached the maximum number of diners.', ar: 'وصلت إلى الحد الأقصى لعدد الضيوف.' },
  dinerExists: { he: 'כבר יש סועד בשם הזה.', en: 'There’s already a diner with that name.', ar: 'يوجد ضيف بهذا الاسم بالفعل.' },

  // ── Choices ────────────────────────────────────────────────────────
  chooseSize:  { he: 'בחירת גודל', en: 'Choose a size', ar: 'اختر الحجم' },
  chooseHint:  { he: 'בחרו אפשרות אחת מכל קבוצה.', en: 'Pick one option from each group.', ar: 'اختر خياراً واحداً من كل مجموعة.' },
  forWhom:     { he: 'עבור מי?', en: 'For whom?', ar: 'لمن؟' },
  note:        { he: 'הערה',     en: 'Note',      ar: 'ملاحظة' },
  notePlaceholder: {
    he: 'בלי קרח, בצד…',
    en: 'No ice, on the side…',
    ar: 'بدون ثلج، على الجانب…',
  },
  noteAria:    { he: 'הערה לפריט', en: 'Note for this item', ar: 'ملاحظة لهذا الصنف' },
  noteEdit:    { he: 'עריכת הערה', en: 'Edit note',          ar: 'تعديل الملاحظة' },
  noteHint: {
    he: 'משהו שכדאי שהמלצר ידע על הפריט הזה.',
    en: 'Anything the waiter should know about this item.',
    ar: 'أي شيء يجب أن يعرفه النادل عن هذا الصنف.',
  },
  save:        { he: 'שמירה',     en: 'Save',      ar: 'حفظ' },
  quantity:    { he: 'כמות',      en: 'Quantity',  ar: 'الكمية' },
  addForTotal: { he: 'הוספה',     en: 'Add',       ar: 'إضافة' },
  cancel:      { he: 'ביטול',     en: 'Cancel',    ar: 'إلغاء' },

  // ── Money ──────────────────────────────────────────────────────────
  total:      { he: 'סה״כ',       en: 'Total',     ar: 'المجموع' },
  subtotal:   { he: 'סה״כ חלקי',  en: 'Subtotal',  ar: 'المجموع الجزئي' },
  priceOnChoice: {
    he: 'מחיר לפי בחירה — לא נכלל בסכום',
    en: 'Price depends on your choice — not included in the total',
    ar: 'السعر حسب الاختيار — غير محتسب في المجموع',
  },
  estimateNote: {
    he: 'הסכום להתרשמות בלבד. החשבון הרשמי הוא של הבר.',
    en: 'This total is for your reference only. The bar’s bill is the official one.',
    ar: 'هذا المجموع للاطلاع فقط. الفاتورة الرسمية هي فاتورة البار.',
  },

  // ── Clearing ───────────────────────────────────────────────────────
  clear:      { he: 'ניקוי',      en: 'Clear',     ar: 'مسح' },
  clearTitle: { he: 'לנקות את ההזמנה?', en: 'Clear your order?', ar: 'مسح الطلب؟' },
  clearBody:  {
    he: 'כל הפריטים והסועדים יימחקו מהמכשיר שלכם.',
    en: 'Every item and diner will be removed from your device.',
    ar: 'ستتم إزالة جميع الأصناف والضيوف من جهازك.',
  },
  clearConfirm: { he: 'ניקוי', en: 'Clear', ar: 'مسح' },
  removeLine:   { he: 'הסרת הפריט', en: 'Remove item', ar: 'إزالة الصنف' },

  // ── Reading it out to the waiter ───────────────────────────────────
  // The actual product of phase 1: you stop trying to remember four cocktail
  // names and who wanted what, and read this instead.
  showWaiter:  { he: 'הצגה למלצר',  en: 'Show to waiter', ar: 'اعرض للنادل' },
  readoutTitle:{ he: 'ההזמנה שלנו', en: 'Our order',      ar: 'طلبنا' },
  readoutHint: {
    he: 'הראו את המסך למלצר או הקריאו בקול.',
    en: 'Show this screen to the waiter, or read it out.',
    ar: 'اعرض هذه الشاشة على النادل أو اقرأها بصوت عالٍ.',
  },
  backToCart:  { he: 'חזרה לעריכה', en: 'Back to editing', ar: 'العودة للتحرير' },

  // ── Rounds ───────────────────────────────────────────────────
  markPresented: { he: 'הראיתי למלצר', en: 'Shown to the waiter', ar: 'عرضتُها على النادل' },
  presented:     { he: 'נמסר למלצר',  en: 'Given to the waiter', ar: 'أُعطي للنادل' },
  newRound:      { he: 'הזמנה חדשה',   en: 'New order',           ar: 'طلب جديد' },
  allPresented: {
    he: 'הכל נמסר למלצר. הוסיפו פריטים חדשים כדי להזמין שוב.',
    en: 'Everything has been given to the waiter. Add more items to order again.',
    ar: 'تم إعطاء كل شيء للنادل. أضف أصنافاً جديدة للطلب مرة أخرى.',
  },
  presentedHint: {
    he: 'הפריטים האלה כבר נמסרו. מה שתוסיפו מעכשיו יוצג בנפרד.',
    en: 'These have already been given. Anything you add now is shown separately.',
    ar: 'هذه الأصناف أُعطيت مسبقاً. ما تضيفه الآن يُعرض منفصلاً.',
  },
  showAll:  { he: 'הצגת כל ההזמנה', en: 'Show the whole order', ar: 'عرض الطلب كاملاً' },
  showRound:{ he: 'הצגת החדש בלבד',  en: 'Show only what is new', ar: 'عرض الجديد فقط' },

  // ── Ordering for several people at once ─────────────────────
  forWhomMulti: { he: 'עבור מי? אפשר לבחור כמה', en: 'For whom? You can pick several', ar: 'لمن؟ يمكنك اختيار عدة' },
  pickAtLeastOne: {
    he: 'בחרו לפחות אחד.',
    en: 'Pick at least one.',
    ar: 'اختر واحداً على الأقل.',
  },
  eachGets: { he: 'לכל אחד', en: 'each', ar: 'لكل واحد' },

  // ── The two things that don't work yet ─────────────────────────────
  sendToWaiter: { he: 'שליחה למלצר', en: 'Send to waiter', ar: 'إرسال للنادل' },
  callWaiter:   { he: 'קריאה למלצר', en: 'Call a waiter',  ar: 'استدعاء نادل' },
  soon:         { he: 'בקרוב',       en: 'Soon',           ar: 'قريباً' },
  soonHint: {
    he: 'בקרוב אפשר יהיה לשלוח את ההזמנה ולקרוא למלצר ישירות מכאן. בינתיים — הראו לו את הרשימה.',
    en: 'Sending your order and calling a waiter from here are coming soon. For now — just show them the list.',
    ar: 'إرسال الطلب واستدعاء النادل من هنا قريباً. في الوقت الحالي — اعرض القائمة عليه.',
  },

  // ── Transparency ───────────────────────────────────────────────────
  localOnly: {
    he: 'הרשימה נשמרת רק במכשיר שלכם ולא נשלחת לשום מקום.',
    en: 'This list is saved on your device only and is not sent anywhere.',
    ar: 'تُحفظ هذه القائمة على جهازك فقط ولا تُرسل إلى أي مكان.',
  },
} as const satisfies Record<string, Tri>

export type CartUiKey = keyof typeof CART_UI

/** One string, in the language currently on screen. */
export function t(key: CartUiKey, lang: Lang): string {
  return CART_UI[key][lang] ?? CART_UI[key].he
}
