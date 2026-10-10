# Warden: hackathon submission

**Problem 2: Agentic Cybersecurity, Prompt Injection Firewall**
Live demo: https://warden-cyan-beta.vercel.app · Architecture: [ARCHITECTURE.md](ARCHITECTURE.md)

## Self-declared position: F3 x D3

|  | F1 | F2 | F3 |
|---|---|---|---|
| **D1** |  |  |  |
| **D2** |  |  |  |
| **D3** |  |  | **Warden** |

### F3: detect at least 7 types of attack

Warden detects all 9 types named in the problem statement, each with its own rules and evidence:

| Attack type | Detected on our corpus | Where to see it live |
|---|---|---|
| Instruction override | 97.7% | Scan: "Screenshot with faint text", "Résumé that grades itself" |
| Role change | 97.7% | Scan: "Refund email in Hinglish", "A jailbreak built over three messages" |
| Secret extraction | 100% | Scan: "Invoice with an invisible line" (the vault key) |
| Tool abuse | 100% | Scan: "README that tells coding agents to run a script"; Live attack: invoice |
| Credential theft | 100% | Scan: "A poisoned MCP tool list", "Code comment aimed at AI assistants" |
| Context poisoning | 97.7% | Scan: "Knowledge-base page that rewrites policy" |
| Multi-step jailbreak | 100% | Scan: "A jailbreak built over three messages" |
| Encoded instructions | 100% | Scan: "Review with a base64 order", "Slack message with invisible characters" |
| Indirect prompt injection | 100% | Every outside-content sample, e.g. "Review page with hidden orders" |

The features axis also asks for supporting features. Warden has all three named in the guide:

- **Observability:** a step-by-step trace per scan, the exact words acted on and why, OCSF export, live layer status.
- **Trainability:** online learning from misses, demonstrated live on the Red team page and measured on disguises it never trained on.
- **Fault tolerance:** isolated layers, works with no key and no network, holds partly read files, time-boxed OCR and judge. Shown live: "Simulate an outage" on the Scan page fails the classifier, the judge or the file reader on purpose, and the trace shows the rest carrying on.

### D3: highly heterogeneous multimodal input, high degree of demonstrable reliability

**Input:** all 11 input types in the problem statement, each with its own reader that separates what a person sees from what the AI reads: user messages, web pages, PDFs, emails (with attachments), Markdown, HTML, Word documents, API responses (including MCP tool lists), OCR text, source code, and images via OCR. Upload any of them on the Scan page.

**Reliability, shown seven ways** (judge off, all reproducible from `scripts/`):

1. Our corpus, 9 types x 11 inputs: 99.2% of 396 attacks caught, 0 of 121 safe documents flagged.
2. InjecAgent: 99.4% of 510 attacks caught, 0 of 510 paired safe outputs flagged.
3. jackhhao/jailbreak-classification: 87.8% caught, 0 of 123 flagged.
4. deepset/prompt-injections: 26.7% caught, 0 of 56 flagged (the set labels plain role-play requests as attacks; Warden passes those by design).
5. Red team: 99.7% of 3,383 disguised attacks, 0 of 144 safe texts flagged; new wordings learned and then caught on unseen disguises, 87 of 90.
6. Independent black-box tests by reviewers who never saw our code: five rounds of new inputs (21/28, 22/40, 25/50, 31/50, then 28/50 attacks caught; 4/24, 1/35, 3/40, 3/40, 5/40 safe inputs flagged), each published as measured. Rounds 1 to 4 were followed by fixes to the families behind the misses; round 5 ran on the build of 8 October. After it, a QA pass made Warden faster and stopped false alarms on real documents; round 5's inputs replayed on today's build: 28/50 caught and 3/40 flagged with the judge off, 43/50 and 2/40 with the LLM judge on (Claude Sonnet 5.5, $0.12 for all 90 inputs).
7. Live latency: 4 ms median for text, 15 ms for a PDF.

We report where it is weakest next to these numbers: images with very small text, and attacks written fresh by outsiders, where the offline layers alone catch 50% to 75% (86% on the final round with the judge on). The judge only reviews passages the free layers find unclear, so an attack that looks entirely ordinary can still pass.

## The problem statement, line by line

