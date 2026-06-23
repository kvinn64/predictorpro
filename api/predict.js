// Vercel serverless function — holds the Anthropic key, verifies the signed-in
// user, enforces a per-user daily safety ceiling, AND (for full predictions)
// requires a valid single-use per-match token that you issue manually.
//
// Token flow:
//   - You insert rows into match_tokens (token, match_id) in Supabase.
//   - User enters the token; the app sends { prompt, match_id, token }.
//   - Server checks the token exists, matches the match, and is unused.
//   - It is claimed ATOMICALLY (so it can't be double-spent), then the
//     prediction runs. If the prediction fails, the claim is rolled back.
//
// The lightweight fixtures-list call sends no match_id/token and is NOT gated.

import { createClient } from "@supabase/supabase-js";

const SAFETY_CEILING = parseInt(process.env.DAILY_SAFETY_CEILING || "10", 10);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  const sbUrl = process.env.SUPABASE_URL;
  const sbService = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!apiKey) return res.status(500).json({ error: "Server missing ANTHROPIC_API_KEY" });
  if (!sbUrl || !sbService) return res.status(500).json({ error: "Server missing Supabase config" });

  // --- verify the caller is a signed-in user ---
  const authToken = (req.headers.authorization || "").replace("Bearer ", "").trim();
  if (!authToken) return res.status(401).json({ error: "Not signed in" });

  const admin = createClient(sbUrl, sbService);
  const { data: userData, error: userErr } = await admin.auth.getUser(authToken);
  if (userErr || !userData?.user) return res.status(401).json({ error: "Invalid session" });
  const userId = userData.user.id;

  const { prompt, max_tokens, match_id, token } = req.body || {};
  if (!prompt) return res.status(400).json({ error: "Missing prompt" });

  // --- gated full-prediction calls require a valid single-use token ---
  // (Fixtures-list calls omit match_id and skip this whole block.)
  const isGated = !!match_id;
  let claimedToken = null;
  if (isGated) {
    if (!token || !token.trim()) {
      return res.status(403).json({ error: "This match needs an access token." });
    }
    const code = token.trim();

    // Atomically claim: only succeeds if the row exists, matches this match,
    // and is still unused (used_by is null). The .is("used_by", null) filter
    // in the UPDATE makes the claim safe against double-spend.
    const { data: claim, error: claimErr } = await admin
      .from("match_tokens")
      .update({ used_by: userId, used_at: new Date().toISOString() })
      .eq("token", code)
      .eq("match_id", match_id)
      .is("used_by", null)
      .select("token")
      .maybeSingle();

    if (claimErr) return res.status(500).json({ error: "Token check failed. Try again." });
    if (!claim) {
      // Distinguish "wrong/!match" from "already used" for a clearer message.
      const { data: exists } = await admin
        .from("match_tokens").select("used_by,match_id").eq("token", code).maybeSingle();
      if (exists && exists.used_by) return res.status(403).json({ error: "That token has already been used." });
      if (exists && exists.match_id !== match_id) return res.status(403).json({ error: "That token is for a different match." });
      return res.status(403).json({ error: "Invalid access token for this match." });
    }
    claimedToken = code;
  }

  async function rollbackClaim() {
    if (claimedToken) {
      await admin.from("match_tokens")
        .update({ used_by: null, used_at: null })
        .eq("token", claimedToken);
    }
  }

  // --- generous per-user daily safety ceiling (abuse stop only) ---
  const today = new Date().toISOString().slice(0, 10);
  const { data: usage } = await admin
    .from("usage").select("count").eq("user_id", userId).eq("day", today).maybeSingle();
  const used = usage?.count || 0;
  if (used >= SAFETY_CEILING) {
    await rollbackClaim();
    return res.status(429).json({ error: "Daily safety limit reached. Try again tomorrow." });
  }

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-opus-4-8",
        max_tokens: max_tokens || 1500,
        messages: [{ role: "user", content: prompt }],
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }],
      }),
    });

    const data = await r.json();
    if (!r.ok) {
      await rollbackClaim(); // don't burn the token on a failed call
      return res.status(r.status).json({ error: data.error?.message || "Anthropic error" });
    }

    await admin.from("usage").upsert(
      { user_id: userId, day: today, count: used + 1 },
      { onConflict: "user_id,day" }
    );

    return res.status(200).json(data);
  } catch (e) {
    await rollbackClaim();
    return res.status(500).json({ error: String(e?.message || e) });
  }
}
