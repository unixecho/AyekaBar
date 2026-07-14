import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import OwnerHeader from '@/components/OwnerHeader'
import MenuEditor from '@/components/MenuEditor'

export default async function OwnerEditorPage() {
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
      <OwnerHeader right={<Link href="/owner/dashboard" style={{ color: 'inherit', textDecoration: 'none' }}>← ניהול</Link>} />
      <div className="rise" style={{ animationDelay: '140ms' }}>
        <MenuEditor />
      </div>
    </main>
  )
}
