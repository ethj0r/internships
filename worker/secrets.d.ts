// Optional secrets aren't in .dev.vars.example, so `wrangler types` can't see them.
// Set with `wrangler secret put <NAME>`.
interface Env {
  ANTHROPIC_API_KEY?: string;
  /** NVIDIA free API key (nvapi-…), for the NVIDIA options in config/models.json. */
  LLM_API_KEY?: string;
}

declare namespace Cloudflare {
  interface Env {
    ANTHROPIC_API_KEY?: string;
    LLM_API_KEY?: string;
  }
}
