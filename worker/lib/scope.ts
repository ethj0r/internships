// Which jobs are listed and notified. Eligibility (shared/eligibility.ts) replaced the profile's search area:
// excluded postings are stored with their reason but hidden unless asked for.

/** SQL condition hiding excluded postings. */
export function visibleFilter(alias = "j"): { sql: string; params: string[] } {
  return { sql: `${alias}.eligibility_status != 'EXCLUDED'`, params: [] };
}
