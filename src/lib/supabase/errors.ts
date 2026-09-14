// PostgREST reports a table missing from its schema cache (for example a migration not yet applied) as
// PGRST205; Postgres itself uses 42P01 for an undefined table
export function isMissingTableError(error: { code?: string } | null | undefined): boolean {
  return error?.code === 'PGRST205' || error?.code === '42P01';
}
