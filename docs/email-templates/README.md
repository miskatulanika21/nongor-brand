# Nongorr — Supabase Auth email templates

Premium branded HTML for the emails Supabase Auth sends (they can't call the app's
`renderBrandedEmail()`, so these are standalone files that mirror that design:
anchor logo, `NONGORR / নোঙর` wordmark, maroon + gold palette, serif headings).

## Where to paste each

**Supabase Dashboard → Authentication → Emails → Templates** — pick the template on
the left, then replace the **Message body (HTML)** with the matching file below.
(Custom SMTP → Resend is already configured, so these send from `noreply@nongorr.com`.)

| Supabase template        | File                                                             | Suggested subject              |
| ------------------------ | ---------------------------------------------------------------- | ------------------------------ |
| **Confirm signup**       | [`supabase-confirm-signup.html`](./supabase-confirm-signup.html) | `Confirm your Nongorr account` |
| **Reset password**       | [`supabase-reset-password.html`](./supabase-reset-password.html) | `Reset your Nongorr password`  |
| **Magic Link**           | [`supabase-magic-link.html`](./supabase-magic-link.html)         | `Your Nongorr sign-in link`    |
| **Change Email Address** | [`supabase-change-email.html`](./supabase-change-email.html)     | `Confirm your new email`       |

## Notes

- The button + fallback link both use Supabase's `{{ .ConfirmationURL }}` variable —
  don't change that token; Supabase fills it in per email.
- The logo loads from `https://nongorr.com/apple-touch-icon.png` (already public).
- Google sign-in users never receive Confirm-signup / Reset-password (no password),
  so these only reach email + password accounts.
- Preview any file by opening it in a browser (the `{{ .ConfirmationURL }}` shows as
  literal text until Supabase renders it).
