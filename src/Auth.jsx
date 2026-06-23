import React, { useState } from "react";
import { supabase } from "./supabase.js";

const ACCENT = "#1FE3A8";
const BG = "#070B14";
const CARD = "#0E1626";
const BORDER = "#1B2A45";
const TEXT = "#E8EEF7";
const MUTED = "#8294AE";

export default function Auth() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function magicLink() {
    if (!email.trim()) { setErr("Enter your email."); return; }
    setBusy(true); setErr("");
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin },
    });
    setBusy(false);
    if (error) setErr(error.message); else setSent(true);
  }

  async function google() {
    setErr("");
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    if (error) setErr(error.message);
  }

  return (
    <div style={{ fontFamily: "'Inter',-apple-system,system-ui,sans-serif", background: BG, color: TEXT, minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap'); body{margin:0;background:${BG}}`}</style>

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke={ACCENT} strokeWidth="1.8"><path d="M12 3a9 9 0 1 0 9 9"/><path d="M12 7v5l3 2"/></svg>
        <div style={{ fontWeight: 800, fontSize: 24, letterSpacing: -0.5 }}>Predictor<span style={{ color: ACCENT }}>Pro</span></div>
      </div>
      <div style={{ color: MUTED, fontSize: 14, marginBottom: 28 }}>Sign in to continue</div>

      <div style={{ width: "100%", maxWidth: 360, background: CARD, border: `1px solid ${BORDER}`, borderRadius: 20, padding: 22 }}>
        {!sent ? (
          <>
            <button onClick={google} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, background: "#fff", color: "#1a1a1a", border: "none", borderRadius: 12, padding: "13px 0", fontSize: 15, fontWeight: 700, cursor: "pointer" }}>
              <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.6 30.2 0 24 0 14.6 0 6.4 5.4 2.5 13.2l7.8 6.1C12.2 13.3 17.6 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.5 3-2.2 5.5-4.7 7.2l7.3 5.7c4.3-4 6.7-9.9 6.7-17.4z"/><path fill="#FBBC05" d="M10.3 28.7c-.5-1.5-.8-3-.8-4.7s.3-3.2.8-4.7l-7.8-6.1C.9 16.5 0 20.1 0 24s.9 7.5 2.5 10.8l7.8-6.1z"/><path fill="#34A853" d="M24 48c6.2 0 11.4-2 15.2-5.5l-7.3-5.7c-2 1.4-4.7 2.3-7.9 2.3-6.4 0-11.8-3.8-13.7-9.3l-7.8 6.1C6.4 42.6 14.6 48 24 48z"/></svg>
              Continue with Google
            </button>

            <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "18px 0", color: MUTED, fontSize: 12 }}>
              <div style={{ flex: 1, height: 1, background: BORDER }} /> or <div style={{ flex: 1, height: 1, background: BORDER }} />
            </div>

            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@email.com" type="email"
              style={{ width: "100%", background: "#0A1120", border: `1px solid ${BORDER}`, borderRadius: 12, padding: "13px 14px", color: TEXT, fontSize: 15, outline: "none" }} />
            <button onClick={magicLink} disabled={busy} style={{ width: "100%", marginTop: 12, background: ACCENT, color: "#04140E", border: "none", borderRadius: 12, padding: "13px 0", fontSize: 15, fontWeight: 800, cursor: "pointer" }}>
              {busy ? "Sending…" : "Email me a sign-in link"}
            </button>
            {err && <div style={{ color: "#FF6B6B", fontSize: 13, marginTop: 12 }}>{err}</div>}
          </>
        ) : (
          <div style={{ textAlign: "center", padding: "10px 0" }}>
            <div style={{ fontSize: 32, marginBottom: 10 }}>✉️</div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>Check your email</div>
            <div style={{ color: MUTED, fontSize: 14, marginTop: 8, lineHeight: 1.5 }}>We sent a sign-in link to <b style={{ color: TEXT }}>{email}</b>. Tap it on this device to log in.</div>
          </div>
        )}
      </div>

      <div style={{ color: MUTED, fontSize: 11.5, marginTop: 22, maxWidth: 340, textAlign: "center", lineHeight: 1.6 }}>
        Private app for invited users. Predictions are AI-generated entertainment, not betting advice.
      </div>
    </div>
  );
}
