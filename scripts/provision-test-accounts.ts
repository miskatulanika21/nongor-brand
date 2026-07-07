import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
dotenv.config();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("❌ Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const TEST_PASSWORD = "NongorrTest123!";

const TARGET_USERS = [
  {
    email: "owner@nongorr.test",
    role: "owner" as const,
    displayName: "Test Owner",
    isStaff: true,
  },
  {
    email: "admin@nongorr.test",
    role: "admin" as const,
    displayName: "Test Admin",
    isStaff: true,
  },
  {
    email: "staff@nongorr.test",
    role: "staff" as const,
    displayName: "Test Staff",
    isStaff: true,
  },
  {
    email: "customer@nongorr.test",
    role: "customer" as const,
    displayName: "Test Customer",
    isStaff: false,
  },
];

async function main() {
  console.log("⚙️  Provisioning QA/Testing accounts for each role...");

  // Fetch all users in Auth to inspect
  const {
    data: { users: authUsers },
    error: listAuthError,
  } = await admin.auth.admin.listUsers();
  if (listAuthError) {
    console.error("❌ Failed to list Auth users:", listAuthError.message);
    process.exit(1);
  }

  for (const target of TARGET_USERS) {
    console.log(`\n--- Config matching: ${target.email} (${target.role}) ---`);
    const existingAuth = authUsers.find((u) => u.email === target.email);
    let userId = "";

    if (existingAuth) {
      userId = existingAuth.id;
      console.log(`Found existing Auth user: ${userId}`);
      // Update password to NongorrTest123! and confirm email
      const { error: updateError } = await admin.auth.admin.updateUserById(userId, {
        password: TEST_PASSWORD,
        email_confirm: true,
        user_metadata: { full_name: target.displayName },
      });
      if (updateError) {
        console.error(
          `❌ Failed to update password/metadata for ${target.email}:`,
          updateError.message,
        );
      } else {
        console.log(`✅ Updated password and metadata to target values`);
      }
    } else {
      // Create new Auth user
      const { data: newUser, error: createError } = await admin.auth.admin.createUser({
        email: target.email,
        password: TEST_PASSWORD,
        email_confirm: true,
        user_metadata: { full_name: target.displayName },
      });
      if (createError || !newUser.user) {
        console.error(`❌ Failed to create Auth user for ${target.email}:`, createError?.message);
        continue;
      }
      userId = newUser.user.id;
      console.log(`✅ Auth user created successfully: ${userId}`);
    }

    if (target.isStaff) {
      // Check staff profile
      const { data: existingProfile, error: profileFetchError } = await admin
        .from("staff_profiles")
        .select("id, role, is_active")
        .eq("user_id", userId)
        .maybeSingle();

      if (profileFetchError) {
        console.error(`❌ Error fetching staff profile:`, profileFetchError.message);
        continue;
      }

      if (existingProfile) {
        console.log(
          `Staff profile already exists (role: ${existingProfile.role}, active: ${existingProfile.is_active})`,
        );
        if (existingProfile.role !== target.role || !existingProfile.is_active) {
          console.log(`Updating staff profile to role: ${target.role}, active: true...`);
          const { error: updateProfileError } = await admin
            .from("staff_profiles")
            .update({ role: target.role, is_active: true })
            .eq("user_id", userId);

          if (updateProfileError) {
            console.error(`❌ Failed to update staff profile:`, updateProfileError.message);
          } else {
            console.log(`✅ Staff profile updated`);
          }
        }
      } else {
        console.log(`No staff profile exists. Creating via provision_staff RPC...`);
        const { error: rpcError } = await admin.schema("api").rpc("provision_staff", {
          p_user_id: userId,
          p_role: target.role,
          p_display_name: target.displayName,
          p_actor_id: null,
          p_is_active: true,
        });

        if (rpcError) {
          console.error(`❌ provision_staff RPC failed:`, rpcError.message);
        } else {
          console.log(`✅ Staff profile created via RPC`);
        }
      }
    } else {
      // Ensure they don't have a staff profile if they are a regular customer
      const { data: existingProfile } = await admin
        .from("staff_profiles")
        .select("id")
        .eq("user_id", userId)
        .maybeSingle();

      if (existingProfile) {
        console.log(`⚠️  Warning: Customer user has staff profile. Deleting staff profile...`);
        const { error: deleteProfileError } = await admin
          .from("staff_profiles")
          .delete()
          .eq("user_id", userId);

        if (deleteProfileError) {
          console.error(`❌ Failed to delete staff profile:`, deleteProfileError.message);
        } else {
          console.log(`✅ Staff profile deleted`);
        }
      }
    }
  }

  console.log("\n========================================================");
  console.log("🎉  ALL TEST ACCOUNTS CONFIGURED AND READY FOR USE!  🎉");
  console.log("========================================================");
  console.log("Use the following credentials to log in & test the app:");
  console.log("--------------------------------------------------------");
  console.log("Password for all: " + TEST_PASSWORD);
  console.log("--------------------------------------------------------");
  TARGET_USERS.forEach((u) => {
    console.log(`- [${u.role.toUpperCase()}] ${u.email} -> ${u.displayName}`);
  });
  console.log("========================================================\n");
}

main().catch((err) => {
  console.error("❌ Unexpected error:", err instanceof Error ? err.message : "Unknown error");
});
