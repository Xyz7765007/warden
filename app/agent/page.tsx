import { AgentArena } from "@/components/AgentArena";
import { EgressCheck } from "@/components/EgressCheck";

export const metadata = { title: "Live attack: Warden" };

export default function AgentPage() {
  return (
    <div className="mx-auto max-w-[1240px] px-5 pb-16 pt-8">
      <section className="mb-6">
        <h1 className="text-[34px] font-semibold leading-[1.08] tracking-[-0.02em] md:text-[40px]">Same agent. Same task. One reads through Warden.</h1>
        <p className="mt-3 max-w-[64ch] text-[16px] leading-relaxed text-muted">Pick an attack. Watch what an unprotected agent does with it, and what the same agent does behind Warden.</p>
      </section>
      <AgentArena />
      <div className="mt-10">
        <EgressCheck />
      </div>
    </div>
  );
}
