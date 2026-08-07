import TeamView from '@/components/TeamView'
import { fetchTeam } from '@/lib/team/fetch'

// Server-rendered for first paint, same as /menu — the roster changes rarely,
// so a short revalidate keeps it cheap while still picking up a new hire the
// owner just published.
export const revalidate = 300

export const metadata = {
  title: 'הצוות · אייכה בר',
  description: 'הכירו את הצוות של אייכה בר — חריש',
}

export default async function TeamPage() {
  const members = await fetchTeam()
  return <TeamView members={members} />
}
