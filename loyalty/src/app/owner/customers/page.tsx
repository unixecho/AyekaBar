import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import CustomerManager from '@/components/CustomerManager'

export default async function OwnerCustomersPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/owner')

  const { data: me } = await supabase
    .from('staff')
    .select('role')
    .eq('auth_user_id', user.id)
    .maybeSingle()
  if (!me || me.role !== 'owner') redirect('/owner?denied=1')

  return (
    <main style={{ minHeight: '100dvh', padding: '24px 20px', maxWidth: 560, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
        <h1 style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--text)', textShadow: '0 0 18px rgba(255,94,58,0.5)', margin: 0 }}>
          אייכה<span style={{ color: 'var(--neon)' }}> · </span>בר
        </h1>
        <Link href="/owner/dashboard" style={{ fontSize: '0.82rem', color: 'var(--text-faint)', textDecoration: 'none' }}>← ניהול</Link>
      </div>
      <CustomerManager />
    </main>
  )
}
