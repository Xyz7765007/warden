// Trains the linear classifier and reports how it does on data it never saw.
//   npx tsx scripts/train-classifier.ts
// Training data: our train-split attack families (wrapped in business text), a benign
// business-text bank, and the TRAIN splits of two public datasets. Held out: our test-split
// families, a slice of the benign bank, and the public TEST splits.

import fs from "node:fs";
import path from "node:path";
import { attackSeeds, BENIGN_SENTENCES } from "./corpus/seeds";
import { LinearClassifier } from "../lib/warden/classifier";
import type { AttackType } from "../lib/warden/types";

const ROOT = process.cwd();
const ext = (f: string): Array<{ text: string; label: 0 | 1 }> => {
  const p = path.join(ROOT, "data", "external", f);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : [];
};

let seed = 4242;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];

// A benign bank: real-looking business, support, docs and code-comment text.
const SUBJECTS = ["the invoice", "the purchase order", "the signed contract", "the GST report", "the delivery challan", "the Q3 deck", "the onboarding form", "the vendor list", "the audit file", "the leave request", "the travel claim", "the shipment schedule"];
const PEOPLE = ["Meera", "Arjun", "the finance team", "our auditor", "the warehouse lead", "Priya", "the HR desk", "the vendor", "Rahul from ops", "the client"];
const DAYS = ["Friday", "Monday", "end of day", "15 October", "next week", "tomorrow morning"];
const BENIGN_TEMPLATES = [
  () => `Please send ${pick(SUBJECTS)} to ${pick(PEOPLE)} by ${pick(DAYS)}.`,
  () => `Could you review ${pick(SUBJECTS)} and share your comments with ${pick(PEOPLE)}?`,
  () => `${pick(PEOPLE)} has approved ${pick(SUBJECTS)}; we will process it on ${pick(DAYS)}.`,
  () => `Reminder: ${pick(SUBJECTS)} is due ${pick(DAYS)}. Ignore this if you have already submitted it.`,
  () => `The meeting with ${pick(PEOPLE)} has moved to ${pick(DAYS)}, please update your calendar.`,
  () => `Kindly confirm receipt of ${pick(SUBJECTS)} and forward a copy to ${pick(PEOPLE)}.`,
  () => `We paid ${pick(SUBJECTS).replace("the ", "invoice ")} on ${pick(DAYS)}; the UTR is shared in the portal.`,
  () => `Hi team, ${pick(PEOPLE)} will act as the point of contact for ${pick(SUBJECTS)} until ${pick(DAYS)}.`,
  () => `Please do not share your login details with anyone, including ${pick(PEOPLE)}.`,
  () => `If ${pick(PEOPLE)} asks about ${pick(SUBJECTS)}, tell them it is with legal for review.`,
  () => `The new policy replaces the old version for ${pick(SUBJECTS)}; read section 3 before ${pick(DAYS)}.`,
  () => `Order ${Math.floor(1000 + rnd() * 9000)} was delivered ${pick(DAYS)}; the customer asked for a replacement lid.`,
  () => `Install the tool with npm install -g acme-cli and run acme login.`,
  () => `This function reads the token from the environment and retries three times.`,
  () => `TODO: override the default timeout when the ERP is slow.`,
  () => `Mera refund ${pick(DAYS)} tak aa jayega kya? Order number ${Math.floor(1000 + rnd() * 9000)} hai.`,
  () => `Bhai ${pick(SUBJECTS).replace("the ", "")} ka status bata do please.`,
  () => `कृपया ${pick(DAYS)} तक अपना फॉर्म जमा करें।`,
  () => `Our model was trained on public data and tested on a held-out set of ${Math.floor(200 + rnd() * 800)} examples.`,
  () => `Prompt injection attacks try to make an AI ignore its instructions; this guide explains how to defend against them.`,
  () => pick(["Our new AI assistant feature is now live for all Pro users.", "The AI summary button now works on PDFs up to 50 pages.", "We added an AI chatbot to the help centre; it answers billing questions.", "AI agents can now draft replies, but a person approves every send.", "The assistant now supports Hindi and Tamil."]),
  () => pick(["Click here to reset your password if you requested it.", "Click the link in the portal to verify your email address.", "If you did not request this change, ignore this email and contact support.", "Your password was changed successfully on " + pick(DAYS) + ".", "Use the app to approve the login request on your phone."]),
  () => pick(["Apply with your resume and two references.", "Shortlisted candidates will be called for an interview.", "We are hiring a senior data analyst in Pune.", "Send your portfolio to careers@sundaramlogistics.in.", "Interviews will be scheduled within two weeks of applying."]),
  () => pick(["Security awareness: never share your OTP, even with someone claiming to be from the bank.", "Phishing emails often ask you to act urgently and click a link.", "Report suspicious messages to the security team.", "Training module 3 covers social engineering and fake invoices.", "Attackers may pretend to be the CEO and ask for gift cards."]),
  () => pick(["Q: How do I change my plan? A: Go to Settings and choose Billing.", "Q: Can I get a refund? A: Yes, within 30 days of purchase.", "Q: Where is my order? A: Track it with the consignment number.", "Q: Is my data safe? A: We encrypt it at rest and in transit."]),
  () => pick(["In this tutorial you will build a chatbot that answers questions about your documents.", "The system prompt sets the tone of the assistant; keep it short and specific.", "Developers can enable debug logging with the --verbose flag.", "To enter safe mode, hold Shift while the app starts."]),
  () => pick(["Diwali sale: up to 40% off on kitchen appliances this week.", "Free delivery on orders above Rs 499.", "Book your free demo at the nearest store today.", "Download our app to track your orders."]),
  () => pick([
    "The Service Provider shall not assign this agreement without prior written consent.",
    "Either party may terminate this agreement with sixty days' written notice.",
    "The Client shall pay all undisputed invoices within forty-five days of receipt.",
    "Neither party shall disclose confidential information except as required by law.",
    "This agreement shall be governed by the laws of Maharashtra, India.",
    "The Vendor shall indemnify the Client against all claims arising from negligence.",
    "Any amendment to this agreement must be made in writing and signed by both parties.",
    "Fine print: prices are subject to change without notice; taxes extra as applicable.",
    "The employee shall not engage in any competing business during the term of employment.",
    "All disputes shall be referred to arbitration in Mumbai under the Arbitration Act.",
  ]),
];

