// Trilingual strings for the accessibility widget's own panel. Same flat
// `{ key: { he, en, ar } }` shape as lib/cart/i18n.ts and lib/feedback/i18n.ts
// — one column-scan catches a missing language, matching house convention.
// check-a11y.mjs fails the build if any key is missing a language.

import type { Lang } from '@/lib/menu/types'

export const A11Y_UI: Record<string, Record<Lang, string>> = {
  title: { he: 'נגישות האתר', en: 'Accessibility', ar: 'إمكانية الوصول' },
  openLabel: { he: 'פתיחת אפשרויות נגישות', en: 'Open accessibility options', ar: 'فتح خيارات إمكانية الوصول' },
  intro: {
    he: 'הגדרות תצוגה אישיות לביקור הזה. אינן מחליפות את הנגישות של האתר עצמו.',
    en: 'Personal display settings for this visit. They do not replace the site’s own accessibility.',
    ar: 'إعدادات عرض شخصية لهذه الزيارة. لا تحل محل إمكانية وصول الموقع نفسه.',
  },
  close: { he: 'סגירה', en: 'Close', ar: 'إغلاق' },
  reset: { he: 'איפוס הגדרות', en: 'Reset settings', ar: 'إعادة ضبط الإعدادات' },

  textSection: { he: 'טקסט וקריאות', en: 'Text & readability', ar: 'النص وسهولة القراءة' },
  fontScale: { he: 'גודל טקסט', en: 'Text size', ar: 'حجم النص' },
  spacing: { he: 'ריווח טקסט', en: 'Text spacing', ar: 'تباعد النص' },
  decrease: { he: 'הקטנה', en: 'Decrease', ar: 'تصغير' },
  increase: { he: 'הגדלה', en: 'Increase', ar: 'تكبير' },

  appearanceSection: { he: 'ניגודיות וצבע', en: 'Contrast & color', ar: 'التباين واللون' },
  contrast: { he: 'מצב ניגודיות', en: 'Contrast mode', ar: 'وضع التباين' },
  contrastDefault: { he: 'רגיל', en: 'Default', ar: 'افتراضي' },
  contrastHigh: { he: 'ניגודיות גבוהה', en: 'High contrast', ar: 'تباين عالٍ' },
  contrastGrayscale: { he: 'שחור-לבן', en: 'Grayscale', ar: 'تدرج الرمادي' },
  contrastInvert: { he: 'צבעים הפוכים', en: 'Invert colors', ar: 'عكس الألوان' },

  motionSection: { he: 'תנועה, קריאה וניווט', en: 'Motion, reading & navigation', ar: 'الحركة والقراءة والتصفح' },
  pauseAnimations: { he: 'עצירת אנימציות', en: 'Pause animations', ar: 'إيقاف الرسوم المتحركة' },
  readingGuide: { he: 'מדריך קריאה', en: 'Reading guide', ar: 'دليل القراءة' },
  highlightLinks: { he: 'הדגשת קישורים', en: 'Highlight links', ar: 'تمييز الروابط' },
  highlightHeadings: { he: 'הדגשת כותרות', en: 'Highlight headings', ar: 'تمييز العناوين' },
  bigCursor: { he: 'סמן גדול', en: 'Big cursor', ar: 'مؤشر كبير' },

  on: { he: 'פעיל', en: 'On', ar: 'مفعّل' },
  off: { he: 'כבוי', en: 'Off', ar: 'معطّل' },
}

export function a11yT(key: keyof typeof A11Y_UI, lang: Lang): string {
  return A11Y_UI[key][lang]
}
