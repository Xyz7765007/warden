import { RedTeam } from "@/components/RedTeam";

export const metadata = { title: "Red team: Warden" };

export default function RedTeamPage() {
  return (
    <div className="mx-auto max-w-[1240px] px-5 pb-16 pt-8">
      <section className="mb-6">
        <h1 className="text-[34px] font-semibold leading-[1.08] tracking-[-0.02em] md:text-[40px]">An attacker that keeps trying.</h1>
        <p className="mt-3 max-w-[64ch] text-[16px] leading-relaxed text-muted">A red-team agent disguises attacks, old and newly worded, to slip past Warden, and retries whatever gets through. Every miss becomes training data, and Warden retrains on the spot.</p>
      </section>
      <RedTeam />
    </div>
  );
}