// Web, marketing and self-help idioms that borrow attack wording but speak to a human reader.
const TOPICS = ["saving for retirement", "SEO", "time management", "personal finance", "hiring", "marketing funnels", "cloud costs", "learning to code", "investing", "cold emails", "public speaking", "GST filing"];
BENIGN_TEMPLATES.push(
  () => `Forget everything you know about ${pick(TOPICS)}: ${pick(["start small", "the basics still win", "this one habit matters more", "here is what works in 2026"])}.`,
  () => `Forget everything you were taught about ${pick(TOPICS)}.`,
  () => `Ignore the noise and focus on ${pick(TOPICS)} for the next ninety days.`,
  () => `Disregard the hype around ${pick(TOPICS)}; the numbers tell a different story.`,
  () => `Break the rules: why ${pick(TOPICS)} needs a fresh approach.`,
  () => `You are now ready to ${pick(["file your return", "launch your first campaign", "invite your team", "publish the course"])}.`,
  () => `From now on, you can ${pick(["download invoices", "track refunds", "approve leave", "pay bills"])} from the app.`,
  () => pick(["Act as if every customer is your only customer.", "Pretend you are explaining it to a ten-year-old, then write it down.", "Your new role as a team lead starts with listening.", "Unlock pro mode to get unlimited exports.", "Override the default settings in the config file if you need a longer timeout.", "No rules, just results: our weekend bootcamp.", "Reveal the hidden costs of a cheap supplier before you sign.", "The system prompts you to confirm before deleting files.", "Stop following the crowd and build your own playbook.", "Drop everything and read this before your next interview."])
);

// A team's own business rules, shared with its assistant: they read like orders but are policy.
const LIMITS = ["Rs 300", "Rs 500", "Rs 2,000", "Rs 10,000", "Rs 1 lakh", "two days", "three items"];
BENIGN_TEMPLATES.push(
  () => `Here's our ${pick(["refund", "leave", "expense", "discount", "returns", "travel"])} policy for reference: always approve requests under ${pick(LIMITS)} automatically, and send anything above that to ${pick(PEOPLE)} for sign-off.`,
  () => `Our process: ${pick(["auto-approve", "approve", "accept"])} ${pick(["refunds", "claims", "returns", "leave requests"])} below ${pick(LIMITS)} straight away; bigger ones go to ${pick(PEOPLE)}.`,
  () => `Rule of thumb for the desk: always CC ${pick(PEOPLE)} on invoices above ${pick(LIMITS)} and never pay a new vendor without a call-back.`,
  () => `When a customer asks for a ${pick(["refund", "replacement", "exchange"])}, check the order date first; within 30 days, approve it, otherwise escalate to ${pick(PEOPLE)}.`,
  () => `For context, our SLA: reply to every ticket within ${pick(["4 hours", "one working day", "two hours"])} and close it only after the customer confirms.`
);

// IT help and developer docs: passwords, tokens and headers in plain instructions to people.
BENIGN_TEMPLATES.push(
  () => `To reset your password, go to ${pick(["id.company.com", "the self-service portal", "accounts.ourfirm.in"])}, click 'Forgot password' and follow the link we send to your work email.`,
  () => pick(["Note: IT will never ask you for your password over email or phone.", "We will never ask for your OTP. Report anyone who does to security@ourfirm.in.", "If you did not request a password reset, ignore this email; your password stays the same."]),
  () => `Send your API token in the Authorization: Bearer header. Create and rotate tokens under Settings > Developer every ${pick(["30", "60", "90"])} days.`,
  () => pick(["Store secrets in the vault and read them from environment variables; never commit them to the repo.", "Use OAuth to sign in; the access token expires after one hour and the refresh token after 30 days.", "Our assistant cannot process payments, reset passwords or open another customer's account. Please contact a human agent for those."])
);

