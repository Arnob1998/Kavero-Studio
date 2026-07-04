import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  LoaderCircle,
  Send,
  Sparkles,
  Square as StopSquare,
  Wrench,
  XCircle,
} from "lucide-react";
import type { AssistantMessage, AssistantStatus, AssistantToolCall } from "../types";

export function CopilotPanel({
  messages,
  toolCalls,
  input,
  error,
  busy,
  status,
  onInputChange,
  onStop,
  onSend,
  onApprovePending,
  onRejectPending,
  onCustomizePending,
}: {
  messages: AssistantMessage[];
  toolCalls: AssistantToolCall[];
  input: string;
  error: string | null;
  busy: boolean;
  status: AssistantStatus;
  onInputChange: (value: string) => void;
  onStop: () => void;
  onSend: () => void;
  onApprovePending: () => void;
  onRejectPending: () => void;
  onCustomizePending: (instruction: string) => void;
}) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [customizing, setCustomizing] = useState(false);
  const [customInstruction, setCustomInstruction] = useState("");
  const [activityOpen, setActivityOpen] = useState(false);
  const pendingCalls = toolCalls.filter((call) => call.status === "pending");
  const activityCalls = toolCalls.slice(0, 12);
  const hasOnlyWelcome = messages.length === 1 && messages[0]?.id === "assistant-welcome";
  const statusText =
    pendingCalls.length > 0
      ? "Waiting for review"
      : busy && status === "executing"
        ? "Applying canvas tools"
        : busy && status === "verifying"
          ? "Checking the updated canvas"
          : busy && status === "repairing"
            ? "Revising the proposal"
            : busy && status === "awaiting_review"
              ? "Waiting for review"
              : busy
                ? "Planning next edits"
                : toolCalls[0]?.status === "applied"
                  ? `Last: ${toolCalls[0].summary}`
                  : "Ready for canvas edits";
  const suggestions = [
    "Make the selected layer feel more premium",
    "Add a bold headline and supporting copy",
    "Clean up spacing and align the scene",
  ];

  useEffect(() => {
    if (typeof messagesEndRef.current?.scrollIntoView === "function") {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, busy]);

  return (
    <div className="flex h-full flex-col overflow-x-hidden bg-[linear-gradient(180deg,rgb(255_255_255_/_0.035),transparent_32%)]">
      <div className="shrink-0 border-b border-white/[0.07] px-4 pb-3">
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.04] p-3 shadow-[inset_0_1px_0_rgb(255_255_255_/_0.06)]">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-accent/18 text-accent ring-1 ring-accent/24">
                <Sparkles size={15} />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[12px] font-black text-white/82">Canvas Copilot</span>
                <span className="mt-0.5 block truncate text-[10px] font-semibold text-white/38">{statusText}</span>
              </span>
            </div>
            <button
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-xl border border-white/[0.08] bg-black/20 px-2 text-[10px] font-black text-white/46 transition hover:bg-white/[0.06] hover:text-white/70"
              onClick={() => setActivityOpen((open) => !open)}
              type="button"
              aria-expanded={activityOpen}
              aria-label="Toggle Copilot activity history"
            >
              <span className={`h-2 w-2 rounded-full ${busy ? "animate-pulse bg-amber-300" : "bg-emerald-400"}`} />
              <Wrench size={11} />
              {toolCalls.length}
            </button>
            {busy ? (
              <button
                className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-xl border border-red-300/18 bg-red-500/12 px-2 text-[10px] font-black text-red-100/78 transition hover:bg-red-500/20 hover:text-red-50"
                onClick={onStop}
                type="button"
                title="Stop Copilot"
              >
                <StopSquare size={11} />
                Stop
              </button>
            ) : null}
          </div>
          {activityOpen && (
            <div className="mt-3 max-h-56 overflow-y-auto overflow-x-hidden rounded-xl border border-white/[0.07] bg-black/24 p-2 [scrollbar-color:rgb(255_255_255_/_0.22)_transparent]">
              {activityCalls.length > 0 ? (
                <div className="grid gap-1.5">
                  {activityCalls.map((call) => (
                    <ToolCallRow key={call.id} call={call} />
                  ))}
                </div>
              ) : (
                <div className="px-2 py-3 text-center text-[10px] font-semibold text-white/34">
                  No Copilot activity yet
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 [scrollbar-color:rgb(255_255_255_/_0.25)_transparent]">
        <div className="flex flex-col gap-4">
          {messages.map((message) => (
            <div key={message.id} className={`flex gap-2.5 ${message.role === "user" ? "justify-end" : "justify-start"}`}>
              {message.role === "system" ? (
                <p className="w-full rounded-lg border border-white/[0.06] bg-white/[0.025] px-2 py-1.5 text-center text-[10px] font-semibold text-white/34">
                  {message.content}
                </p>
              ) : (
                <>
                  {message.role === "assistant" && (
                    <span className="mt-1 grid h-7 w-7 shrink-0 place-items-center rounded-xl border border-white/[0.08] bg-white/[0.05] text-white/46">
                      <Bot size={13} />
                    </span>
                  )}
                  <div
                    className={`max-w-[82%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-[12px] font-medium leading-5 shadow-[inset_0_1px_0_rgb(255_255_255_/_0.06)] ${
                      message.role === "user"
                        ? "rounded-br-md bg-accent text-white shadow-[0_14px_34px_rgb(59_130_246_/_0.22)]"
                        : "rounded-bl-md border border-white/[0.08] bg-white/[0.055] text-white/78"
                    }`}
                  >
                    {message.content}
                  </div>
                </>
              )}
            </div>
          ))}

          {hasOnlyWelcome && (
            <div className="grid gap-2">
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  className="group flex items-center justify-between gap-3 rounded-xl border border-white/[0.08] bg-white/[0.035] px-3 py-2.5 text-left text-[11px] font-semibold text-white/54 transition hover:border-accent/35 hover:bg-accent/10 hover:text-white/78"
                  onClick={() => onInputChange(suggestion)}
                >
                  <span className="truncate">{suggestion}</span>
                  <Sparkles size={12} className="shrink-0 text-white/26 transition group-hover:text-accent/80" />
                </button>
              ))}
            </div>
          )}

          {busy && (
            <div className="flex justify-start">
              <div className="flex items-center gap-2 rounded-2xl rounded-bl-md border border-white/[0.08] bg-white/[0.055] px-3 py-2.5 text-white/60">
                <span className="flex items-center gap-1">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-white/40" style={{ animationDelay: "0ms" }} />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-white/40" style={{ animationDelay: "160ms" }} />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-white/40" style={{ animationDelay: "320ms" }} />
                </span>
                <span className="text-[10px] font-semibold text-white/42">{statusText}</span>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {pendingCalls.length > 0 && (
        <div className="shrink-0 flex flex-col gap-2 border-t border-amber-300/12 bg-amber-500/[0.055] px-4 py-3">
          <div className="rounded-2xl border border-amber-300/20 bg-black/24 p-3">
            <div className="flex items-start gap-2">
              <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-300/80" />
              <span className="min-w-0 flex-1">
                <span className="block text-[11px] font-black uppercase tracking-[0.08em] text-amber-100/56">
                  Review proposed changes
                </span>
                <span className="mt-1 block text-[11px] font-semibold leading-4 text-white/72">
                  {pendingCalls.length === 1 ? pendingCalls[0]?.summary : `${pendingCalls.length} canvas actions need approval.`}
                </span>
              </span>
            </div>
            <div className="mt-3 grid gap-1.5">
              {pendingCalls.map((call) => (
                <div key={call.id} className="min-w-0 overflow-hidden break-words rounded-lg border border-white/[0.06] bg-white/[0.03] px-2 py-1.5 text-[10px] font-semibold leading-4 text-white/44">
                  {call.toolName} / {call.summary}
                </div>
              ))}
            </div>
            {customizing && (
              <textarea
                className="mt-3 min-h-[68px] w-full resize-none rounded-xl border border-white/[0.1] bg-white/[0.055] px-3 py-2 text-[12px] font-medium leading-5 text-white/80 outline-none placeholder:text-white/30 focus:border-accent/50"
                value={customInstruction}
                onChange={(event) => setCustomInstruction((event.target as HTMLTextAreaElement).value)}
                placeholder="Tell Copilot what to change about this proposal..."
                disabled={busy}
              />
            )}
            <div className="mt-3 grid grid-cols-3 gap-2">
              <button
                className="h-8 rounded-xl bg-emerald-400/16 text-[10px] font-black uppercase tracking-wide text-emerald-200 transition hover:bg-emerald-400/24 disabled:opacity-40"
                onClick={onApprovePending}
                disabled={busy}
              >
                Approve
              </button>
              <button
                className="h-8 rounded-xl border border-white/[0.08] bg-white/[0.04] text-[10px] font-black uppercase tracking-wide text-white/46 transition hover:bg-white/[0.075] hover:text-white/70 disabled:opacity-40"
                onClick={onRejectPending}
                disabled={busy}
              >
                Reject
              </button>
              <button
                className="h-8 rounded-xl border border-accent/24 bg-accent/10 text-[10px] font-black uppercase tracking-wide text-accent/90 transition hover:bg-accent/16 disabled:opacity-40"
                onClick={() => {
                  if (!customizing) {
                    setCustomizing(true);
                    return;
                  }
                  const instruction = customInstruction.trim();
                  if (!instruction) return;
                  onCustomizePending(instruction);
                  setCustomInstruction("");
                  setCustomizing(false);
                }}
                disabled={busy}
              >
                {customizing ? "Use" : "Customize"}
              </button>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="mx-4 mb-3 shrink-0 rounded-2xl border border-red-300/18 bg-red-500/10 px-3 py-2.5 text-[11px] font-semibold leading-4 text-red-100/72">
          {error}
        </div>
      )}

      <div className="shrink-0 border-t border-white/[0.07] bg-black/24 p-4">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSend();
          }}
        >
          <div className="rounded-2xl border border-white/[0.1] bg-white/[0.055] p-2 shadow-[inset_0_1px_0_rgb(255_255_255_/_0.07)] transition focus-within:border-accent/55 focus-within:bg-white/[0.075]">
            <textarea
              className="max-h-32 min-h-[74px] w-full resize-none bg-transparent px-1.5 py-1 text-[13px] font-medium leading-5 text-white/84 outline-none placeholder:text-white/28"
              rows={3}
              value={input}
              onChange={(event) => onInputChange((event.target as HTMLTextAreaElement).value)}
              placeholder="Ask Copilot to inspect or propose an edit..."
              disabled={busy}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  onSend();
                }
              }}
            />
            <div className="mt-2 flex items-center justify-between gap-2 border-t border-white/[0.07] pt-2">
              <span className="truncate text-[10px] font-semibold text-white/30">
                {busy ? "Working on the canvas" : "Enter to send"}
              </span>
              {busy ? (
                <button
                  className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-xl border border-red-300/18 bg-red-500/14 px-3 text-[11px] font-black text-red-100/82 transition hover:bg-red-500/22"
                  type="button"
                  onClick={onStop}
                >
                  <StopSquare size={12} />
                  Stop
                </button>
              ) : (
                <button
                  className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-xl bg-accent px-3 text-[11px] font-black text-white shadow-[0_12px_26px_rgb(59_130_246_/_0.24)] transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
                  disabled={!input.trim()}
                  type="submit"
                >
                  <Send size={12} />
                  Send
                </button>
              )}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

function ToolCallRow({ call }: { call: AssistantToolCall }) {
  const statusMeta = {
    applied: { icon: CheckCircle2, className: "text-emerald-300/76", label: "Applied" },
    error: { icon: XCircle, className: "text-red-300/76", label: "Failed" },
    rejected: { icon: XCircle, className: "text-white/34", label: "Skipped" },
    pending: { icon: LoaderCircle, className: "text-amber-300/76", label: "Pending" },
  }[call.status];
  const Icon = statusMeta.icon;

  return (
    <div className="min-w-0 overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.03] px-2.5 py-2">
      <div className="flex min-w-0 items-start gap-2">
        <Icon size={13} className={`mt-0.5 shrink-0 ${statusMeta.className} ${call.status === "pending" ? "animate-spin" : ""}`} />
        <span className="min-w-0 flex-1">
          <span className="block whitespace-normal break-words text-[11px] font-semibold leading-4 text-white/64">{call.summary}</span>
          <span className="mt-0.5 block whitespace-normal break-words font-mono text-[9px] uppercase tracking-[0.06em] text-white/28">
            {statusMeta.label} / {call.toolName}
          </span>
        </span>
      </div>
    </div>
  );
}
