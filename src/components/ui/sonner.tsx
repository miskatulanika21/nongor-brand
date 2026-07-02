import { Toaster as Sonner } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      className="toaster group"
      // Sonner styles toasts from injected CSS + these variables, which beat
      // Tailwind's layered utilities — so the surface is themed here, not via
      // classNames.
      style={
        {
          "--normal-bg": "color-mix(in oklab, var(--card) 95%, transparent)",
          "--normal-text": "var(--foreground)",
          "--normal-border": "color-mix(in oklab, var(--gold) 35%, transparent)",
        } as React.CSSProperties
      }
      toastOptions={{
        style: {
          borderRadius: "0.75rem",
          backdropFilter: "blur(12px)",
          boxShadow:
            "0 12px 32px -12px oklch(0.27 0.05 22 / 0.35), 0 2px 8px oklch(0.27 0.05 22 / 0.08)",
        },
        classNames: {
          toast: "group toast nongorr-toast nongorr-surface-hairline",
          title: "group-[.toast]:font-display group-[.toast]:text-base group-[.toast]:leading-snug",
          description: "group-[.toast]:text-muted-foreground",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
          closeButton:
            "group-[.toast]:border-gold/40 group-[.toast]:bg-card group-[.toast]:text-muted-foreground group-[.toast]:transition-colors hover:group-[.toast]:text-foreground hover:group-[.toast]:border-gold",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
