import * as React from "react";
import { Loader2, AlertTriangle, HelpCircle } from "lucide-react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Imperative, brand-styled confirmation — one dialog for the whole app.
 *
 *   const confirm = useConfirm();
 *   if (await confirm({ tone: "danger", title: "Delete address?",
 *                       description: "This can't be undone.", confirmText: "Delete" })) {
 *     …do it…
 *   }
 *
 * Pass `onConfirm` to run the action WITH an in-dialog loading state (the
 * confirm button spins, cancel/escape lock out until it settles) — ideal for
 * sign-out and deletes. Without it, the call just resolves a boolean and the
 * caller owns the follow-up. Cleaner than wiring open/pending state into every
 * component, and guarantees one consistent premium confirmation everywhere.
 */
type Tone = "danger" | "default";

export interface ConfirmOptions {
  title: string;
  description?: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  tone?: Tone;
  /** Overrides the default tone icon. */
  icon?: React.ReactNode;
  /** Run on confirm with an in-dialog spinner; a throw keeps the dialog open. */
  onConfirm?: () => void | Promise<void>;
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = React.createContext<ConfirmFn | null>(null);

export function useConfirm(): ConfirmFn {
  const ctx = React.useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used within <ConfirmProvider>");
  return ctx;
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [options, setOptions] = React.useState<ConfirmOptions>({ title: "" });
  const resolver = React.useRef<((v: boolean) => void) | null>(null);

  const confirm = React.useCallback<ConfirmFn>((opts) => {
    setOptions(opts);
    setOpen(true);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const settle = React.useCallback((value: boolean) => {
    resolver.current?.(value);
    resolver.current = null;
    setOpen(false);
    setLoading(false);
  }, []);

  const onConfirm = React.useCallback(async () => {
    const fn = options.onConfirm;
    if (!fn) return settle(true);
    try {
      setLoading(true);
      await fn();
      settle(true);
    } catch {
      // Leave the dialog open so the viewer can retry or cancel.
      setLoading(false);
    }
  }, [options, settle]);

  const tone = options.tone ?? "default";
  const danger = tone === "danger";

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <AlertDialog
        open={open}
        onOpenChange={(next) => {
          // Ignore scrim/escape dismissals while the action is running.
          if (!next && !loading) settle(false);
        }}
      >
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader className="items-center gap-2 text-center sm:text-center">
            <span
              className={cn(
                "grid h-14 w-14 place-items-center rounded-full ring-8",
                danger
                  ? "bg-destructive/10 text-destructive ring-destructive/5"
                  : "bg-primary/10 text-primary ring-primary/5",
              )}
              aria-hidden="true"
            >
              {options.icon ??
                (danger ? (
                  <AlertTriangle className="h-6 w-6" />
                ) : (
                  <HelpCircle className="h-6 w-6" />
                ))}
            </span>
            <AlertDialogTitle className="text-2xl">{options.title}</AlertDialogTitle>
            {options.description && (
              <AlertDialogDescription className="mx-auto max-w-sm text-balance">
                {options.description}
              </AlertDialogDescription>
            )}
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:justify-center">
            <Button
              variant="outline"
              className="min-w-28"
              disabled={loading}
              onClick={() => settle(false)}
            >
              {options.cancelText ?? "Cancel"}
            </Button>
            <Button
              variant={danger ? "destructive" : "default"}
              className="min-w-28"
              disabled={loading}
              onClick={onConfirm}
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              {options.confirmText ?? "Confirm"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ConfirmContext.Provider>
  );
}
