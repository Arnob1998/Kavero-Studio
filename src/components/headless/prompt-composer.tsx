"use client";

import type {
  ComponentPropsWithoutRef,
  FormEvent,
  KeyboardEvent,
  ReactNode,
  TextareaHTMLAttributes,
} from "react";
import { useLayoutEffect, useRef } from "react";

type ButtonType = "button" | "submit";

export interface PromptComposerAction {
  label: string;
  icon: ReactNode;
  onClick?: () => void;
  type?: ButtonType;
  className?: string;
}

export interface PromptComposerClassNames {
  root?: string;
  leadingSlot?: string;
  leadingButton?: string;
  textarea?: string;
  attachmentsSlot?: string;
  actionsSlot?: string;
  actionButton?: string;
  submitButton?: string;
  submitLabel?: string;
  mobileSubmitIcon?: string;
  desktopSubmitIcon?: string;
}

interface PromptComposerProps extends Omit<ComponentPropsWithoutRef<"form">, "onSubmit"> {
  value: string;
  onValueChange: (value: string) => void;
  onSubmit?: (value: string) => void;
  isLoading?: boolean;
  placeholder?: string;
  ariaLabel?: string;
  leadingAction?: PromptComposerAction;
  actions?: PromptComposerAction[];
  attachmentsSlot?: ReactNode;
  submitLabel?: string;
  submitIcon?: ReactNode;
  mobileSubmitIcon?: ReactNode;
  maxHeight?: number | string;
  disableAutosize?: boolean;
  classNames?: PromptComposerClassNames;
  textareaProps?: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange" | "placeholder">;
}

function joinClasses(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export function PromptComposer({
  value,
  onValueChange,
  onSubmit,
  isLoading = false,
  placeholder = "Describe...",
  ariaLabel = "Prompt",
  leadingAction,
  actions = [],
  attachmentsSlot,
  submitLabel = "Submit",
  submitIcon,
  mobileSubmitIcon,
  maxHeight = 240,
  disableAutosize = false,
  classNames = {},
  textareaProps,
  ...formProps
}: PromptComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;

    if (!textarea || disableAutosize) {
      return;
    }

    textarea.style.height = "auto";

    if (typeof maxHeight === "number") {
      textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
    } else {
      textarea.style.height = `min(${textarea.scrollHeight}px, ${maxHeight})`;
    }
  }, [disableAutosize, maxHeight, value]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit?.(value);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    textareaProps?.onKeyDown?.(event);

    if (event.defaultPrevented || !onSubmit) {
      return;
    }

    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      onSubmit(value);
    }
  };

  return (
    <form {...formProps} className={classNames.root} onSubmit={handleSubmit}>
      {leadingAction && (
        <div className={classNames.leadingSlot}>
          <button
            className={classNames.leadingButton}
            type={leadingAction.type ?? "button"}
            aria-label={leadingAction.label}
            onClick={leadingAction.onClick}
          >
            {leadingAction.icon}
          </button>
        </div>
      )}

      <textarea
        {...textareaProps}
        ref={textareaRef}
        className={joinClasses(classNames.textarea, textareaProps?.className)}
        aria-label={ariaLabel}
        placeholder={placeholder}
        rows={textareaProps?.rows ?? 1}
        style={{
          ...textareaProps?.style,
          maxHeight: typeof maxHeight === "number" ? `${maxHeight}px` : maxHeight,
        }}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        onKeyDown={handleKeyDown}
      />

      {attachmentsSlot && <div className={classNames.attachmentsSlot}>{attachmentsSlot}</div>}

      <div className={classNames.actionsSlot}>
        {actions.map((action) => (
          <button
            key={action.label}
            className={joinClasses(classNames.actionButton, action.className)}
            type={action.type ?? "button"}
            aria-label={action.label}
            onClick={action.onClick}
          >
            {action.icon}
          </button>
        ))}
        <button className={classNames.submitButton} type="submit" aria-label={submitLabel} disabled={isLoading}>
          {submitIcon && <span className={classNames.desktopSubmitIcon}>{submitIcon}</span>}
          <span className={classNames.submitLabel}>{submitLabel}</span>
          {mobileSubmitIcon && <span className={classNames.mobileSubmitIcon}>{mobileSubmitIcon}</span>}
        </button>
      </div>
    </form>
  );
}
