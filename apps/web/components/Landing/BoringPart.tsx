const WITHOUT = [
  "Loader",
  "Parser",
  "Chunker",
  "Embedding provider",
  "Vector database",
  "Retrieval logic",
  "Metadata",
];

const WITH = ["Documents", "RAGX", "Relevant context"];

function Row({
  label,
  tone,
}: {
  label: string;
  tone: "plain" | "brand";
}) {
  return (
    <span
      className={
        tone === "brand"
          ? "rounded-md bg-[#0071E3] px-3 py-1.5 font-medium text-white"
          : "text-[#6E6E73]"
      }
    >
      {label}
    </span>
  );
}

export function RagComparisonFlow() {
  return (
    <section className="border-t border-[#E8E8ED] bg-white">
      <div className="mx-auto max-w-6xl px-6 py-24">
        <div className="max-w-2xl">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#6E6E73]">
            Comparison
          </p>
          <h2 className="mt-3 text-3xl font-semibold tracking-[-0.035em] sm:text-[40px] sm:leading-[1.05]">
            Same destination.
            <br />
            <span className="text-[#A1A1A6]">One layer.</span>
          </h2>
        </div>

        <div className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-[#E8E8ED] bg-[#E8E8ED] md:grid-cols-2">
          <div className="bg-white p-8">
            <p className="font-mono text-xs uppercase tracking-wider text-[#6E6E73]">
              Without RAGX
            </p>
            <ul className="mt-6 space-y-2.5 font-mono text-[14px]">
              {WITHOUT.map((item, index) => (
                <li key={item} className="text-[#6E6E73]">
                  <span className="mr-3 text-[#E8E8ED]">{index + 1}.</span>
                  {item}
                </li>
              ))}
            </ul>
            <p className="mt-6 border-t border-[#E8E8ED] pt-4 text-sm text-[#6E6E73]">
              You build and maintain 7 systems.
            </p>
          </div>

          <div className="bg-white p-8">
            <p className="font-mono text-xs uppercase tracking-wider text-[#0071E3]">
              With RAGX
            </p>
            <ul className="mt-6 flex flex-col items-start gap-2.5 font-mono text-[14px]">
              {WITH.map((item, index) => (
                <li key={item} className="flex flex-col items-start gap-2.5">
                  {index > 0 && <span aria-hidden className="ml-3.5 h-4 w-px bg-[#D8D8DE]" />}
                  <Row label={item} tone={item === "RAGX" ? "brand" : "plain"} />
                </li>
              ))}
            </ul>
            <p className="mt-6 border-t border-[#E8E8ED] pt-4 text-sm text-[#1D1D1F]">
              One retrieval layer. Documents in, context out.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