| The problem statement asks for | Where Warden shows it |
|---|---|
| A firewall that "intercepts all incoming content before it influences the AI's behaviour" | `/api/scan` runs before the model. On the Live attack page, every email, attachment, file and tool result the agent receives (its own systems and outside tool servers) is scanned before the model sees it; MCP tool lists are scanned and pinned when a server connects. |
| "Detect and neutralize malicious instructions embedded in user input or retrieved data" | Scan page: the attack is underlined, cut out, and the rest is passed on wrapped as untrusted data. User input: "A jailbreak built over three messages" and "Use your own"; retrieved data: every other sample. |
| "Allowing legitimate content to pass with minimal disruption" | The four safe look-alike samples pass; attacks are cut out instead of blocking whole documents; 0 false alarms across 121 + 510 + 123 + 56 + 144 safe items (Proof); 4 ms per text scan. |
| Input sources: user messages, web pages, PDFs, emails, Markdown, HTML, Word documents, API responses, OCR text, source code, images (via OCR) | All 11, each with its own reader that separates what a person sees from what the AI reads, a sample on the Scan page, and file upload. The Proof matrix measures every attack type in every input type. |
| Attack types: instruction override, role change, secret extraction, tool abuse, credential theft, context poisoning, multi-step jailbreaks, encoded instructions, indirect prompt injection | All 9, each caught live by at least one sample (table above) and measured per input type on the Proof page. |
| F3: detect at least 7 types of attack | 9 of 9, plus the supporting features above. |
| D3: highly heterogeneous multimodal input, with a high degree of demonstrable reliability | 11 input types including images; reliability shown seven ways (above), with false alarms beside every catch rate and five independent rounds published as measured. |
| Supporting features "(observability, trainability, fault tolerance, etc.)" | Trace, OCSF export and layer status; Learn from misses; Simulate an outage. |
| A working demo "across all areas where the team claims that it is working" | Every claim above links to a page of the live demo; "Three minutes with Warden" below walks through them. |
| A detailed structural architecture: "process flow, key actions, decisions, model usage, and incorporation of key features" | [ARCHITECTURE.md](ARCHITECTURE.md): process flow (2), components (3), how a decision is made (4), model usage (5), agentic behaviour (6), supporting features (7), claims and evidence (8). Also the How it works page. |
| Criterion 8: "hallucination, security, privacy, bias, reliability, and human oversight" | Hallucination: judge verdicts must quote the text exactly or are dropped. Security: the deciding layers are code and a trained model, so content cannot instruct them. Privacy: nothing stored, the judge sees at most six excerpts. Bias: measured on outsiders' Indian-language inputs (Proof, "Fair across languages"). Reliability: the seven measurements above. Human oversight: held content waits for a person, and the decision goes into the OCSF record. |
| A declared and justified grid position, without over- or under-claiming | F3 x D3, with the evidence for each half above; weaknesses listed next to the numbers. |

## The 8 criteria

| Criterion | Warden |
|---|---|
| Significance and relevance | AI agents now read email, invoices, tickets and web pages and can pay, send and run. One hidden line in an invoice redirected Rs 4,85,000 in our demo. Indirect injection is OWASP LLM01:2025 and ASI01; CERT-In named it in CIAD-2025-0013. |
| Innovation and originality | Not a wrapper around an existing guardrail. Perception gap (person vs AI view), task binding against the user's request, capability-aware policy, a second line on egress with canaries and checksums, MCP rug-pull pins, an adaptive red team that trains the classifier live, and Hinglish and Indian-language coverage. |
| Effective use of AI | A trained classifier on every sentence (runs in the browser, retrains in ms), OCR for images, a Claude judge only for unclear excerpts with quote verification, an adaptive red-team agent, and a live Claude agent protected by Warden. |
| Technical complexity | 11 format readers (pdf.js operator walk, Word XML, MIME, CSS-aware HTML, OCR in contrast bands), stacked decoders, context-weighted rules in English and Indian languages, a check for orders aimed at the AI inside outside content, session analysis, egress checks, OCSF, 145 unit and 54 end-to-end tests. |
| Agentic capability | The planner chooses checks per input, uses tools, acts (cut, hold, block, stop a tool call), recovers from failures, and learns from an attacker that adapts. |
| Business impact | Stops invoice-redirect fraud, data exfiltration and poisoned tooling before money or data moves; 4 ms per scan; free offline layers; OCSF into the SOC. |
| Prototype quality | Live, fast, works on any input you paste or upload; every result explains itself. |
| Scalability, responsible AI, robustness | Stateless serverless API; privacy (nothing stored, minimal judge excerpts, masking); human review recorded; published false-alarm rates; framework mapping to OWASP, MITRE ATLAS, CERT-In, RBI FREE-AI, DPDP and Five Eyes guidance. |

## Three minutes with Warden

1. **Scan:** open "Invoice with an invisible line". Switch "What the AI reads" and "Person": the white line only the AI sees is underlined and cut out.
2. **Live attack:** Run both. Without Warden, Rs 4,85,000 goes to the attacker and the vault key is emailed out. With Warden, the right Rs 1,84,500 is paid. Scroll to "The second line" and try the presets.
3. **Red team:** Run 40 attacks, Learn from misses, run again: the retries are caught, with 0 new false alarms.
4. **Proof:** every number, its source, the five independent rounds, and fairness across languages.
5. **Fault tolerance:** pick "Classifier down", "LLM judge down" or "File reader down" in Simulate an outage, and read the trace.
6. **Use your own:** paste anything, or upload a PDF, Word file, email or image.
7. **API:** on the API page, send any example to the live `/api/scan` or `/api/guard`, or attach your own file, and copy the same request as curl.
