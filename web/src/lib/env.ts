import "server-only";

/**
 * Server-side environment access.
 *
 * `server-only` makes importing this from a client component a build error, so
 * the API key cannot reach the browser by accident. Nothing here is prefixed
 * `NEXT_PUBLIC_`, which is the other half of that guarantee.
 *
 * Values are read through getters rather than at module load, so a missing
 * variable fails the request that needs it rather than the whole build.
 */

const DEFAULT_BASE_URL = "https://soclaas-api.comp.nus.edu.sg/v1";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. ` +
        `Set it in web/.env.local locally, or in the Vercel project settings.`,
    );
  }
  return value;
}

export const env = {
  get soclaasApiKey() {
    return required("SOCLAAS_API_KEY");
  },
  get soclaasBaseUrl() {
    return (process.env.SOCLAAS_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
  },
  get appPassword() {
    return required("APP_PASSWORD");
  },
  get authSecret() {
    return required("AUTH_SECRET");
  },
};
