/**
 * Provision Admin Script — hardened version.
 *
 * Creates a Supabase Auth user and grants them a staff role via the
 * atomic private.provision_staff() RPC (which inserts both the staff
 * profile and audit log in one transaction).
 *
 * Security requirements:
 *   - Password is collected via hidden interactive prompt (never visible in CLI args)
 *   - No credentials are logged to stdout/stderr
 *   - If the RPC fails after a new Auth user was created, compensation
 *     deletes the orphaned Auth user
 *   - If compensation fails, a manual cleanup instruction is printed
 *   - Existing Auth users are NOT silently overwritten
 *   - No non-atomic direct insert fallback
 *
 * Usage:
 *   npx tsx scripts/provision-admin.ts
 *   (interactive prompts for email, role, display name, and password)
 */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import * as readline from "node:readline";

// ---- Env validation ---------------------------------------------------------

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("❌ Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ---- Prompts ----------------------------------------------------------------

const VALID_ROLES = ["owner", "admin", "staff"] as const;

function ask(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Prompt for password with hidden input.
 * Falls back to visible input if terminal doesn't support raw mode.
 */
async function askPassword(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    // Try to enable raw mode for hidden input
    if (process.stdin.isTTY) {
      process.stdout.write(prompt);
      let password = "";

      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.setEncoding("utf8");

      const onData = (char: string) => {
        const c = char.toString();
        if (c === "\n" || c === "\r" || c === "\u0004") {
          // Enter or Ctrl+D
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.removeListener("data", onData);
          process.stdout.write("\n");
          rl.close();
          resolve(password);
        } else if (c === "\u0003") {
          // Ctrl+C
          process.stdin.setRawMode(false);
          process.exit(130);
        } else if (c === "\u007f" || c === "\b") {
          // Backspace
          if (password.length > 0) {
            password = password.slice(0, -1);
          }
        } else {
          password += c;
        }
      };

      process.stdin.on("data", onData);
    } else {
      // Non-TTY fallback (piped input) — cannot hide
      rl.question(prompt, (answer) => {
        rl.close();
        resolve(answer);
      });
    }
  });
}

// ---- Main -------------------------------------------------------------------

async function main() {
  console.log("\n🔧 Nongorr Studio — Staff Provisioning\n");

  // Collect inputs
  const email = await ask("Staff email: ");
  if (!email || !email.includes("@")) {
    console.error("❌ Invalid email.");
    process.exit(1);
  }

  const roleInput = await ask(`Role (${VALID_ROLES.join("/")}): `);
  const role = roleInput.toLowerCase() as (typeof VALID_ROLES)[number];
  if (!VALID_ROLES.includes(role)) {
    console.error(`❌ Invalid role. Must be one of: ${VALID_ROLES.join(", ")}`);
    process.exit(1);
  }

  const displayName = (await ask("Display name (optional): ")) || role;

  const password = await askPassword("Password (hidden): ");
  // Privileged accounts require the stronger policy: 12+ chars, mixed classes.
  if (
    !password ||
    password.length < 12 ||
    !/[a-z]/.test(password) ||
    !/[A-Z]/.test(password) ||
    !/\d/.test(password)
  ) {
    console.error(
      "❌ Privileged password must be at least 12 characters and include uppercase, lowercase, and a number.",
    );
    process.exit(1);
  }

  const confirm = await askPassword("Confirm password (hidden): ");
  if (password !== confirm) {
    console.error("❌ Passwords do not match.");
    process.exit(1);
  }

  // Confirmation
  console.log(`\n  Email: ${email}`);
  console.log(`  Role:  ${role}`);
  console.log(`  Name:  ${displayName}`);
  const proceed = await ask("\nCreate this staff account? (yes/no): ");
  if (proceed.toLowerCase() !== "yes") {
    console.log("Cancelled.");
    process.exit(0);
  }

  // Step 1: Check for existing Auth user
  const { data: existingUsers } = await admin.auth.admin.listUsers();
  const existing = existingUsers?.users?.find((u) => u.email === email);

  let userId: string;
  let isNewUser = false;

  if (existing) {
    userId = existing.id;
    console.log(`\n⚠️  Auth user already exists (id: ${userId.slice(0, 8)}…)`);

    // Check if staff profile exists
    const { data: existingProfile } = await admin
      .from("staff_profiles")
      .select("role, is_active")
      .eq("user_id", userId)
      .maybeSingle();

    if (existingProfile) {
      console.error(
        `❌ Staff profile already exists (role: ${existingProfile.role}, active: ${existingProfile.is_active}).`,
      );
      console.error(
        "   To update an existing staff member, use the admin dashboard or a dedicated update script.",
      );
      process.exit(1);
    }

    console.log("   No staff profile found — will create one for this existing user.");
    const updateConfirm = await ask("   Proceed with staff profile creation? (yes/no): ");
    if (updateConfirm.toLowerCase() !== "yes") {
      console.log("Cancelled.");
      process.exit(0);
    }
  } else {
    // Create new Auth user
    const { data: newUser, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: displayName },
    });

    if (createError || !newUser.user) {
      console.error("❌ Failed to create Auth user:", createError?.message);
      process.exit(1);
    }

    userId = newUser.user.id;
    isNewUser = true;
    console.log(`\n✅ Auth user created (id: ${userId.slice(0, 8)}…)`);
  }

  // Step 2: Provision via atomic RPC (staff_profiles + audit_logs).
  // Bootstrap provisioning has no human actor → p_actor_id null (recorded as a
  // system action in the audit log).
  const { error: rpcError } = await admin.rpc("provision_staff", {
    p_user_id: userId,
    p_role: role,
    p_display_name: displayName,
    p_actor_id: null,
    p_is_active: true,
  });

  if (rpcError) {
    console.error(`\n❌ Database provisioning failed: ${rpcError.message}`);

    // Compensation: delete the orphaned Auth user if we just created it
    if (isNewUser) {
      console.log("   Attempting to clean up orphaned Auth user...");
      const { error: deleteError } = await admin.auth.admin.deleteUser(userId);

      if (deleteError) {
        console.error(`\n❌ COMPENSATION FAILED — manual cleanup required:`);
        console.error(`   Delete Auth user with id starting with: ${userId.slice(0, 8)}…`);
        console.error(`   Use: Supabase Dashboard → Authentication → Users → Find and delete`);
        console.error(`   Or run: await admin.auth.admin.deleteUser("${userId}")`);
      } else {
        console.log("   ✅ Orphaned Auth user deleted successfully.");
      }
    }

    process.exit(1);
  }

  console.log(`\n✅ Staff provisioned successfully!`);
  console.log(`   Email: ${email}`);
  console.log(`   Role:  ${role}`);
  console.log(`\n⚠️  Store the password in a secure vault. It will not be shown again.\n`);
}

main().catch((err) => {
  // Never print the full error object — it might contain credentials
  console.error("❌ Unexpected error:", err instanceof Error ? err.message : "Unknown error");
  process.exit(1);
});
