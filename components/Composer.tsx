import type { KeyboardEvent } from "react";

type ComposerProps = {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  disabled: boolean;
  placeholder: string;
};

export default function Composer({ value, onChange, onSubmit, disabled, placeholder }: ComposerProps) {
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (!disabled) {
        onSubmit();
      }
    }
  };

  return (
    <div className="sticky bottom-0 mt-auto border-t border-slate-200 bg-white/80 px-4 py-3 backdrop-blur dark:border-slate-700 dark:bg-slate-950/80">
      <label className="sr-only" htmlFor="message-input">
        Message
      </label>
      <div className="flex items-end gap-3">
        <textarea
          id="message-input"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={handleKeyDown}
          rows={2}
          placeholder={placeholder}
          className="flex-1 resize-none rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm caret-slate-900 placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-200 focus-visible:border-slate-400 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100/70 disabled:text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:caret-slate-100 dark:placeholder:text-slate-500 dark:focus-visible:border-slate-500 dark:focus-visible:ring-slate-700 dark:disabled:border-slate-700 dark:disabled:bg-slate-900/60 dark:disabled:text-slate-400"
        />
        <button
          type="button"
          onClick={onSubmit}
          disabled={disabled}
          className="inline-flex items-center justify-center rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200 dark:disabled:bg-slate-700 dark:disabled:text-slate-400 dark:focus-visible:ring-slate-600"
        >
          Send
        </button>
      </div>
      <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">
        Press Enter to send, Shift + Enter for a new line.
      </p>
    </div>
  );
}
