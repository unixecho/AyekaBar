// Errors PostgREST gives when a migration has not been applied yet. A feature that ships BEFORE its migration
// (the owner approves each migration separately — see CLAUDE.md) has to tell "not set up yet" apart from "broken":
// the first is a calm state on the page, the second is a 500.
//
//   42P01 / PGRST205   a table or view that does not exist
//   42883 / PGRST202   a function that does not exist
//   42703              a column that does not exist

export type PgErr = { code?: string; message?: string } | null | undefined

export const isMissingObject = (e: PgErr): boolean =>
  !!e && (
    e.code === '42P01' || e.code === 'PGRST205' || e.code === '42883' || e.code === 'PGRST202' || e.code === '42703' ||
    /relation .* does not exist|schema cache|could not find the function|function .* does not exist/i.test(e.message ?? '')
  )
