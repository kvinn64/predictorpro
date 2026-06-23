// Vercel serverless function — holds the Anthropic key and verifies the caller
// is a signed-in user. Your key is never exposed to the browser.
//
// Spending is primarily controlled in the app itself: predictions can only be
// generated for matches that haven't kicked off yet, and each user's results
// are private (re-opening your own analyzed match is free / cached). We keep a
// generous per-user daily safety ceiling here purely to stop runaway abuse —
// not as the main limiter.

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
  const token = (req.headers.authorization || "").replace("Bearer ", "").trim();
  if (!token) return res.status(401).json({ error: "Not signed in" });

  const admin = createClient(sbUrl, sbService);
  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData?.user) return res.status(401).json({ error: "Invalid session" });
  const userId = userData.user.id;

  // --- generous per-user daily safety ceiling (abuse stop only) ---
  const today = new Date().toISOString().slice(0, 10);
  const { data: usage } = await admin
    .from("usage").select("count").eq("user_id", userId).eq("day", today).maybeSingle();
  const used = usage?.count || 0;
  if (used >= SAFETY_CEILING) {
    return res.status(429).json({ error: "Daily safety limit reached. Try again tomorrow." });
  }

  try {
    const { prompt, max_tokens } = req.body || {};
    if (!prompt) return res.status(400).json({ error: "Missing prompt" });

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
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 6 }],
      }),
    });

    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: data.error?.message || "Anthropic error" });

    await admin.from("usage").upsert(
      { user_id: userId, day: today, count: used + 1 },
      { onConflict: "user_id,day" }
    );

    return res.status(200).json(data);
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
}
