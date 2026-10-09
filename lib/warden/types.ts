// Shared types for the Warden engine. Everything a scan produces is described here,
// in the same words the UI uses, so the API and the screens never drift apart.

export const SOURCE_KINDS = [
  "user_message",
  "web_page",
  "pdf",
  "email",
  "markdown",
  "html",
  "docx",
  "api_response",
  "ocr_text",
  "source_code",
  "image",
] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export const SOURCE_LABELS: Record<SourceKind, string> = {
  user_message: "User message",
  web_page: "Web page",
  pdf: "PDF",
  email: "Email",
  markdown: "Markdown",
  html: "HTML",
  docx: "Word document",
  api_response: "API response",
  ocr_text: "OCR text",
  source_code: "Source code",
  image: "Image",
};

export const ATTACK_TYPES = [
  "instruction_override",
  "role_change",
  "secret_extraction",
  "tool_abuse",
  "credential_theft",
  "context_poisoning",
  "multi_step_jailbreak",
  "encoded_instructions",
  "indirect_injection",
] as const;
export type AttackType = (typeof ATTACK_TYPES)[number];

export const ATTACK_LABELS: Record<AttackType, { label: string; plain: string }> = {
  instruction_override: {
    label: "Instruction override",
    plain: "Tells the AI to drop its own rules and follow new ones.",
  },
  role_change: {
    label: "Role change",
    plain: "Tries to turn the AI into someone else: an admin, an unrestricted bot, a new persona.",
  },
  secret_extraction: {
    label: "Secret extraction",
    plain: "Asks the AI to reveal its hidden instructions, private data or keys.",
  },
  tool_abuse: {
    label: "Tool abuse",
    plain: "Tries to make the AI use its tools for the attacker: send, pay, run, delete.",
  },
  credential_theft: {
    label: "Credential theft",
    plain: "Goes after passwords, codes, tokens or key files.",
  },
  context_poisoning: {
    label: "Context poisoning",
    plain: "Plants a fake rule or fact for the AI to remember and act on later.",
  },
  multi_step_jailbreak: {
    label: "Multi-step jailbreak",
    plain: "Builds the attack across several messages or a staged script.",
  },
  encoded_instructions: {
    label: "Encoded instructions",
    plain: "Hides the order in base64, hex, invisible characters or look-alike letters.",
  },
  indirect_injection: {
    label: "Indirect prompt injection",
    plain: "The order arrives inside content the AI reads (a page, file, email or tool result), not from the user.",
  },
};

export type Visibility = "visible" | "hidden";

export type HiddenReason =
  | "white_text"
  | "tiny_text"
  | "invisible_render"
  | "off_page"
  | "css_hidden"
  | "html_comment"
  | "metadata"
  | "alt_text"
  | "attribute"
  | "faint_ink"
  | "invisible_unicode"
  | "word_hidden"
  | "doc_comment"
  | "annotation"
  | "link_title"
  | "alt_mime_part"
  | "code_comment";

export type SegmentRole =
  | "body"
  | "subject"
  | "header"
  | "metadata"
  | "comment"
  | "code"
  | "code_comment"
  | "code_string"
  | "tool_description"
  | "json_value"
  | "attachment"
  | "turn";

export type Provenance = "user" | "external";

export interface Segment {
  id: string;
  text: string;
  where: string;
  visibility: Visibility;
  hiddenReason?: HiddenReason;
  hiddenDetail?: string;
  role: SegmentRole;
  provenance: Provenance;
  /** For segments decoded out of another segment. */
  parentId?: string;
  parentSpan?: [number, number];
  decodedVia?: string;
  /** Text that only an AI reads by design (a tool description, a field named "instructions_for_ai"). */
  aiDirected?: boolean;
  /** Text that came from OCR (an image or a scan), so it may carry OCR misreads. */
  ocr?: boolean;
}

export type Layer =
  | "structure"
  | "decode"
  | "signature"
  | "classifier"
  | "judge"
  | "session"
  | "tool_registry";

export const LAYER_LABELS: Record<Layer, string> = {
  structure: "Hidden-content inspector",
  decode: "Decoder",
  signature: "Attack patterns",
  classifier: "Trained classifier",
  judge: "LLM judge",
  session: "Conversation memory",
  tool_registry: "Tool inspector",
};

export interface Finding {
  id: string;
  type: AttackType;
  /** Other types the same span also counts as (e.g. hidden + indirect). */
  also: AttackType[];
  segmentId: string;
  start: number;
  end: number;
  quote: string;
  confidence: number;
  severity: number;
  layer: Layer;
  rule: string;
  why: string;
  decodedText?: string;
  decodedVia?: string;
  /** Internal: why confidence was held down (a quoted mention, a capped weak signal, test data). */
  flags?: Array<"mention" | "capped" | "code_data" | "own">;
}

export type Decision = "allow" | "neutralize" | "quarantine" | "block";

export const DECISION_LABELS: Record<Decision, { label: string; plain: string }> = {
  allow: { label: "Safe", plain: "Nothing to stop. Passed to the agent, marked as outside content." },
  neutralize: { label: "Cleaned", plain: "The attack was cut out. The rest went through." },
  quarantine: { label: "Held for review", plain: "Not sure enough to pass or cut. A person decides." },
  block: { label: "Blocked", plain: "The content is mostly attack. Nothing went through." },
};

export interface TraceStep {
  step: string;
  detail: string;
  ms: number;
  status: "ok" | "skipped" | "failed" | "recovered";
  layer?: Layer;
}

export interface ToolSpec {
  name: string;
  description?: string;
  /** True when the tool changes something or reaches outside: send, pay, delete, run. */
  sideEffects?: boolean;
}

export interface AgentProfile {
  name?: string;
  tools?: ToolSpec[];
  /** sha-256 fingerprints of tool definitions the user already approved, by tool name. */
  pinnedTools?: Record<string, string>;
}

export type Mode = "strict" | "balanced" | "permissive";

export interface ScanInput {
  source?: SourceKind | "auto";
  text?: string;
  file?: { name?: string; mime?: string; bytes: Uint8Array };
  agent?: AgentProfile;
  history?: string[];
  /** What the user asked the agent to do. Requests in the content that go beyond it are flagged. */
  task?: string;
  mode?: Mode;
  judge?: "auto" | "off" | "force";
  /** Demo of fault tolerance: make one layer fail on purpose and watch the others carry on. */
  simulate?: Outage;
}

export const OUTAGES = ["classifier", "judge", "reader"] as const;
export type Outage = (typeof OUTAGES)[number];

export interface ScanResult {
  id: string;
  decision: Decision;
  risk: number;
  headline: string;
  source: SourceKind;
  sourceGuessed: boolean;
  segments: Segment[];
  humanView: string;
  aiView: string;
  findings: Finding[];
  attackTypes: AttackType[];
  sanitized: { text: string; envelope: string; removed: number };
  plan: string[];
  trace: TraceStep[];
  warnings: string[];
  stats: {
    chars: number;
    segments: number;
    hiddenSegments: number;
    ms: number;
    judgeCalls: number;
    /** Passages the LLM judge would review (whether or not it is switched on), and their total length. */
    judgeItems?: number;
    judgeChars?: number;
    costUsd: number;
  };
}

/** "the PDF", "the web page", "the API response": lower-case except acronyms. */
export function sourceNoun(k: SourceKind): string {
  return SOURCE_LABELS[k].split(" ").map((w) => (/^[A-Z]{2,}$/.test(w) ? w : w.toLowerCase())).join(" ");
}
