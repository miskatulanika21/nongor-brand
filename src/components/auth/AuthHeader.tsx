import { Link } from "@tanstack/react-router";
import { ArrowLeft, HelpCircle, PackageSearch } from "lucide-react";
import { Logo } from "@/components/Logo";

export function AuthHeader() {
  return (
    <header className="auth-header w-full border-b border-border/60 bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80">
      <nav
        aria-label="Authentication navigation"
        className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6 lg:h-[68px]"
      >
        <Link to="/" aria-label="Nongorr — back to home" className="shrink-0">
          <Logo className="scale-95 sm:scale-100" />
        </Link>

        {/* Desktop actions */}
        <ul className="hidden items-center gap-1 text-sm font-medium text-foreground sm:flex">
          <li>
            <Link
              to="/shop"
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden />
              Back to Shop
            </Link>
          </li>
          <li>
            <Link
              to="/track"
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              <PackageSearch className="h-4 w-4" aria-hidden />
              Track Order
            </Link>
          </li>
          <li>
            <Link
              to="/contact"
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              <HelpCircle className="h-4 w-4" aria-hidden />
              Need Help?
            </Link>
          </li>
        </ul>

        {/* Mobile actions */}
        <div className="flex items-center gap-1 sm:hidden">
          <Link
            to="/shop"
            aria-label="Back to Shop"
            className="inline-flex h-11 min-w-11 items-center justify-center gap-1 rounded-full px-3 text-sm text-foreground transition-colors hover:bg-accent"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            <span className="text-xs font-medium">Shop</span>
          </Link>
          <Link
            to="/contact"
            aria-label="Need help"
            className="inline-flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <HelpCircle className="h-5 w-5" aria-hidden />
          </Link>
        </div>
      </nav>
    </header>
  );
}
