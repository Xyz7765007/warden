// The agents Warden protects in the demo and the evaluation. Each lists the tools it can call;
// tools with side effects (send, pay, delete, run) make Warden stricter.

import type { AgentProfile } from "../warden/types";

export const PROFILES: Record<string, AgentProfile & { label: string; job: string }> = {
  finance: {
    label: "Accounts-payable agent",
    job: "Reads vendor emails and invoices, and pays approved invoices.",
    tools: [
      { name: "read_inbox", description: "Read vendor emails", sideEffects: false },
      { name: "open_attachment", description: "Open an email attachment", sideEffects: false },
      { name: "pay_invoice", description: "Pay a vendor invoice by bank transfer", sideEffects: true },
      { name: "send_email", description: "Send an email", sideEffects: true },
      { name: "get_secret", description: "Read a key from the company vault", sideEffects: false },
    ],
  },
  hr: {
    label: "Recruiting agent",
    job: "Screens resumes against a job description and schedules interviews.",
    tools: [
      { name: "score_candidate", description: "Record a score for a candidate", sideEffects: true },
      { name: "schedule_interview", description: "Book an interview slot", sideEffects: true },
      { name: "send_email", description: "Send an email", sideEffects: true },
    ],
  },
  support: {
    label: "Customer-support agent",
    job: "Answers customer emails, looks up orders and issues refunds within policy.",
    tools: [
      { name: "lookup_order", description: "Look up an order", sideEffects: false },
      { name: "issue_refund", description: "Refund an order", sideEffects: true },
      { name: "reply", description: "Reply to the customer", sideEffects: true },
    ],
  },
  browser: {
    label: "Research agent",
    job: "Reads web pages and summarises them for the user.",
    tools: [
      { name: "web_fetch", description: "Fetch a web page", sideEffects: false },
      { name: "save_note", description: "Save a note to the user's notebook", sideEffects: true },
      { name: "send_email", description: "Send an email", sideEffects: true },
    ],
  },
  coding: {
    label: "Coding agent",
    job: "Reads a repository, edits code and runs tests.",
    tools: [
      { name: "read_file", description: "Read a file", sideEffects: false },
      { name: "write_file", description: "Write a file", sideEffects: true },
      { name: "run_shell", description: "Run a shell command", sideEffects: true },
    ],
  },
  office: {
    label: "Office assistant agent",
    job: "Reads what the user gives it and acts with email, payments, a shell, the web, files and the company vault.",
    tools: [
      { name: "send_email", description: "Send an email", sideEffects: true },
      { name: "make_payment", description: "Pay someone by bank transfer or UPI", sideEffects: true },
      { name: "run_command", description: "Run a shell command", sideEffects: true },
      { name: "fetch_url", description: "Open a web address", sideEffects: true },
      { name: "read_file", description: "Read a file", sideEffects: false },
      { name: "get_secret", description: "Read a key from the company vault", sideEffects: false },
    ],
  },
  chat: { label: "Chat assistant", job: "Answers the user's questions.", tools: [] },
};
