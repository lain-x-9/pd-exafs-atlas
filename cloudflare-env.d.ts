declare namespace Cloudflare {
  interface Env {
    COMPUTE_CONFIG_KEY?: string;
    DB?: D1Database;
    BUCKET?: R2Bucket;
  }
}
