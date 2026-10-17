import type { Metadata } from 'next'
import NotFoundView from '@/components/NotFoundView'

export const metadata: Metadata = {
  title: 'הדף לא נמצא · אייכה בר',
  description: 'הדף שחיפשת לא נמצא. חזרה לדף הבית של אייכה בר.',
  robots: { index: false, follow: false },
}

export default function NotFound() {
  return <NotFoundView />
}
