"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type FeedbackActionsProps = {
  feedbackId: string;
  status: "ACTIVE" | "HIDDEN";
  variant?: "inline" | "block";
};

export default function FeedbackActions({
  feedbackId,
  status,
  variant = "inline",
}: FeedbackActionsProps) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isHidden = status === "HIDDEN";

  const handleAction = async () => {
    setIsSubmitting(true);
    try {
      await fetch(`/api/admin/feedback/${feedbackId}/${isHidden ? "unhide" : "hide"}`, {
        method: "POST",
      });
      router.refresh();
    } finally {
      setIsSubmitting(false);
    }
  };

  const buttonClasses =
    variant === "block"
      ? "w-full"
      : "";

  return (
    <button
      type="button"
      onClick={handleAction}
      disabled={isSubmitting}
      className={`rounded-lg border px-3 py-1 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${
        isHidden
          ? "border-emerald-400/60 text-emerald-200 hover:border-emerald-300"
          : "border-amber-400/60 text-amber-200 hover:border-amber-300"
      } ${buttonClasses}`}
    >
      {isSubmitting ? "Updating..." : isHidden ? "Unhide" : "Hide"}
    </button>
  );
}
