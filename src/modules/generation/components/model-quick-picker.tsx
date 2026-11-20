"use client";

import type { ComponentType, ReactElement } from "react";
import Image from 'next/image';
import { ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type ModelQuickPickerOption = {
  value: string;
  label: string;
  description?: string;
  disabledReason?: string;
  location?: string;
  logo?: string;
};

type ModelQuickPickerProps = {
  label: string;
  icon: ComponentType<{ size?: number; className?: string }>;
  value: string;
  options: readonly ModelQuickPickerOption[];
  emptyLabel: string;
  onSelect: (value: string) => void;
  disabled?: boolean;
  footer?: ReactElement;
};

export function ModelQuickPicker({
  label,
  icon: Icon,
  value,
  options,
  emptyLabel,
  onSelect,
  disabled: blocked = false,
  footer,
}: ModelQuickPickerProps) {
  const selected = options.find((option) => option.value === value);
  const disabled = blocked || options.length === 0;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button
          className="group grid h-[52px] min-w-0 grid-cols-[34px_minmax(0,1fr)_16px] items-center gap-2 rounded-xl border border-white/[0.1] bg-black/48 px-2.5 text-left shadow-[0_12px_36px_rgb(0_0_0_/_0.3),inset_0_1px_0_rgb(255_255_255_/_0.06)] backdrop-blur-xl transition hover:border-white/[0.18] hover:bg-white/[0.065] disabled:cursor-not-allowed disabled:opacity-55"
          type="button"
          aria-label={`${label}: ${selected?.label ?? emptyLabel}${selected?.location ? ` — ${selected.location}` : ''}`}
        >
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent/14 text-accent transition group-hover:bg-accent/20">
            {selected?.logo ? <Image src={selected.logo} alt="" width={24} height={24} className="h-6 w-6 object-contain"/> : <Icon size={16} />}
          </span>
          <span className="min-w-0">
            <span className="block text-[9px] font-black uppercase tracking-[0.08em] text-white/38">{label}{selected?.location ? ` · ${selected.location}` : ''}</span>
            <span className="mt-0.5 block truncate text-[11px] font-extrabold text-white/86">
              {selected?.label ?? emptyLabel}
            </span>
          </span>
          <ChevronDown size={14} className="text-white/40 transition group-data-[state=open]:rotate-180" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-[65svh] w-[min(380px,calc(100vw-24px))] overflow-y-auto">
        <DropdownMenuLabel className="text-[10px] uppercase tracking-[0.08em] text-white/42">
          {label}
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup value={value} onValueChange={next => { if (!options.find(option => option.value === next)?.disabledReason) onSelect(next); }}>
          {options.map((option) => (
            <DropdownMenuRadioItem
              key={option.value}
              value={option.value}
              disabled={Boolean(option.disabledReason)}
              className="block"
            >
              <span className="flex items-start gap-3">{option.logo&&<Image src={option.logo} alt="" width={24} height={24} className="mt-1 h-6 w-6 shrink-0 object-contain"/>}<span className="min-w-0">
                <span className="block truncate text-[12px] font-extrabold text-white/88">{option.label}</span>
                {option.description ? (
                  <span className="mt-0.5 block whitespace-normal text-[10px] font-semibold text-white/42">
                    {option.description}
                  </span>
                ) : null}
                {option.disabledReason && <span className="mt-1 block whitespace-normal text-[10px] text-amber-200/80">{option.disabledReason}</span>}
              </span></span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {footer && <DropdownMenuItem asChild>{footer}</DropdownMenuItem>}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
