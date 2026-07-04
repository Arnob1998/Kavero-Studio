"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  CreditCard,
  KeyRound,
  LogOut,
  Settings,
  WalletCards,
} from "lucide-react";
import { BrandMark } from "@/components/brand";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { brand } from "@/lib/brand";
import { createClient } from "@/lib/supabase/client";

const defaultNavItems = [
  { label: "Home", href: "/" },
  { label: "Gallery", href: "/gallery" },
  { label: "Generate", href: "/generate" },
  { label: "Canvas", href: "/canvas" },
];

const utilityItems = [{ label: "Pricing", href: "/pricing" }];

const navItemClass =
  "relative flex h-8 min-w-[74px] items-center justify-center rounded-full px-3 text-[12px] font-semibold tracking-normal text-white/56 transition-colors hover:bg-white/[0.07] hover:text-white sm:min-w-[88px] sm:px-4";

interface SiteNavClientProps {
  activeLabel: string;
  ariaLabel?: string;
  excludedLabels?: string[];
}

type NavUser = {
  id: string;
  email?: string;
  name?: string;
  avatarUrl?: string;
};

export function SiteNavClient({
  activeLabel,
  ariaLabel = "Main navigation",
  excludedLabels = [],
}: SiteNavClientProps) {
  const [user, setUser] = useState<NavUser | null>(null);
  const [signInHref, setSignInHref] = useState("/auth/login");
  const excluded = new Set(excludedLabels);
  const navItems = defaultNavItems.filter((item) => !excluded.has(item.label));
  const displayName = user?.name || user?.email || "Account";
  const initials = getInitials(displayName);

  useEffect(() => {
    const supabase = createClient();
    let isMounted = true;

    async function loadUser() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (isMounted) {
        setUser(user ? mapSupabaseUser(user) : null);
      }
    }

    void loadUser();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ? mapSupabaseUser(session.user) : null);
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    const next = `${window.location.pathname}${window.location.search}`;
    setSignInHref(`/auth/login?next=${encodeURIComponent(next)}`);
  }, []);

  return (
    <>
      <div
        className="pointer-events-none fixed inset-x-0 top-0 z-[25] h-[clamp(64px,8vh,86px)] bg-[linear-gradient(180deg,rgb(0_0_0_/_0.82),rgb(0_0_0_/_0.5)_42%,rgb(0_0_0_/_0.12)_78%,transparent),linear-gradient(90deg,transparent,rgb(255_255_255_/_0.03)_42%,rgb(255_255_255_/_0.04)_58%,transparent)] backdrop-blur-xl [mask-image:linear-gradient(180deg,black_0_68%,transparent_100%)]"
        aria-hidden="true"
      />
      <Link
        className="fixed left-3 top-4 z-40 flex items-center gap-2 text-[14px] font-semibold tracking-normal text-white sm:left-4 sm:top-5"
        href="/"
        aria-label={`${brand.name} home`}
      >
        <BrandMark className="h-[18px] w-[18px] gap-[3px]" />
        <span className="hidden sm:inline">{brand.name}</span>
      </Link>

      <nav
        className="fixed left-[54px] right-[118px] top-2 z-40 flex h-11 items-center gap-1 overflow-x-auto rounded-full border border-white/[0.11] bg-black/35 p-1.5 shadow-[0_18px_70px_rgb(0_0_0_/_0.62),inset_0_1px_0_rgb(255_255_255_/_0.08),inset_0_-1px_0_rgb(255_255_255_/_0.035)] backdrop-blur-xl [scrollbar-width:none] before:pointer-events-none before:absolute before:inset-x-4 before:top-0 before:h-px before:bg-[linear-gradient(90deg,transparent,rgb(255_255_255_/_0.34),transparent)] [&::-webkit-scrollbar]:hidden md:left-1/2 md:right-auto md:w-auto md:-translate-x-1/2"
        aria-label={ariaLabel}
      >
        {navItems.map((item) => (
          <Link
            key={item.label}
            className={`${navItemClass} ${
              item.label === activeLabel
                ? "bg-white/[0.18] text-white shadow-[0_8px_24px_rgb(0_0_0_/_0.28),inset_0_1px_0_rgb(255_255_255_/_0.09)]"
                : ""
            }`}
            href={item.href}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="fixed right-3 top-2 z-40 flex h-11 items-center gap-2 sm:right-4">
        <div className="hidden items-center gap-1 md:flex">
          {utilityItems.map((item) => (
            <Link
              key={item.label}
            className="inline-flex h-9 items-center rounded-full px-3 text-[12px] font-medium text-white/58 transition hover:bg-white/[0.07] hover:text-white"
            href={item.href}
          >
              {item.label}
            </Link>
          ))}
        </div>

        {user ? (
          <UserMenu
            displayName={displayName}
            email={user.email}
            avatarUrl={user.avatarUrl}
            initials={initials}
          />
        ) : (
          <SignInButton href={signInHref} />
        )}
      </div>
    </>
  );
}

function SignInButton({ href }: { href: string }) {
  return (
    <Button
      asChild
      className="h-9 rounded-full px-4 text-[12px] font-semibold shadow-[0_14px_44px_rgb(0_0_0_/_0.28)]"
    >
      <Link href={href}>Sign in</Link>
    </Button>
  );
}

function UserMenu({
  displayName,
  email,
  avatarUrl,
  initials,
}: {
  displayName: string;
  email?: string;
  avatarUrl?: string;
  initials: string;
}) {
  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.assign("/");
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="grid h-9 w-9 place-items-center overflow-hidden rounded-full border border-white/[0.13] bg-white/[0.08] text-[12px] font-black text-white shadow-[inset_0_1px_0_rgb(255_255_255_/_0.08)] outline-none transition hover:bg-white/[0.13] focus-visible:ring-2 focus-visible:ring-white/30"
          type="button"
          aria-label="Open account menu"
        >
          {avatarUrl ? (
            <img className="h-full w-full object-cover" src={avatarUrl} alt="" aria-hidden="true" />
          ) : (
            initials
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>
          <span className="block truncate">{displayName}</span>
          {email ? <span className="mt-1 block truncate text-[11px] font-semibold text-white/42">{email}</span> : null}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings">
            <Settings size={15} />
            Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/settings/api-keys">
            <KeyRound size={15} />
            API keys
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/subscription">
            <CreditCard size={15} />
            Subscription
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/pricing">
            <WalletCards size={15} />
            Pricing
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-red-100 focus:bg-red-500/16 focus:text-red-50" onSelect={signOut}>
            <LogOut size={15} />
            Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function getInitials(value: string) {
  const parts = value
    .replace(/@.*/, "")
    .split(/\s|[._-]/)
    .filter(Boolean);

  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "U";
}

function mapSupabaseUser(user: {
  id: string;
  email?: string;
  user_metadata?: {
    full_name?: string;
    name?: string;
    avatar_url?: string;
    picture?: string;
  };
}): NavUser {
  return {
    id: user.id,
    email: user.email,
    name: user.user_metadata?.full_name ?? user.user_metadata?.name,
    avatarUrl: user.user_metadata?.avatar_url ?? user.user_metadata?.picture,
  };
}
