# Warden: demo video script (about 3.5 minutes)

Record at https://warden-cyan-beta.vercel.app in a 1440 x 900 browser window. Before recording, open each page once so nothing is loading for the first time. Speak slowly; the timings are a guide, not a rule.

---

## 1. The hook (0:00 to 0:25)

**On screen:** Live attack page, "Invoice fraud" selected. Press **Run both** right away.

**Say:**
"AI agents now read our email, invoices and documents, and they can pay, send and run things. Here is an accounts-payable agent. The user asks it to pay an approved invoice. Watch the left side: it pays four lakh eighty-five thousand rupees to an account the vendor never used, and emails our vault key to the attacker. One line in the invoice did that, a line no person can see."

## 2. Same agent, behind Warden (0:25 to 0:50)

**On screen:** point at the right column as it fills: "Warden: cleaned", then the green outcome.

**Say:**
"On the right, the same agent reads the same invoice through Warden. Warden found the hidden line, cut it out and passed the rest. The agent pays the real one lakh eighty-four thousand five hundred to the account on file. Nothing else changed."

## 3. What the AI sees that we don't (0:50 to 1:30)

**On screen:** Scan page. Click **Invoice with an invisible line**. Toggle **Person** and **AI**. Scroll to the findings, then open the trace.

**Say:**
"This is the core idea. Warden reads every input the way an AI does. A person sees a normal invoice. The AI also reads white text on a white background. Warden shows both views, underlines the attack, says in plain words why it is one, and keeps the rest of the document. It does this for all eleven input types in the problem: PDFs, Word files, emails with attachments, web pages, Markdown, API and MCP responses, code, OCR text and images."

**On screen:** click **Refund email in Hinglish**, then **Screenshot with faint text**.

**Say:**
"It speaks Hinglish, because our customers do. And it reads faint text in images, which a person cannot see."

## 4. It learns (1:30 to 2:05)

**On screen:** Red team page. Press **Run 40 attacks**. Let the feed fill. Press **Learn from misses**. Press **Run another round**.

**Say:**
"An attacker agent now tries to get past Warden. It disguises attacks with eighteen tricks, look-alike letters, ROT13, Hinglish, splitting them across chat turns, and plants them in emails, tickets and READMEs. A few new wordings get through. I press Learn from misses: Warden retrains in milliseconds, here in the browser. The attacker comes back with the same attacks in new disguises, and they are caught, with no new false alarms on a hundred and forty-four safe messages."

## 5. The second line (2:05 to 2:30)

**On screen:** Live attack page, scroll to **The second line**. Click **Reply that leaks through an image**, then **Check what leaves**. Then **Payment to an account from a flagged invoice**, **Check what leaves**.

**Say:**
"If anything ever slips past, it still has to get out. Warden checks every reply and every tool call on the way out. This reply hides the user's PAN in an image address, which would leak the moment it loads: removed. This payment uses an account that only appeared in the flagged invoice: blocked."

## 6. Proof (2:30 to 3:10)

**On screen:** Proof page. Pause on the headline cards, scroll to the independent test, then the matrix, then the 3x3 grid.

**Say:**
"Every number here comes from a script anyone can re-run. Ninety-nine percent of attacks caught across nine attack types and eleven input types, with zero false alarms on our safe documents and on public benchmarks like InjecAgent. Then the hard test: outside reviewers attacked it five times with inputs we had never seen. The free offline layers catch half to three quarters of those, and every round is published as measured. Switch on the LLM judge and the final round goes from 28 to 42 of 50. We declare F3 by D3: all nine attack types, on highly varied input, with the evidence on this page, including where Warden is weakest."

## 7. Close (3:10 to 3:30)

**On screen:** How it works page, the architecture diagram.

**Say:**
"Warden reads what the AI reads, knows what the user actually asked for, cuts out attacks instead of blocking whole documents, guards the way out, and learns from an attacker. It scans text in four milliseconds. Warden."

---

## If the LLM judge is switched on

It is on at https://warden-cyan-beta.vercel.app (Claude Sonnet 5.5). Two optional additions:

- **Section 2, plus 10 seconds:** switch the agent to **Live Claude agent** and press **Run both**. In our runs, the real model ignored the hidden orders on its own, and Warden still cut them out first. Say: "This is a real Claude agent with the same tools. This time it refused the hidden order by itself; Warden had already removed it. You don't want your money depending on the model saying no every time."
- **Section 6, one line:** "With the LLM judge switched on, the final outside round goes from 28 to 42 of 50, for ten cents."

## Recording tips

- Loom: 1080p, full browser window, camera bubble in a corner that does not cover the right column.
- Hide the bookmarks bar, close other tabs, zoom at 100%.
- Do one full practice run; on the take, pause a beat after each click so the viewer sees the result.
- Keep it under 4 minutes; cut section 5 to one preset if you run long.
