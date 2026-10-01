export type Env = {
  DB: D1Database;
  BUCKET: R2Bucket;
  ASSETS: Fetcher;
  ENVIRONMENT: string;
  AUTH_MODE: string;
  // Set as secrets at deployment, not declared in wrangler.jsonc. Until they
  // are set they are absent, and an absent one is treated as empty: the
  // Worker then refuses everyone.
  OWNER_EMAIL?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  SERVICE_TOKEN_CLIENT_ID?: string;
};

export type Identity = { kind: "owner"; email: string } | { kind: "service"; clientId: string };

export type AppEnv = { Bindings: Env; Variables: { identity: Identity } };
