import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { getSupabaseAuthCookieName, requireServerSupabaseUrl } from "./url";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    requireServerSupabaseUrl(),
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // Server Components cannot write cookies. The proxy refreshes sessions.
          }
        },
      },
      cookieOptions: {
        name: getSupabaseAuthCookieName(),
      },
    },
  );
}
