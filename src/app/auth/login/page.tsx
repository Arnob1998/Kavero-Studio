import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { brand } from "@/lib/brand";
import { getAuthModeConfig } from "@/lib/auth/config";
import { getSafeAuthRedirectPath } from "@/lib/auth/redirect";
import { createClient } from "@/lib/supabase/server";
import { AuthShell } from "../auth-shell";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: `Sign in | ${brand.name}`,
  description: `Sign in to ${brand.name}.`,
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const safeNext = getSafeAuthRedirectPath(next);
  const authConfig = getAuthModeConfig();
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();

  if (data?.claims) {
    redirect(safeNext);
  }

  const subtitle = authConfig.passwordEnabled
    ? authConfig.googleEnabled
      ? "Use email/password or continue with Google."
      : "Use email and password to sign in or create an account."
    : "Continue with Google to access your workspace.";

  return (
    <AuthShell title={`Welcome to ${brand.name}`} subtitle={subtitle}>
      <LoginForm next={safeNext} authConfig={authConfig} />
    </AuthShell>
  );
}
