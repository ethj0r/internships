// Where a posting can be worked from, for a candidate based in Indonesia.
// Drives the profile's search area (which jobs are listed and notified) and the location part of match scores.

import type { Region, SearchScope, Workplace } from "./types";

const INDONESIA =
  /\b(indonesia|jakarta|jabodetabek|bandung|surabaya|yogyakarta|jogja|bali|denpasar|medan|semarang|malang|tangerang|bsd city|bekasi|depok|bogor|batam|makassar|cikarang|balikpapan|palembang)\b/i;

// East and Southeast Asia, outside Indonesia.
const ASIA =
  /\b(singapore|malaysia|kuala lumpur|penang|johor|cyberjaya|petaling jaya|thailand|bangkok|vietnam|viet nam|ho chi minh|hanoi|ha noi|da nang|philippines|manila|makati|taguig|pasig|quezon city|cebu|mandaluyong|taiwan|taipei|hsinchu|taichung|kaohsiung|japan|tokyo|osaka|kyoto|fukuoka|nagoya|yokohama|sapporo|shibuya|minato|korea|seoul|pangyo|seongnam|hong kong|macau|china|shanghai|beijing|shenzhen|hangzhou|guangzhou|brunei|cambodia|phnom penh|myanmar|yangon)\b/i;

// Remote roles open across many countries, Indonesia included.
const OPEN_REMOTE = /\b(worldwide|anywhere|global|apac|asia[- ]?pacific|asia|south[- ]?east asia|gmt ?\+ ?[5-9]|utc ?\+ ?[5-9])\b/i;

// Places outside the search area. US state codes cover "Austin, TX"; ID and IN are left out (Indonesia, India).
const ELSEWHERE =
  /\b(united states|usa|us|u\.s|americas?|canada|mexico|brazil|argentina|colombia|chile|peru|latam|united kingdom|uk|england|scotland|ireland|europe|eu|emea|germany|france|spain|portugal|netherlands|belgium|poland|romania|italy|sweden|denmark|norway|finland|switzerland|austria|czechia|israel|india|bengaluru|bangalore|hyderabad|pune|mumbai|delhi|gurugram|gurgaon|chennai|australia|sydney|melbourne|new zealand|africa|nigeria|kenya|egypt|turkey|uae|dubai|saudi arabia|qatar|pakistan|bangladesh|sri lanka|san francisco|new york|seattle|boston|austin|chicago|los angeles|toronto|vancouver|montreal|london|dublin|berlin|paris|amsterdam)\b|,\s*(al|ak|az|ar|ca|co|ct|de|fl|ga|hi|il|ia|ks|ky|la|me|md|ma|mi|mn|ms|mo|mt|ne|nv|nh|nj|nm|ny|nc|nd|oh|ok|or|pa|ri|sc|sd|tn|tx|ut|vt|va|wa|wv|wi|wy|dc)\b/i;

// A remote posting whose location doesn't say where can still restrict it in the description.
const RESTRICTED_TEXT =
  /\b(must|need to|required to|should)\s+(be\s+)?(currently\s+)?(located|based|residing|reside|live)\s+(in|within)\s+(the\s+)?(united states|u\.s|us|usa|canada|europe|eu|united kingdom|uk|india|latin america)\b|\b(us|u\.s)[- ]based (candidates|applicants|students)\b|\bauthorized to work in the (united states|u\.s|us)\b/i;
const OPEN_TEXT = /\b(work from anywhere|anywhere in the world|open to (candidates|applicants|students) (from |in )?(anywhere|worldwide|asia|apac|indonesia))\b/i;

export interface RegionInput {
  location: string;
  workplace: Workplace;
  description?: string;
}

export function classifyRegion({ location, workplace, description = "" }: RegionInput): Region {
  if (INDONESIA.test(location)) return "indonesia";
  const asia = ASIA.test(location);
  if (workplace === "remote") {
    if (OPEN_REMOTE.test(location)) return "remote_open";
    if (asia) return "remote_asia";
    if (ELSEWHERE.test(location) || RESTRICTED_TEXT.test(description)) return "other";
    return OPEN_TEXT.test(description) ? "remote_open" : "remote_unknown";
  }
  if (asia) return "asia";
  return location.trim() ? "other" : "unknown";
}

const NEAR: readonly Region[] = ["indonesia", "remote_open", "remote_asia", "remote_unknown", "unknown"];

/** Regions each search area includes. `null` means every region. */
export const SCOPE_REGIONS: Record<SearchScope, readonly Region[] | null> = {
  indonesia_remote: NEAR,
  asia: [...NEAR, "asia"],
  anywhere: null,
};

export function inSearchScope(region: Region, scope: SearchScope): boolean {
  const regions = SCOPE_REGIONS[scope];
  return !regions || regions.includes(region);
}

export const SEARCH_SCOPE_LABELS: Record<SearchScope, string> = {
  indonesia_remote: "Indonesia & Remote",
  asia: "Asia",
  anywhere: "Anywhere",
};
