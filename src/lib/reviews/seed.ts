import type { PortalReviewsBlock } from './types'

// Seed content for the portal's review wall, harvested from the Google Maps
// listing on 2026-08-10 (4.4 stars over 38 reviews at the time).
//
// The first four carry a rating and author verified on the listing itself. The
// last four came from the owner without attribution and ship ANONYMOUS on
// purpose — a real quote under an invented name misrepresents a real customer.
// The owner fills the names in from /owner/dashboard once confirmed.
//
// Review bodies are deliberately NOT translated into he/en/ar the way UI
// strings are: these are a customer's own words, and re-attributing a
// translation to them puts words in their mouth. Each review renders in the
// language it was written in (`lang` also drives the card's direction) while
// everything around it stays trilingual.

/** Google listing, addressed by CID — stable, unlike the old search URL. */
export const REVIEWS_URL = 'https://maps.google.com/?cid=8772973758950612975'

export const PORTAL_REVIEWS_DEFAULT: PortalReviewsBlock = {
  rating: 4.4,
  count: 38,
  url: REVIEWS_URL,
  items: [
    {
      id: 'levi-avgil',
      author: 'Levi Avgil',
      stars: 5,
      lang: 'he',
      date: '2026-05',
      text: 'המלצר/בעלים/ברמן ממש אדיב ונחמד ישב איתנו דאג שיהיה לנו הכי טוב שאפשר אין מילים באמת רמה גבוהה של שירות ואוכל',
      visible: true,
    },
    {
      id: 'rafael-lavi',
      author: 'רפאל לביא',
      stars: 5,
      lang: 'he',
      date: '2026-01',
      text: 'מקום מעוצב בצורה מאוד יפה תפריט עשיר ומאוד טעים! מומלץ.',
      visible: true,
    },
    {
      id: 'aviad-adani',
      author: 'אביעד עדני',
      stars: 5,
      lang: 'he',
      date: '2026-06',
      text: 'אווירה ממש מעולה ממליץ בחום!',
      visible: true,
    },
    {
      id: 'maor-refael',
      author: 'Maor Refael',
      stars: 5,
      lang: 'he',
      date: '2026-04',
      text: 'תמיד כיף לשבת אווירה טובה אוכל טוב ושירות מעולה☝️',
      visible: true,
    },
    {
      id: 'bar-metoraf',
      author: '',
      stars: 5,
      lang: 'he',
      date: '',
      text: 'בר מטורף בצפון חוויה ואווירה כיפית ברמות!!! אוכל חלבי מדהים וטעים מאוד והכי חשוב כשר ברמה גבוהה ממליצה בחום🫶',
      visible: true,
    },
    {
      id: 'madhim',
      author: '',
      stars: 5,
      lang: 'he',
      date: '',
      text: 'מדהים. אוכל וואו, מיקום ונראות וואו, שירות מדהים, אווירה טובה, מקום יפיפיה, מחירים ממש נגישים. המסעדה היחידה הטובה בחריש סוף סוף',
      visible: true,
    },
    {
      id: 'leyad-habait',
      author: '',
      stars: 5,
      lang: 'he',
      date: '',
      text: 'איזה כיף שיש אתכם ממש ליד הבית ❤️',
      visible: true,
    },
    {
      id: 'beer-next-door',
      author: '',
      stars: 5,
      lang: 'en',
      date: '',
      text: 'A great place to sit down for a beer next to the house!',
      visible: true,
    },
  ],
}
