// Canonical skill taxonomy. Used to extract skills from job descriptions and CVs,
// and to flag skills a generated document mentions that the master CV does not.

interface SkillDef {
  name: string;
  aliases: string[];
  /** Aliases matched case-sensitively (e.g. "Go"), to avoid false positives on common words. */
  exact?: string[];
  implies?: string[];
}

const SKILLS: SkillDef[] = [
  // Languages
  { name: "Python", aliases: ["python"] },
  { name: "Java", aliases: ["java"] },
  { name: "JavaScript", aliases: ["javascript", "ecmascript", "es6"] },
  { name: "TypeScript", aliases: ["typescript"] },
  { name: "C++", aliases: ["c++", "cpp"] },
  { name: "C#", aliases: ["c#", "csharp"] },
  { name: "Go", aliases: ["golang"], exact: ["Go"] },
  { name: "Rust", aliases: ["rust"] },
  { name: "Kotlin", aliases: ["kotlin"] },
  { name: "Swift", aliases: ["swift", "swiftui"] },
  { name: "Ruby", aliases: ["ruby"] },
  { name: "PHP", aliases: ["php"] },
  { name: "Scala", aliases: ["scala"] },
  { name: "R", aliases: ["rstudio", "tidyverse"], exact: ["R"] },
  { name: "SQL", aliases: ["sql"] },
  { name: "Bash", aliases: ["bash", "shell scripting"] },
  { name: "MATLAB", aliases: ["matlab"] },
  // Web
  { name: "React", aliases: ["react", "react.js", "reactjs"], implies: ["JavaScript"] },
  { name: "Next.js", aliases: ["next.js", "nextjs"], implies: ["React"] },
  { name: "Vue", aliases: ["vue", "vue.js", "vuejs"] },
  { name: "Angular", aliases: ["angular"] },
  { name: "Svelte", aliases: ["svelte", "sveltekit"] },
  { name: "HTML/CSS", aliases: ["html", "css", "html5", "css3", "tailwind", "sass"] },
  { name: "Node.js", aliases: ["node.js", "nodejs", "node js"], implies: ["JavaScript"] },
  { name: "Django", aliases: ["django"], implies: ["Python"] },
  { name: "Flask", aliases: ["flask"], implies: ["Python"] },
  { name: "FastAPI", aliases: ["fastapi"], implies: ["Python"] },
  { name: "Spring", aliases: ["spring boot", "spring framework"], implies: ["Java"] },
  { name: "Ruby on Rails", aliases: ["rails", "ruby on rails"], implies: ["Ruby"] },
  { name: ".NET", aliases: [".net", "asp.net", "dotnet"] },
  { name: "REST APIs", aliases: ["rest", "restful", "rest api", "rest apis"] },
  { name: "GraphQL", aliases: ["graphql"] },
  { name: "gRPC", aliases: ["grpc"] },
  // Data & ML
  { name: "Machine Learning", aliases: ["machine learning", "ml models"] },
  { name: "Deep Learning", aliases: ["deep learning", "neural networks", "neural network"] },
  { name: "PyTorch", aliases: ["pytorch", "torch"], implies: ["Python"] },
  { name: "TensorFlow", aliases: ["tensorflow", "keras"], implies: ["Python"] },
  { name: "JAX", aliases: ["jax"] },
  { name: "scikit-learn", aliases: ["scikit-learn", "sklearn"], implies: ["Python"] },
  { name: "pandas", aliases: ["pandas"], implies: ["Python"] },
  { name: "NumPy", aliases: ["numpy"], implies: ["Python"] },
  { name: "LLMs", aliases: ["llm", "llms", "large language models", "large language model", "generative ai", "genai"] },
  { name: "NLP", aliases: ["nlp", "natural language processing"] },
  { name: "Computer Vision", aliases: ["computer vision", "opencv"] },
  { name: "Reinforcement Learning", aliases: ["reinforcement learning"] },
  { name: "Statistics", aliases: ["statistics", "statistical analysis", "probability"] },
  { name: "Spark", aliases: ["spark", "pyspark", "apache spark"] },
  { name: "Hadoop", aliases: ["hadoop"] },
  { name: "Kafka", aliases: ["kafka"] },
  { name: "Airflow", aliases: ["airflow"] },
  { name: "dbt", aliases: ["dbt"] },
  { name: "Data Visualization", aliases: ["tableau", "power bi", "data visualization", "looker"] },
  // Databases
  { name: "PostgreSQL", aliases: ["postgresql", "postgres"], implies: ["SQL"] },
  { name: "MySQL", aliases: ["mysql"], implies: ["SQL"] },
  { name: "SQLite", aliases: ["sqlite"], implies: ["SQL"] },
  { name: "MongoDB", aliases: ["mongodb", "mongo"] },
  { name: "Redis", aliases: ["redis"] },
  { name: "Elasticsearch", aliases: ["elasticsearch"] },
  { name: "DynamoDB", aliases: ["dynamodb"] },
  { name: "Snowflake", aliases: ["snowflake"] },
  { name: "BigQuery", aliases: ["bigquery"] },
  // Cloud & infra
  { name: "AWS", aliases: ["aws", "amazon web services", "ec2", "s3", "lambda"] },
  { name: "GCP", aliases: ["gcp", "google cloud"] },
  { name: "Azure", aliases: ["azure"] },
  { name: "Cloudflare Workers", aliases: ["cloudflare workers"] },
  { name: "Docker", aliases: ["docker", "containers", "containerization"] },
  { name: "Kubernetes", aliases: ["kubernetes", "k8s"] },
  { name: "Terraform", aliases: ["terraform"] },
  { name: "CI/CD", aliases: ["ci/cd", "continuous integration", "github actions", "jenkins"] },
  { name: "Linux", aliases: ["linux", "unix"] },
  { name: "Git", aliases: ["git", "github", "gitlab", "version control"] },
  // Mobile
  { name: "iOS", aliases: ["ios"] },
  { name: "Android", aliases: ["android"] },
  { name: "React Native", aliases: ["react native"] },
  { name: "Flutter", aliases: ["flutter", "dart"] },
  // CS fundamentals
  { name: "Data Structures & Algorithms", aliases: ["data structures", "algorithms"] },
  { name: "Distributed Systems", aliases: ["distributed systems"] },
  { name: "Operating Systems", aliases: ["operating systems"] },
  { name: "Computer Networking", aliases: ["networking", "tcp/ip", "computer networks"] },
  { name: "Object-Oriented Programming", aliases: ["object-oriented", "object oriented", "oop"] },
  { name: "Concurrency", aliases: ["concurrency", "multithreading", "multi-threading"] },
  { name: "Testing", aliases: ["unit testing", "unit tests", "test-driven", "jest", "pytest"] },
  { name: "Security", aliases: ["cybersecurity", "application security", "cryptography"] },
  { name: "Microservices", aliases: ["microservices", "microservice"] },
  { name: "System Design", aliases: ["system design"] },
  { name: "Agile", aliases: ["agile", "scrum"] },
];

