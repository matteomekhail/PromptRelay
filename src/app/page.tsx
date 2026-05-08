export default function HomePage() {
  return (
    <section className="relative min-h-[calc(100vh-3.75rem)] flex flex-col overflow-hidden">
      <div className="relay-hero-grid" aria-hidden="true" />

      <div className="relative z-10 mx-auto w-full max-w-7xl px-5 sm:px-8 flex flex-col flex-1">
        <div className="flex flex-1 flex-col items-center justify-center text-center py-16">
          <h1 className="hero-animate" style={{ "--stagger": 0 } as React.CSSProperties}>
            <span className="block font-heading text-[clamp(3.25rem,8vw,7rem)] leading-[0.9]">
              PromptRelay
            </span>
          </h1>

          <div
            className="hero-animate mt-10 max-w-[42rem]"
            style={{ "--stagger": 2 } as React.CSSProperties}
          >
            <p className="text-lg sm:text-xl font-medium leading-snug">
              GitHub commands create tasks. The volunteer TUI approves and runs
              them locally. The web app only provides integration endpoints.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
