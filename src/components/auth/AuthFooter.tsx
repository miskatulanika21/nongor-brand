import { Link } from "@tanstack/react-router";
import { BRAND } from "@/lib/brand";

export function AuthFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="auth-footer w-full border-t border-border/60 bg-card/90">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 py-3 text-xs text-muted-foreground sm:flex-row sm:px-6 sm:text-sm">
        <p className="text-center sm:text-left">
          © {year} {BRAND.siteName} · {BRAND.address}
        </p>
        <nav
          aria-label="Legal"
          className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2"
        >
          <Link to="/privacy-policy" className="transition-colors hover:text-foreground">
            Privacy Policy
          </Link>
          <Link to="/terms" className="transition-colors hover:text-foreground">
            Terms &amp; Conditions
          </Link>
          <Link to="/contact" className="transition-colors hover:text-foreground">
            Need Help?
          </Link>
        </nav>
      </div>
    </footer>
  );
}
