"use client";

import type { ReactNode, ButtonHTMLAttributes } from "react";
import { ATTACK_LABELS, DECISION_LABELS, SOURCE_LABELS, type AttackType, type Decision, type SourceKind } from "@/lib/warden/types";

export function Card({ children, className = "", ...rest }: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-card)] ${className}`} {...rest}>
      {children}
    </div>
  );
}

export function Button({ variant = "primary", className = "", children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger" }) {
  const styles = {
    primary: "bg-ink text-white hover:bg-[#2b2b33] disabled:bg-[#9a9aa3]",
    secondary: "border border-line-2 bg-surface text-ink hover:border-[#bdbdc5] disabled:text-faint",
    ghost: "text-ink-2 hover:bg-sunken disabled:text-faint",
    danger: "bg-threat text-white hover:bg-threat-ink",
  }[variant];
  return (
    <button
      className={`inline-flex h-9 items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-ctl)] px-3.5 text-[14px] font-medium transition-[background,transform,border-color] active:translate-y-[1px] disabled:cursor-not-allowed ${styles} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Chip({ children, tone = "neutral", className = "" }: { children: ReactNode; tone?: "neutral" | "threat" | "safe" | "hold" | "ink"; className?: string }) {
  const t = {
    neutral: "border-line bg-sunken text-ink-2",
    threat: "border-threat-line bg-threat-soft text-threat-ink",
    safe: "border-safe-line bg-safe-soft text-safe",
    hold: "border-hold-line bg-hold-soft text-hold",
    ink: "border-ink bg-ink text-white",
  }[tone];
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[12px] font-medium ${t} ${className}`}>{children}</span>;
}

export const DECISION_TONE: Record<Decision, "safe" | "threat" | "hold"> = { allow: "safe", neutralize: "threat", quarantine: "hold", block: "threat" };

export function DecisionPill({ decision, large = false }: { decision: Decision; large?: boolean }) {
  const tone = DECISION_TONE[decision];
  const cls = {
    safe: "bg-safe text-white",
    threat: "bg-threat text-white",
    hold: "bg-hold text-white",
  }[tone];
  return <span className={`inline-flex items-center rounded-full font-semibold ${large ? "px-3.5 py-1 text-[15px]" : "px-2.5 py-0.5 text-[12.5px]"} ${cls}`}>{DECISION_LABELS[decision].label}</span>;
}

export function TypeChip({ type, muted = false }: { type: AttackType; muted?: boolean }) {
  return <Chip tone={muted ? "neutral" : "threat"}>{ATTACK_LABELS[type].label}</Chip>;
}

export function SourceChip({ source, guessed }: { source: SourceKind; guessed?: boolean }) {
  return (
    <Chip>
      {SOURCE_LABELS[source]}
      {guessed ? <span className="text-faint">, detected</span> : null}
    </Chip>
  );
}

export function Label({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-[12.5px] font-medium text-ink-2">
      {children}
    </label>
  );
}

export function Segmented<T extends string>({ value, options, onChange, size = "md", ariaLabel }: { value: T; options: Array<{ value: T; label: string; disabled?: boolean; title?: string }>; onChange: (v: T) => void; size?: "sm" | "md"; ariaLabel?: string }) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="inline-flex rounded-[10px] border border-line bg-sunken p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          disabled={o.disabled}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={`whitespace-nowrap rounded-[8px] ${size === "sm" ? "px-2.5 py-1 text-[12.5px]" : "px-3 py-1.5 text-[13.5px]"} font-medium transition-colors disabled:cursor-not-allowed disabled:text-faint ${value === o.value ? "bg-surface text-ink shadow-[var(--shadow-card)]" : "text-muted hover:text-ink"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Stat({ value, label, note }: { value: string; label: string; note?: string }) {
  return (
    <div>
      <div className="text-[30px] font-semibold leading-none tracking-tight tabular-nums">{value}</div>
      <div className="mt-2 text-[13.5px] text-ink-2">{label}</div>
      {note ? <div className="mt-1 text-[12px] text-faint">{note}</div> : null}
    </div>
  );
}
