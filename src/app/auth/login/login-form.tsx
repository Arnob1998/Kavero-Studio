"use client";

import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { AuthModeConfig } from "@/lib/auth/config";
import { getClientSiteOrigin } from "@/lib/auth/origin";
import { getSafeAuthRedirectPath } from "@/lib/auth/redirect";
import { createClient } from "@/lib/supabase/client";

type PendingAction = "google" | "sign-in" | "sign-up" | null;

export function LoginForm({
  next,
  authConfig,
}: {
  next: string;
  authConfig: AuthModeConfig;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const safeNext = useMemo(() => getSafeAuthRedirectPath(next), [next]);
  const isLoading = pendingAction !== null;

  function clearMessages() {
    setErrorMessage(null);
    setInfoMessage(null);
  }

  function redirectToNext() {
    window.location.assign(safeNext);
  }

  async function signInWithGoogle() {
    setPendingAction("google");
    clearMessages();

    const supabase = createClient();
    const redirectTo = `${getClientSiteOrigin()}/auth/callback?next=${encodeURIComponent(safeNext)}`;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo,
      },
    });

    if (error) {
      setErrorMessage(
        error.message.includes("Unsupported provider")
          ? "Google sign-in is unavailable right now. Please try again later."
          : "Unable to start Google sign-in. Please try again.",
      );
      setPendingAction(null);
    }
  }

  async function signInWithPassword() {
    setPendingAction("sign-in");
    clearMessages();

    if (!email.trim() || !password) {
      setErrorMessage("Enter both an email address and password.");
      setPendingAction(null);
      return;
    }

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (error) {
      setErrorMessage(getPasswordErrorMessage(error.message, "sign-in"));
      setPendingAction(null);
      return;
    }

    redirectToNext();
  }

  async function signUpWithPassword() {
    setPendingAction("sign-up");
    clearMessages();

    if (!email.trim() || !password) {
      setErrorMessage("Enter both an email address and password.");
      setPendingAction(null);
      return;
    }

    const supabase = createClient();
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
    });

    if (error) {
      setErrorMessage(getPasswordErrorMessage(error.message, "sign-up"));
      setPendingAction(null);
      return;
    }

    if (data.session) {
      redirectToNext();
      return;
    }

    setInfoMessage("Account created. Check your email for next steps before signing in.");
    setPendingAction(null);
  }

  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (authConfig.passwordEnabled) {
          void signInWithPassword();
        }
      }}
    >
      {authConfig.passwordEnabled ? (
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="block text-left text-[13px] font-semibold text-white/72" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              className="h-14 w-full rounded-[16px] border border-white/[0.12] bg-white/[0.04] px-4 text-[15px] font-medium text-white outline-none transition focus:border-white/25 focus:bg-white/[0.06]"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={isLoading}
            />
          </div>
          <div className="space-y-2">
            <label className="block text-left text-[13px] font-semibold text-white/72" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              className="h-14 w-full rounded-[16px] border border-white/[0.12] bg-white/[0.04] px-4 text-[15px] font-medium text-white outline-none transition focus:border-white/25 focus:bg-white/[0.06]"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={isLoading}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Button
              className="h-14 rounded-[16px] text-[16px] font-bold"
              type="submit"
              disabled={isLoading}
            >
              {pendingAction === "sign-in" ? <Loader2 size={17} className="animate-spin" /> : null}
              Sign in
            </Button>
            <Button
              className="h-14 rounded-[16px] text-[16px] font-bold"
              variant="secondary"
              type="button"
              onClick={() => void signUpWithPassword()}
              disabled={isLoading}
            >
              {pendingAction === "sign-up" ? <Loader2 size={17} className="animate-spin" /> : null}
              Create account
            </Button>
          </div>
        </div>
      ) : null}

      {authConfig.passwordEnabled && authConfig.googleEnabled ? (
        <div className="relative text-center text-[12px] font-semibold uppercase tracking-[0.12em] text-white/32">
          <span className="absolute inset-x-0 top-1/2 -z-10 h-px -translate-y-1/2 bg-white/[0.08]" aria-hidden="true" />
          <span className="bg-[#0d0d0e] px-3">Or continue with</span>
        </div>
      ) : null}

      {authConfig.googleEnabled ? (
        <Button
          className="h-14 w-full rounded-[16px] text-[16px] font-bold"
          type="button"
          onClick={() => void signInWithGoogle()}
          disabled={isLoading}
        >
          {pendingAction === "google" ? <Loader2 size={17} className="animate-spin" /> : <GoogleMark />}
          Continue with Google
        </Button>
      ) : null}

      {errorMessage ? (
        <Alert className="mt-5" variant="destructive">
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      ) : null}
      {infoMessage ? (
        <Alert>
          <AlertDescription>{infoMessage}</AlertDescription>
        </Alert>
      ) : null}
    </form>
  );
}

function getPasswordErrorMessage(message: string, action: "sign-in" | "sign-up") {
  if (message.includes("Email logins are disabled") || message.includes("Unsupported")) {
    return action === "sign-in"
      ? "Email/password sign-in is unavailable right now. Please try again later."
      : "Email/password account creation is unavailable right now. Please try again later.";
  }

  if (action === "sign-up" && message.includes("Signups not allowed")) {
    return "Email/password account creation is unavailable right now. Please try again later.";
  }

  return action === "sign-in"
    ? "Unable to sign in with email and password. Please try again."
    : "Unable to create an account with email and password. Please try again.";
}

function GoogleMark() {
  return (
    <svg aria-hidden="true" className="h-[17px] w-[17px]" viewBox="0 0 48 48">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5Z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 16.3 4 9.6 8.3 6.3 14.7Z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.3 0-9.7-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44Z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.2-4.1 5.6l6.2 5.2C37 39.1 44 34 44 24c0-1.3-.1-2.4-.4-3.5Z" />
    </svg>
  );
}
