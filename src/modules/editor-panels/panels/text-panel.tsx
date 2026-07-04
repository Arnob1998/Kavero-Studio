export function TextPanel({ addText }: { addText: (kind: "heading" | "subheading" | "body") => void }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="mb-1 text-[11px] font-semibold text-white/38">Click to add text</p>
      <button
        className="group w-full rounded-xl border border-white/[0.08] bg-white/[0.045] p-3 text-left transition-all hover:border-accent/45 hover:bg-accent/10"
        onClick={() => addText("heading")}
      >
        <span className="text-lg font-bold text-white transition-colors group-hover:text-accent">
          Add a heading
        </span>
        <span className="mt-0.5 block text-[10px] font-semibold text-white/38">
          Montserrat Bold, 48px
        </span>
      </button>
      <button
        className="group w-full rounded-xl border border-white/[0.08] bg-white/[0.045] p-3 text-left transition-all hover:border-accent/45 hover:bg-accent/10"
        onClick={() => addText("subheading")}
      >
        <span className="text-sm font-semibold text-white transition-colors group-hover:text-accent">
          Add a subheading
        </span>
        <span className="mt-0.5 block text-[10px] font-semibold text-white/38">
          Inter Medium, 32px
        </span>
      </button>
      <button
        className="group w-full rounded-xl border border-white/[0.08] bg-white/[0.045] p-3 text-left transition-all hover:border-accent/45 hover:bg-accent/10"
        onClick={() => addText("body")}
      >
        <span className="text-xs font-semibold text-white transition-colors group-hover:text-accent">
          Add body text
        </span>
        <span className="mt-0.5 block text-[10px] font-semibold text-white/38">
          Inter Regular, 18px
        </span>
      </button>
    </div>
  );
}