const BOUNDARY_BEFORE = "(?<![A-Za-z0-9+#.])";
const BOUNDARY_AFTER = "(?![A-Za-z0-9+#])";

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface CompiledSkill {
  def: SkillDef;
  pattern: RegExp;
  exactPattern: RegExp | null;
}

const COMPILED: CompiledSkill[] = SKILLS.map((def) => ({
  def,
  pattern: new RegExp(`${BOUNDARY_BEFORE}(?:${def.aliases.map(escapeRegex).join("|")})${BOUNDARY_AFTER}`, "i"),
  // "Go"/"R" only count in a list ("Python, Go") or after "in/with/using", never as an ordinary word.
  exactPattern: def.exact
    ? (() => {
        const names = def.exact.map(escapeRegex).join("|");
        return new RegExp(
          [
            `(?<=[,(/]\\s?)(?:${names})(?=[\\s,)/.;]|$)`,
            `(?<=[\\s(]|^)(?:${names})(?=\\s?[,)/;])`,
            `(?<=\\b(?:in|with|using|and|or)\\s)(?:${names})(?=[\\s.,;)]|$)(?!\\s+(?:to|beyond|ahead|live|through|back|further|above)\\b)`,
          ].join("|"),
        );
      })()
    : null,
}));

const BY_NAME = new Map(SKILLS.map((s) => [s.name.toLowerCase(), s]));
const BY_ALIAS = new Map<string, SkillDef>();
for (const s of SKILLS) {
  BY_ALIAS.set(s.name.toLowerCase(), s);
  for (const a of [...s.aliases, ...(s.exact ?? [])]) BY_ALIAS.set(a.toLowerCase(), s);
}

function withImplied(names: Iterable<string>): Set<string> {
  const out = new Set<string>();
  const visit = (name: string) => {
    if (out.has(name)) return;
    out.add(name);
    for (const implied of BY_NAME.get(name.toLowerCase())?.implies ?? []) visit(implied);
  };
  for (const n of names) visit(n);
  return out;
}

/** Scans free text (job description, CV) for known skills. Returns canonical names. */
export function extractSkills(text: string, opts: { includeImplied?: boolean } = {}): string[] {
  const found: string[] = [];
  for (const { def, pattern, exactPattern } of COMPILED) {
    if (pattern.test(text) || (exactPattern && exactPattern.test(text))) found.push(def.name);
  }
  return opts.includeImplied ? [...withImplied(found)] : found;
}

/** Maps a user-entered skill ("golang", "react.js") to its canonical name; unknown skills pass through trimmed. */
export function canonicalizeSkill(input: string): string {
  const trimmed = input.trim();
  return BY_ALIAS.get(trimmed.toLowerCase())?.name ?? trimmed;
}

export function skillSet(skills: Iterable<string>): Set<string> {
  return withImplied([...skills].map(canonicalizeSkill));
}

export function sameSkill(a: string, b: string): boolean {
  return canonicalizeSkill(a).toLowerCase() === canonicalizeSkill(b).toLowerCase();
}
