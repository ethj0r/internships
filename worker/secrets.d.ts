// Optional secrets aren't in .dev.vars.example, so `wrangler types` can't see them.
// Set with `wrangler secret put ANTHROPIC_API_KEY`.
interface Env {
  ANTHROPIC_API_KEY?: string;
}

declare namespace Cloudflare {
  interface Env {
    ANTHROPIC_API_KEY?: string;
  }
}
