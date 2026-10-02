import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "node:crypto";

// One-shot idempotent seeder: creates the initial admin account if and only if
// no admin currently exists in user_roles. Safe to call multiple times.
export const Route = createFileRoute("/api/public/bootstrap-admin")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = (process.env["BOOTSTRAP_ADMIN_TOKEN"] ?? "").trim();
        const provided = (request.headers.get("x-bootstrap-admin-token") ?? "").trim();
        if (!expected || !provided) return new Response("Unauthorized", { status: 401 });
        const a = Buffer.from(expected);
        const b = Buffer.from(provided);
        if (a.length !== b.length || !timingSafeEqual(a, b)) {
          return new Response("Unauthorized", { status: 401 });
        }
        const body = (await request.json().catch(() => ({}))) as {
          email?: string;
          password?: string;
          full_name?: string;
        };
        const email = body.email?.trim().toLowerCase();
        const password = body.password;
        const full_name = body.full_name ?? "Erwan Jaffrelot";

        if (!email || !password) {
          return Response.json({ ok: false, error: "email and password required" }, { status: 400 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // If an admin already exists, refuse.
        const { data: existingAdmins, error: rolesErr } = await supabaseAdmin
          .from("user_roles")
          .select("user_id")
          .eq("role", "admin")
          .limit(1);
        if (rolesErr) return Response.json({ ok: false, error: rolesErr.message }, { status: 500 });
        if (existingAdmins && existingAdmins.length > 0) {
          return Response.json({ ok: false, error: "admin_already_exists" }, { status: 409 });
        }

        // Find or create the auth user.
        let userId: string | null = null;
        const list = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
        if (list.error) return Response.json({ ok: false, error: list.error.message }, { status: 500 });
        const existing = list.data.users.find((u) => u.email?.toLowerCase() === email);
        if (existing) {
          userId = existing.id;
          const upd = await supabaseAdmin.auth.admin.updateUserById(userId, {
            password,
            email_confirm: true,
            user_metadata: { full_name },
          });
          if (upd.error) return Response.json({ ok: false, error: upd.error.message }, { status: 500 });
        } else {
          const created = await supabaseAdmin.auth.admin.createUser({
            email,
            password,
            email_confirm: true,
            user_metadata: { full_name },
          });
          if (created.error) return Response.json({ ok: false, error: created.error.message }, { status: 500 });
          userId = created.data.user!.id;
        }

        // Ensure profile.
        await supabaseAdmin
          .from("profiles")
          .upsert({ id: userId, email, full_name } as never, { onConflict: "id" });

        // Ensure admin role (remove any default client role).
        await supabaseAdmin.from("user_roles").delete().eq("user_id", userId);
        const { error: roleErr } = await supabaseAdmin
          .from("user_roles")
          .insert({ user_id: userId, role: "admin" } as never);
        if (roleErr) return Response.json({ ok: false, error: roleErr.message }, { status: 500 });

        return Response.json({ ok: true, user_id: userId });
      },
    },
  },
});
