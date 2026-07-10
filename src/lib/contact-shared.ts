/**
 * Contact form — isomorphic types, validation, admin DTOs.
 *
 * NO server-only imports — safe for the browser bundle. Shared by the storefront
 * form (submit validation) and the admin inbox (list/triage DTOs).
 */
import { z } from "zod";

// ── Reasons (the storefront dropdown; also the stored `reason`) ──────────────

export const CONTACT_REASONS = [
  "Order Help",
  "Size Help",
  "Payment Help",
  "Return Help",
  "Collaboration",
] as const;
export type ContactReason = (typeof CONTACT_REASONS)[number];

// ── Submit validation (mirrors the DB CHECK bounds + the old client checks) ──

const bdPhone = z
  .string()
  .trim()
  .min(1, "Phone number is required.")
  .max(20)
  .refine((v) => /^01[3-9]\d{8}$/.test(v.replace(/[\s-]/g, "")), {
    message: "Enter a valid Bangladesh number (e.g. 01XXXXXXXXX).",
  });

export const contactSubmitSchema = z.object({
  name: z.string().trim().min(1, "Please enter your full name.").max(100),
  phone: bdPhone,
  email: z
    .string()
    .trim()
    .max(255)
    .email("Enter a valid email address.")
    .optional()
    .or(z.literal("")),
  reason: z.enum(CONTACT_REASONS, { message: "Please choose a contact reason." }),
  orderNumber: z.string().trim().max(40).optional().or(z.literal("")),
  message: z.string().trim().min(1, "Please write a short message.").max(1000),
});

export type ContactSubmitInput = z.infer<typeof contactSubmitSchema>;

// ── Admin inbox status + DTOs ────────────────────────────────────────────────

export const CONTACT_STATUSES = ["new", "handled", "archived"] as const;
export type ContactStatus = (typeof CONTACT_STATUSES)[number];

export const CONTACT_STATUS_META: Record<
  ContactStatus,
  { label: string; tone: "amber" | "green" | "slate" }
> = {
  new: { label: "New", tone: "amber" },
  handled: { label: "Handled", tone: "green" },
  archived: { label: "Archived", tone: "slate" },
};

export function isContactStatus(value: unknown): value is ContactStatus {
  return typeof value === "string" && (CONTACT_STATUSES as readonly string[]).includes(value);
}

export interface ContactMessageRow {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  reason: string;
  orderNumber: string | null;
  message: string;
  status: ContactStatus;
  handledByEmail: string | null;
  handledAt: string | null;
  createdAt: string;
}

export interface ContactMessageListResult {
  rows: ContactMessageRow[];
  total: number;
}

export const contactListSchema = z.object({
  status: z.enum(CONTACT_STATUSES).optional(),
  search: z.string().trim().max(100).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  offset: z.number().int().min(0).optional(),
});

export const contactStatusSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(CONTACT_STATUSES),
});

export type ContactListInput = z.infer<typeof contactListSchema>;
export type ContactStatusInput = z.infer<typeof contactStatusSchema>;

// ── Error codes → safe messages ──────────────────────────────────────────────

export const CONTACT_ERROR_MESSAGES: Record<string, string> = {
  invalid_contact: "Some details are invalid. Please check the form and try again.",
  invalid_contact_status: "That is not a valid status.",
  contact_message_not_found: "That message no longer exists.",
  actor_not_authorized: "You are not authorized to perform this action.",
};

const GENERIC_CONTACT_ERROR = "Could not send your message. Please try again.";

export function contactErrorMessage(code: string | null | undefined): string {
  if (!code) return GENERIC_CONTACT_ERROR;
  return CONTACT_ERROR_MESSAGES[code] ?? GENERIC_CONTACT_ERROR;
}
