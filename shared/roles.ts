// Role taxonomy used for relevance filtering and role-fit scoring.

export interface RoleDef {
  key: string;
  label: string;
  title: RegExp;
  description: RegExp;
}

export const ROLES: RoleDef[] = [
  {
    key: "software",
    label: "Software Engineering",
    title: /software|\bswe\b|developer|programm|computer science|engineering intern/i,
    description: /software (engineer|develop)|computer science/i,
  },
  {
    key: "backend",
    label: "Backend",
    title: /back[- ]?end|server|api\b|distributed|platform|infrastructure|systems/i,
    description: /back[- ]?end|distributed systems|microservices|\bapis?\b|databases?/i,
  },
  {
    key: "frontend",
    label: "Frontend",
    title: /front[- ]?end|\bui\b|web\b|web developer/i,
    description: /front[- ]?end|user interfaces?|react|typescript|css/i,
  },
  {
    key: "fullstack",
    label: "Full-Stack",
    title: /full[- ]?stack/i,
    description: /full[- ]?stack|end[- ]to[- ]end (features|product)/i,
  },
  {
    key: "ai_ml",
    label: "AI / ML",
    title: /machine learning|\bml\b|\bai\b|artificial intelligence|deep learning|\bllms?\b|computer vision|\bnlp\b|research (engineer|scientist)|applied scien/i,
    description: /machine learning|deep learning|pytorch|tensorflow|\bllms?\b|neural|computer vision|\bnlp\b/i,
  },
  {
    key: "data",
    label: "Data",
    title: /\bdata\b|analytics|analyst/i,
    description: /data (pipelines?|engineering|science|analysis)|\betl\b|\bsql\b|spark/i,
  },
  {
    key: "mobile",
    label: "Mobile",
    title: /mobile|\bios\b|android/i,
    description: /\bios\b|android|swift|kotlin|mobile/i,
  },
  {
    key: "infra",
    label: "Infrastructure & Security",
    title: /devops|\bsre\b|site reliability|security|cloud|infrastructure|production engineer/i,
    description: /kubernetes|terraform|reliability|security|cloud infrastructure/i,
  },
];

export const ROLE_LABELS: Record<string, string> = Object.fromEntries(ROLES.map((r) => [r.key, r.label]));

// Includes Indonesian (magang, kerja praktik) and Japanese / Chinese terms. CJK has no word boundaries, so it sits outside \b.
const INTERNSHIP =
  /\b(interns?|internships?|co-?op|werkstudent(in)?|working student|summer student|placement student|industrial placement|apprentice(ship)?|stage|praktikum|praktikant(in)?|magang|kerja prakti[ck]|pkl)\b|インターン|实习|實習/i;

const TECH_TITLE =
  /software|engineer|developer|programm|computer science|\bcs\b|back[- ]?end|front[- ]?end|full[- ]?stack|machine learning|\bml\b|\bai\b|artificial intelligence|\bdata\b|research|platform|infrastructure|devops|\bsre\b|security|mobile|\bios\b|android|\bweb\b|cloud|quantitative (developer|research)|robotics|systems|technology|\bit\b|analytics|quality assurance|\bqa\b|\bsdet\b|pengembang|perangkat lunak|エンジニア|ソフトウェア|工程師|工程师/i;

// Titles that mention tech words but are clearly not software internships.
const NON_SOFTWARE =
  /sales|marketing|finance|accounting|legal|recruit|talent|people|\bhr\b|communications|business development|customer|account (executive|manager)|policy|content|brand|mechanical|electrical|civil|chemical|hardware|manufacturing|supply chain|facilities|construction|industrial design|graphic|clinical|nurs/i;

const STRONG_SOFTWARE = /software|developer|programm|computer science|machine learning|\bml\b|full[- ]?stack|back[- ]?end|front[- ]?end/i;

export function isInternshipTitle(title: string, employmentType = ""): boolean {
  return INTERNSHIP.test(title) || /intern/i.test(employmentType);
}

/** True when a posting looks like a software / CS / data / AI internship. */
export function isRelevantInternship(title: string, department = "", employmentType = ""): boolean {
  if (!isInternshipTitle(title, employmentType)) return false;
  const techInTitle = TECH_TITLE.test(title);
  const techInDept = /engineering|software|developer|data|research|technology|machine learning|\bai\b|product development|infrastructure|security/i.test(department);
  if (!techInTitle && !techInDept) return false;
  if (NON_SOFTWARE.test(title) && !STRONG_SOFTWARE.test(title)) return false;
  return true;
}

export function detectRoles(title: string, description: string): { title: string[]; description: string[] } {
  return {
    title: ROLES.filter((r) => r.title.test(title)).map((r) => r.key),
    description: ROLES.filter((r) => r.description.test(description)).map((r) => r.key),
  };
}
