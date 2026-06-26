import Link from "next/link";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center px-6 py-16">
      {/* Hero */}
      <section className="w-full max-w-2xl text-center">
        <h1 className="font-display text-6xl sm:text-7xl font-black tracking-tight text-ink">
          Poké<span className="text-coral">Draft</span>
        </h1>
        <p className="mt-5 text-lg text-ink-soft leading-relaxed max-w-md mx-auto">
          Draft Pokémon with your friends and run the auction live.
        </p>

        <div className="mt-9 flex flex-col sm:flex-row gap-4 justify-center">
          <Link href="/host" className="btn btn-coral text-lg px-7 py-3">
            Host a league
          </Link>
          <Link href="/join" className="btn btn-teal text-lg px-7 py-3">
            Join a draft
          </Link>
        </div>
        <div className="mt-4 flex gap-4 justify-center text-sm">
          <Link href="/formats" className="text-ink-soft hover:underline">Build a format</Link>
          <span className="text-ink-soft/50">·</span>
          <Link href="/demo" className="text-ink-soft hover:underline">See the demo</Link>
        </div>
      </section>

      {/* Three folded cards explaining the flow */}
      <section className="mt-20 grid gap-6 sm:grid-cols-3 w-full max-w-4xl">
        {[
          { n: "1", t: "Build the format", d: "Choose which Pokémon can be drafted and set their tiers." },
          { n: "2", t: "Run the auction", d: "Coaches bid from their own devices. You decide when each Pokémon sells." },
          { n: "3", t: "Keep your team", d: "Your picks are saved. Check your roster whenever you want." },
        ].map((c, i) => (
          <div
            key={c.n}
            className="paper dogear p-6 text-left"
            style={{ transform: `rotate(${[-1.5, 0.8, -0.6][i]}deg)` }}
          >
            <div className="hand text-5xl text-coral leading-none mb-2">{c.n}</div>
            <h3 className="font-display text-xl font-bold mb-1">{c.t}</h3>
            <p className="text-sm text-ink-soft leading-relaxed">{c.d}</p>
          </div>
        ))}
      </section>
    </main>
  );
}
