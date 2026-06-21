export function PageHero({
  eyebrow,
  title,
  description,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
}) {
  return (
    <div className="border-b border-border bg-secondary/40">
      <div className="mx-auto max-w-4xl px-4 py-14 text-center sm:px-6">
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h1 className="mt-2 font-display text-4xl text-foreground sm:text-5xl">{title}</h1>
        {description && (
          <p className="mx-auto mt-3 max-w-2xl text-sm text-muted-foreground">{description}</p>
        )}
        <div className="ornament-divider mx-auto mt-4 w-40" />
      </div>
    </div>
  );
}

export function Prose({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl space-y-5 px-4 py-12 text-sm leading-relaxed text-muted-foreground sm:px-6 [&_h2]:font-display [&_h2]:text-2xl [&_h2]:text-foreground [&_h2]:pt-4 [&_strong]:text-foreground [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5">
      {children}
    </div>
  );
}
