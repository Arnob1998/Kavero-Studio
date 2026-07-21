"use client";

import type { ComponentType } from "react";
import { ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type ModelQuickPickerOption = {
  value: string;
  label: string;
  description?: string;
};

type ModelQuickPickerProps = {
  label: string;
  icon: ComponentType<{ size?: number; className?: string }>;
  value: string;
  options: readonly ModelQuickPickerOption[];
  emptyLabel: string;
  onSelect: (value: string) => void;
};

export function ModelQuickPicker({
  label,
  icon: Icon,
  value,
  options,
  emptyLabel,
  onSelect,
}: ModelQuickPickerProps) {
  const selected = options.find((option) => option.value === value);
  const disabled = options.length === 0;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button
          className="group grid h-[52px] min-w-0 grid-cols-[34px_minmax(0,1fr)_16px] items-center gap-2 rounded-xl border border-white/[0.1] bg-black/48 px-2.5 text-left shadow-[0_12px_36px_rgb(0_0_0_/_0.3),inset_0_1px_0_rgb(255_255_255_/_0.06)] backdrop-blur-xl transition hover:border-white/[0.18] hover:bg-white/[0.065] disabled:cursor-not-allowed disabled:opacity-55"
          type="button"
          aria-label={`${label}: ${selected?.label ?? emptyLabel}`}
        >
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent/14 text-accent transition group-hover:bg-accent/20">
            <Icon size={16} />
          </span>
          <span className="min-w-0">
            <span className="block text-[9px] font-black uppercase tracking-[0.08em] text-white/38">{label}</span>
            <span className="mt-0.5 block truncate text-[11px] font-extrabold text-white/86">
              {selected?.label ?? emptyLabel}
            </span>
          </span>
          <ChevronDown size={14} className="text-white/40 transition group-data-[state=open]:rotate-180" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-[min(300px,calc(100vw-24px))]">
        <DropdownMenuLabel className="text-[10px] uppercase tracking-[0.08em] text-white/42">
          {label}
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup value={value} onValueChange={onSelect}>
          {options.map((option) => (
            <DropdownMenuRadioItem
              key={option.value}
              value={option.value}
              className="block"
            >
              <span className="min-w-0">
                <span className="block truncate text-[12px] font-extrabold text-white/88">{option.label}</span>
                {option.description ? (
                  <span className="mt-0.5 block truncate text-[10px] font-semibold text-white/42">
                    {option.description}
                  </span>
                ) : null}
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
