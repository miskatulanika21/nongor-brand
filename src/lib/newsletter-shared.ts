/**
 * Newsletter opt-in — isomorphic schema + messages.
 *
 * NO server-only imports — safe for the browser bundle. Shared by the footer
 * form (client validation) and the server fn (authoritative re-validation).
 * Consent management / unsubscribe UI are Stage 6; this only captures opt-ins.
 */
import { z } from "zod";

export const newsletterSubscribeSchema = z.object({
  email: z.string().trim().min(3).max(255).email("Enter a valid email address."),
  /**
   * Optional WhatsApp number (the "prefer WhatsApp updates" toggle). Validated
   * as a BD mobile when present; empty string means not provided.
   */
  whatsapp: z
    .string()
    .trim()
    .max(20)
    .refine((v) => v === "" || /^01[3-9]\d{8}$/.test(v.replace(/[\s-]/g, "")), {
      message: "Enter a valid Bangladesh number (e.g. 01XXXXXXXXX).",
    })
    .optional()
    .or(z.literal("")),
});

export type NewsletterSubscribeInput = z.infer<typeof newsletterSubscribeSchema>;

export const NEWSLETTER_ERROR_MESSAGES: Record<string, string> = {
  invalid_subscription: "That email address doesn't look right. Please check and try again.",
};

const GENERIC_NEWSLETTER_ERROR = "Could not save your subscription. Please try again.";

export function newsletterErrorMessage(code: string | null | undefined): string {
  if (!code) return GENERIC_NEWSLETTER_ERROR;
  return NEWSLETTER_ERROR_MESSAGES[code] ?? GENERIC_NEWSLETTER_ERROR;
}
