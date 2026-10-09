import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Nav } from "@/components/Nav";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Warden: prompt-injection firewall for AI agents",
  description: "Warden checks everything an AI agent is about to read, finds hidden instructions in 11 kinds of content, cuts them out and lets the rest through.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  const repo = process.env.NEXT_PUBLIC_REPO_URL;
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <Nav />
        <main className="flex-1">{children}</main>
        <footer className="border-t border-line">
          <div className="mx-auto flex max-w-[1240px] flex-col gap-2 px-5 py-6 text-[13px] text-muted sm:flex-row sm:items-center sm:justify-between">
            <span>Warden. Built for the ET AI Hackathon 2026, Agentic Edition: Problem 2, prompt-injection firewall.</span>
            <span className="flex gap-4">
              {repo ? (
                <a className="hover:text-ink" href={repo}>
                  Source code
                </a>
              ) : null}
              <a className="hover:text-ink" href="/api/health">
                API status
              </a>
            </span>
          </div>
        </footer>
      </body>
    </html>
  );
}
