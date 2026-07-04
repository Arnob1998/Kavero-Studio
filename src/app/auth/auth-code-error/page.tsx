import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { brand } from "@/lib/brand";
import { getAuthModeConfig } from "@/lib/auth/config";
import { AuthShell } from "../auth-shell";

export const metadata: Metadata = {
  title: `Auth Error | ${brand.name}`,
  description: `The ${brand.name} sign-in flow could not be completed.`,
};

export default function AuthCodeErrorPage() {
  const authConfig = getAuthModeConfig();
  const subtitle = authConfig.googleEnabled
    ? authConfig.passwordEnabled
      ? "The external sign-in flow could not be completed."
      : "Google returned without a valid Supabase auth code."
    : "This callback route is only used for Google OAuth, but password mode is active.";
  const footer = authConfig.googleEnabled ? (
    <span>
      {authConfig.passwordEnabled
        ? "If you were using Google sign-in, check your Supabase redirect URLs and Google provider settings."
        : "Check your Supabase redirect URLs and Google provider settings."}
    </span>
  ) : (
    <span>Return to sign in and use email/password instead.</span>
  );
  const description = authConfig.googleEnabled
    ? authConfig.passwordEnabled
      ? "The external sign-in flow returned without a valid Supabase auth code. Try again or use email/password instead."
      : "Google returned without a valid Supabase auth code. Check the redirect URL allow list and try again."
    : "Google OAuth callback was reached while password auth mode is active. Return to sign in and use email/password instead.";

  return (
    <AuthShell
      title="Sign-in failed"
      subtitle={subtitle}
      footer={footer}
    >
      <section>
        <div className="mx-auto mb-8 grid h-14 w-14 place-items-center rounded-[18px] bg-red-500/14 text-red-200">
          <AlertTriangle size={22} />
        </div>
        <p className="text-center text-[15px] font-medium leading-6 text-white/58">
          {description}
        </p>
        <Link
          className="mt-8 inline-flex h-14 w-full items-center justify-center gap-2 rounded-[16px] bg-white px-5 text-[16px] font-bold text-black transition hover:bg-white/90"
          href="/auth/login"
        >
          Back to sign in
          <ArrowRight size={15} />
        </Link>
      </section>
    </AuthShell>
  );
}