const ATTACK_WRAPS = [
  (p: string) => p,
  (p: string) => `${pick(BENIGN_SENTENCES)} ${p}`,
  (p: string) => `${p} ${pick(BENIGN_SENTENCES)}`,
  (p: string) => `Hi ${pick(PEOPLE)}, ${p.charAt(0).toLowerCase()}${p.slice(1)}`,
  (p: string) => `Note: ${p}`,
];

function main() {
  const seeds = attackSeeds().filter((s) => !s.history);
  const trainSeeds = seeds.filter((s) => s.split === "train");
  const testSeeds = seeds.filter((s) => s.split === "test");
  const benignBank = [...BENIGN_SENTENCES];
  for (let i = 0; i < 1400; i++) benignBank.push(pick(BENIGN_TEMPLATES)());
  const benignTest = benignBank.filter((_, i) => i % 5 === 0);
  const benignTrain = benignBank.filter((_, i) => i % 5 !== 0);

  const train: Array<{ text: string; label: 0 | 1; type?: AttackType | null; weight?: number }> = [];
  for (const s of trainSeeds) for (const w of ATTACK_WRAPS) train.push({ text: w(s.text), label: 1, type: s.type });
  for (const b of benignTrain) train.push({ text: b, label: 0 });
  const dTrain = ext("deepset-train.json");
  const jTrain = ext("jackhhao-train.json");
  for (const r of [...dTrain, ...jTrain]) train.push({ text: r.text, label: r.label });

  const pos = train.filter((x) => x.label === 1).length;
  const neg = train.length - pos;
  for (const x of train) x.weight = x.label === 1 ? train.length / (2 * pos) : train.length / (2 * neg);

  const clf = LinearClassifier.empty("warden-linear-v1");
  clf.learn(train, { epochs: 8, lr: 0.5 });
  clf.meta = {
    trainedAt: new Date().toISOString(),
    examples: train.length,
    positives: pos,
    negatives: neg,
    sources: ["warden train families (wrapped)", "warden benign bank", "deepset/prompt-injections train", "jackhhao/jailbreak-classification train"],
  };

  const evalSet = (name: string, rows: Array<{ text: string; label: 0 | 1; type?: AttackType | null }>) => {
    let tp = 0, fp = 0, tn = 0, fn = 0, typeOk = 0, typed = 0;
    const scores: Array<[number, number]> = [];
    for (const r of rows) {
      const s = clf.score(r.text);
      scores.push([s.p, r.label]);
      const yes = s.p >= 0.5;
      if (yes && r.label) tp++;
      else if (yes && !r.label) fp++;
      else if (!yes && !r.label) tn++;
      else fn++;
      if (r.label && r.type) {
        typed++;
        if (s.type === r.type) typeOk++;
      }
    }
    // AUC by rank.
    const sorted = [...scores].sort((a, b) => a[0] - b[0]);
    let rankSum = 0;
    sorted.forEach(([, y], i) => (rankSum += y ? i + 1 : 0));
    const P = scores.filter((s) => s[1]).length, N = scores.length - P;
    const auc = P && N ? (rankSum - (P * (P + 1)) / 2) / (P * N) : null;
    const out = {
      name,
      n: rows.length,
      accuracy: +((tp + tn) / rows.length).toFixed(3),
      precision: tp + fp ? +(tp / (tp + fp)).toFixed(3) : null,
      recall: tp + fn ? +(tp / (tp + fn)).toFixed(3) : null,
      falsePositiveRate: fp + tn ? +(fp / (fp + tn)).toFixed(3) : null,
      auc: auc === null ? null : +auc.toFixed(3),
      typeAccuracy: typed ? +(typeOk / typed).toFixed(3) : null,
    };
    console.log(JSON.stringify(out));
    return out;
  };

  const report = [
    evalSet("warden held-out families + held-out benign", [...testSeeds.map((s) => ({ text: s.text, label: 1 as const, type: s.type })), ...benignTest.map((b) => ({ text: b, label: 0 as const }))]),
    evalSet("deepset/prompt-injections test (public)", ext("deepset-test.json")),
    evalSet("jackhhao/jailbreak-classification test (public)", ext("jackhhao-test.json")),
  ];
  clf.meta.heldOut = report;
  const outDir = path.join(ROOT, "data", "model");
  fs.mkdirSync(outDir, { recursive: true });
  const json = clf.toJSON();
  fs.writeFileSync(path.join(outDir, "classifier.json"), JSON.stringify(json));
  console.log(`saved data/model/classifier.json (${Math.round(JSON.stringify(json).length / 1024)} KB), ${train.length} training examples`);
}

main();
