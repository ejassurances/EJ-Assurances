/** OAuth Google serveur pour les API Gmail et Drive. */
type TokenResponse = {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};

let tokenCache: { accessToken: string; expiresAt: number } | null = null;
let tokenRefresh: Promise<string> | null = null;

export async function obtenirJetonGoogle(): Promise<string> {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) {
    return tokenCache.accessToken;
  }
  if (tokenRefresh) return tokenRefresh;

  tokenRefresh = (async () => {
    const clientId = process.env["GOOGLE_OAUTH_CLIENT_ID"];
    const clientSecret = process.env["GOOGLE_OAUTH_CLIENT_SECRET"];
    const refreshToken = process.env["GOOGLE_OAUTH_REFRESH_TOKEN"];
    const absents = [
      ...(!clientId ? ["GOOGLE_OAUTH_CLIENT_ID"] : []),
      ...(!clientSecret ? ["GOOGLE_OAUTH_CLIENT_SECRET"] : []),
      ...(!refreshToken ? ["GOOGLE_OAUTH_REFRESH_TOKEN"] : []),
    ];
    if (absents.length) {
      throw new Error(`Configuration OAuth Google manquante : ${absents.join(", ")}`);
    }

    const body = new URLSearchParams({
      client_id: clientId!,
      client_secret: clientSecret!,
      refresh_token: refreshToken!,
      grant_type: "refresh_token",
    });
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const payload = (await response.json().catch(() => ({}))) as TokenResponse;
    if (!response.ok || !payload.access_token) {
      throw new Error(
        `Renouvellement OAuth Google impossible (${response.status}) : ${payload.error_description ?? payload.error ?? "réponse invalide"}`,
      );
    }

    tokenCache = {
      accessToken: payload.access_token,
      expiresAt: Date.now() + (payload.expires_in ?? 3600) * 1000,
    };
    return payload.access_token;
  })();

  try {
    return await tokenRefresh;
  } finally {
    tokenRefresh = null;
  }
}
