export function getBrowserSupabaseUrl(env: NodeJS.ProcessEnv = process.env) {
  return env.NEXT_PUBLIC_SUPABASE_URL;
}

export function getServerSupabaseUrl(env: NodeJS.ProcessEnv = process.env) {
  const internalUrl = env.SUPABASE_INTERNAL_URL?.trim();
  if (internalUrl) return internalUrl;

  return env.NEXT_PUBLIC_SUPABASE_URL;
}

export function requireServerSupabaseUrl(env: NodeJS.ProcessEnv = process.env) {
  const supabaseUrl = getServerSupabaseUrl(env);
  if (!supabaseUrl) throw new Error("Supabase URL is not configured.");

  return supabaseUrl;
}

export function getSupabaseAuthCookieName(env: NodeJS.ProcessEnv = process.env) {
  const browserUrl = getBrowserSupabaseUrl(env)?.trim();
  if (!browserUrl) return undefined;

  try {
    const projectRef = new URL(browserUrl).hostname.split(".")[0];
    return projectRef ? `sb-${projectRef}-auth-token` : undefined;
  } catch {
    return undefined;
  }
}
