import { SCOPE_REGIONS } from "../../shared/regions";
import type { SearchScope } from "../../shared/types";
import { placeholders } from "./db";

/** SQL condition limiting jobs to a search area, or null for "Anywhere". */
export function scopeFilter(scope: SearchScope, alias = "j"): { sql: string; params: string[] } | null {
  const regions = SCOPE_REGIONS[scope];
  return regions ? { sql: `${alias}.region IN (${placeholders(regions.length)})`, params: [...regions] } : null;
}
