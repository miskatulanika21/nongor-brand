/**
 * Shared validation schemas.
 *
 * Used by client for UX feedback and server as authoritative validation.
 * No server-only imports — safe for browser bundles.
 */
import { z } from "zod";

// ---- Bangladesh phone ----

const BD_PHONE_REGEX = /^01[3-9]\d{8}$/;

/** Strip whitespace, dashes, and +880/880 prefixes. */
export function normalizeBDPhone(value: string): string {
  let s = value.replace(/[\s-]/g, "");
  if (s.startsWith("+880")) s = s.slice(4);
  else if (s.startsWith("880")) s = s.slice(3);
  return s;
}

export const bdPhoneSchema = z
  .string()
  .transform(normalizeBDPhone)
  .refine((v) => BD_PHONE_REGEX.test(v), {
    message: "Enter a valid Bangladeshi number (01XXXXXXXXX).",
  });

// ---- Email ----

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, "Email is required.")
  .max(254, "Email is too long.")
  .email("Enter a valid email address.");

// ---- Password ----

/**
 * Small denylist of obviously-weak / commonly-compromised passwords. This is
 * NOT a substitute for a breach-corpus check (e.g. HaveIBeenPwned k-anonymity)
 * but rejects the most common offenders cheaply and offline. Compared
 * case-insensitively after stripping trailing digits like "123"/"!".
 */
const WEAK_PASSWORDS = new Set([
  "password",
  "passw0rd",
  "password1",
  "password123",
  "12345678",
  "123456789",
  "1234567890",
  "qwerty",
  "qwertyuiop",
  "letmein",
  "welcome",
  "admin",
  "administrator",
  "iloveyou",
  "abc123",
  "monkey",
  "dragon",
  "sunshine",
  "princess",
  "football",
  "baseball",
  "nongorr",
  "nongorr123",
  "changeme",
  "secret",
  "trustno1",
]);

/** Is this password trivially weak (in the denylist or matches the email local part)? */
export function isWeakPassword(password: string, email?: string): boolean {
  const lower = password.toLowerCase();
  const normalized = lower.replace(/[!@#$%^&*]+$/, "").replace(/\d+$/, "");
  if (WEAK_PASSWORDS.has(lower) || WEAK_PASSWORDS.has(normalized)) return true;
  if (email) {
    const local = email.split("@")[0]?.toLowerCase();
    if (local && local.length >= 3 && lower.includes(local)) return true;
  }
  return false;
}

/**
 * Customer password tier: secure but user-friendly.
 * Minimum 8 characters, not on the weak denylist.
 */
export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters.")
  .max(128, "Password is too long.")
  .refine((v) => !isWeakPassword(v), {
    message: "This password is too common. Choose a stronger one.",
  });

/**
 * Privileged (staff/admin/owner) password tier: stronger requirements.
 * Minimum 12 characters, must mix character classes, not on the denylist.
 */
export const privilegedPasswordSchema = z
  .string()
  .min(12, "Privileged accounts require at least 12 characters.")
  .max(128, "Password is too long.")
  .refine((v) => /[a-z]/.test(v) && /[A-Z]/.test(v) && /\d/.test(v), {
    message: "Use a mix of uppercase, lowercase, and numbers.",
  })
  .refine((v) => !isWeakPassword(v), {
    message: "This password is too common. Choose a stronger one.",
  });

export const passwordConfirmSchema = z
  .object({
    password: passwordSchema,
    confirm: z.string(),
  })
  .refine((data) => data.password === data.confirm, {
    message: "Passwords do not match.",
    path: ["confirm"],
  });

// ---- Login ----

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required.").max(128, "Password is too long."),
  /** Optional post-login destination. Validated by the destination resolver. */
  next: z.string().max(2048).optional(),
});

export type LoginInput = z.infer<typeof loginSchema>;

// ---- Registration ----

export const registerSchema = z
  .object({
    name: z.string().trim().min(1, "Full name is required.").max(200, "Name is too long."),
    phone: bdPhoneSchema,
    email: emailSchema,
    password: passwordSchema,
    confirm: z.string(),
  })
  .refine((data) => data.password === data.confirm, {
    message: "Passwords do not match.",
    path: ["confirm"],
  });

export type RegisterInput = z.infer<typeof registerSchema>;

// ---- Password reset request ----

export const resetRequestSchema = z.object({
  email: emailSchema,
});

export type ResetRequestInput = z.infer<typeof resetRequestSchema>;

// ---- Password update ----

export const passwordUpdateSchema = z
  .object({
    password: passwordSchema,
    confirm: z.string(),
  })
  .refine((data) => data.password === data.confirm, {
    message: "Passwords do not match.",
    path: ["confirm"],
  });

export type PasswordUpdateInput = z.infer<typeof passwordUpdateSchema>;

// ---- Auth confirm ----

// "invite" is the token type Supabase sends for inviteUserByEmail links (staff
// onboarding). It is verified like recovery: the invitee then sets an initial
// password on /auth/update-password.
const ALLOWED_CONFIRM_TYPES = ["email", "recovery", "magiclink", "invite"] as const;
export type ConfirmType = (typeof ALLOWED_CONFIRM_TYPES)[number];

export const authConfirmSchema = z.object({
  token_hash: z.string().min(1, "Token is required.").max(2048, "Token is too long."),
  type: z.enum(ALLOWED_CONFIRM_TYPES, {
    errorMap: () => ({ message: "Invalid confirmation type." }),
  }),
});

export type AuthConfirmInput = z.infer<typeof authConfirmSchema>;

// ---- Generic text ----

export const trimmedString = (maxLength = 500) =>
  z.string().trim().max(maxLength, `Value exceeds ${maxLength} characters.`);
