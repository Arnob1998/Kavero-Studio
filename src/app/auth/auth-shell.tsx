import Link from "next/link";
import type { ReactNode } from "react";
import { BrandMark } from "@/components/brand";
import { brand } from "@/lib/brand";

const authImage =
  "/bg-image-assets/bg-in.jpg";

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main className="grid min-h-svh bg-[#0d0d0e] text-white lg:grid-cols-[minmax(460px,52vw)_minmax(460px,48vw)]">
      <section className="flex min-h-svh flex-col px-6 py-8 sm:px-10 lg:px-12">
        <Link
          className="grid h-11 w-11 place-items-center rounded-[13px] bg-white/[0.13] shadow-[inset_0_1px_0_rgb(255_255_255_/_0.08)] transition hover:bg-white/[0.17]"
          href="/"
          aria-label={`${brand.name} home`}
        >
          <BrandMark className="h-[26px] w-[26px] gap-[4px]" tileClassName="bg-white" />
        </Link>

        <div className="mx-auto flex w-full max-w-[440px] flex-1 flex-col justify-center py-12">
          <div className="text-center">
            <h1 className="text-[clamp(36px,4vw,44px)] font-bold leading-none tracking-normal text-white">
              {title}
            </h1>
            <p className="mt-4 text-[16px] font-medium text-white/62">{subtitle}</p>
          </div>

          <div className="mt-14">{children}</div>
        </div>

        <div className="mx-auto w-full max-w-[440px] pb-4 text-center text-[12px] leading-5 text-white/50">
          {footer ?? (
            <>
              <span>By signing up, you agree to our</span>
              <br />
              <Link className="font-semibold text-white hover:text-white/80" href="/">
                Terms of Service
              </Link>
              <span> & </span>
              <Link className="font-semibold text-white hover:text-white/80" href="/">
                Privacy Policy
              </Link>
            </>
          )}
        </div>
      </section>

      <section className="hidden min-h-svh p-2.5 lg:block">
        <div className="relative h-full overflow-hidden rounded-[10px] bg-[#17221d]">
          <img
            className="h-full w-full object-cover object-center"
            src={authImage}
            alt=""
            aria-hidden="true"
          />
          <div
            className="absolute inset-0 bg-[linear-gradient(90deg,rgb(0_0_0_/_0.58),transparent_32%,rgb(0_0_0_/_0.28)),linear-gradient(180deg,rgb(0_0_0_/_0.28),transparent_48%,rgb(0_0_0_/_0.5))]"
            aria-hidden="true"
          />
          <div className="absolute bottom-8 right-8 text-right text-[16px] font-bold leading-5 text-white drop-shadow-[0_2px_18px_rgb(0_0_0_/_0.8)]">
            <div>Created with</div>
            <div>{brand.imageLabel}</div>
          </div>
        </div>
      </section>
    </main>
  );
}
