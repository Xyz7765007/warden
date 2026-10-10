"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const LINKS = [
  { href: "/", label: "Scan" },
  { href: "/agent", label: "Live attack" },
  { href: "/redteam", label: "Red team" },
  { href: "/proof", label: "Proof" },
  { href: "/how", label: "How it works" },
  { href: "/developers", label: "API" },
];

export function Mark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="1.5" y="1.5" width="21" height="21" rx="6" fill="#17171c" />
      <rect x="6.5" y="6" width="3" height="12" rx="1.2" fill="#fff" />
      <rect x="14.5" y="6" width="3" height="12" rx="1.2" fill="#d0281b" />
    </svg>
  );
}

interface Health {
  layers: Record<string, "on" | "off">;
  judgeModel: string | null;
}

export function Nav() {
  const path = usePathname();
  const [health, setHealth] = useState<Health | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);
  const on = health ? Object.values(health.layers).filter((v) => v === "on").length : null;
  const total = health ? Object.keys(health.layers).length : null;
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg/85 backdrop-blur supports-[backdrop-filter]:bg-bg/70">
      <div className="mx-auto flex h-16 max-w-[1240px] items-center gap-6 px-5">
        <Link href="/" className="flex shrink-0 items-center gap-2.5" aria-label="Warden home">
          <Mark />
          <span className="text-[17px] font-semibold tracking-tight">Warden</span>
        </Link>
        <nav className="hidden flex-1 items-center gap-1 md:flex" aria-label="Main">
          {LINKS.map((l) => {
            const active = l.href === "/" ? path === "/" : path.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`rounded-[8px] px-3 py-1.5 text-[14px] transition-colors ${active ? "bg-surface text-ink shadow-[var(--shadow-card)]" : "text-muted hover:text-ink"}`}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <div className="group relative hidden sm:block">
            <span className="flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-[12.5px] text-muted" data-testid="layer-status">
              <span className={`h-1.5 w-1.5 rounded-full ${health ? "bg-safe" : "bg-faint"}`} />
              {health ? `${on} of ${total} layers on` : "Checking layers"}
            </span>
            {health && (
              <div className="pointer-events-none absolute right-0 top-9 w-64 rounded-[12px] border border-line bg-surface p-3 text-[12.5px] opacity-0 shadow-[var(--shadow-pop)] transition-opacity group-hover:opacity-100">
                {Object.entries(health.layers).map(([k, v]) => (
                  <div key={k} className="flex justify-between py-0.5">
                    <span className="text-ink-2">{LAYER_NAMES[k] ?? k}</span>
                    <span className={v === "on" ? "text-safe" : "text-faint"}>{v === "on" ? "On" : "Off"}</span>
                  </div>
                ))}
                {!health.judgeModel && <p className="mt-2 border-t border-line pt-2 text-faint">The LLM judge switches on when the server has an Anthropic API key.</p>}
              </div>
            )}
          </div>
          <button className="rounded-[8px] px-2 py-1.5 text-[14px] text-muted md:hidden" onClick={() => setOpen(!open)} aria-expanded={open} aria-label="Menu">
            Menu
          </button>
        </div>
      </div>
      {open && (
        <nav className="border-t border-line bg-surface px-5 py-2 md:hidden" aria-label="Main mobile">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} onClick={() => setOpen(false)} className="block rounded-[8px] px-2 py-2 text-[15px] text-ink-2">
              {l.label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}

const LAYER_NAMES: Record<string, string> = {
  readers: "Hidden-content readers",
  decoders: "Decoders",
  patterns: "Attack patterns",
  taskBinding: "Task check",
  classifier: "Trained classifier",
  ocr: "OCR for images",
  llmJudge: "LLM judge",
};
