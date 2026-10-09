import { Suspense } from "react";
import { ScanWorkbench } from "@/components/ScanWorkbench";

export default function Home() {
  return (
    <div className="mx-auto max-w-[1240px] px-5 pb-16 pt-8">
      <section className="mb-7 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-[34px] font-semibold leading-[1.08] tracking-[-0.02em] md:text-[42px]">Your AI reads what people can&apos;t see.</h1>
          <p className="mt-3 max-w-[62ch] text-[16px] leading-relaxed text-muted">
            Warden checks everything an agent is about to read, cuts out hidden orders, and passes the rest through.
          </p>
        </div>
      </section>
      <Suspense fallback={<div className="h-[480px]" />}>
        <ScanWorkbench />
      </Suspense>
    </div>
  );
}
