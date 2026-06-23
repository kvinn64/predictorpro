import React, { useState } from "react";
import { supabase } from "./supabase.js";

const ACCENT = "#1FE3A8";
const BG = "#070B14";
const CARD = "#0E1626";
const BORDER = "#1B2A45";
const TEXT = "#E8EEF7";
const MUTED = "#8294AE";

function isStrongPassword(p) {
  return p.length >= 8 && /[a-z]/.test(p) && /[A-Z]/.test(p) && /[0-9]/.test(p);
}

export default function Auth() {
  const [mode, setMode] = useState("login"); // login | register
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [info, setInfo] = useState("");

  function reset() { setErr(""); setInfo(""); }

  async function login() {
    reset();
    if (!email.trim() || !password) { setErr("Enter your email and password."); return; }
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(), password,
    });
    setBusy(false);
    if (error) {
      // Friendlier messages for the common cases
      if (/email not confirmed/i.test(error.message)) {
        setErr("Please confirm your email first — check your inbox for the verification link, then log in.");
      } else if (/invalid login/i.test(error.message)) {
        setErr("Wrong email or password. If you haven't registered yet, tap Register below.");
      } else {
        setErr(error.message);
      }
    }
    // on success, the app's auth listener takes over automatically
  }

  async function register() {
    reset();
    if (!email.trim() || !password) { setErr("Enter an email and a password."); return; }
    if (!isStrongPassword(password)) {
      setErr("Password must be at least 8 characters and include at least 1 uppercase letter, 1 lowercase letter, and 1 number.");
      return;
    }
    setBusy(true);
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(), password,
      options: { emailRedirectTo: window.location.origin },
    });
    setBusy(false);
    if (error) {
      const m = error.message || "";
      if (/rate limit|too many/i.test(m)) {
        setErr("Too many emails sent recently. Wait a few minutes, then try again — or just log in if you already registered.");
      } else if (/already registered/i.test(m)) {
        setErr("That email is already registered. Switch to Log in.");
      } else if (/password/i.test(m) && /(character|uppercase|lowercase|digit|abcdef)/i.test(m)) {
        // catch Supabase's raw password-rule text and show our clean version
        setErr("Password must be at least 8 characters and include at least 1 uppercase letter, 1 lowercase letter, and 1 number.");
      } else {
        setErr(m);
      }
      return;
    }
    // If email confirmation is ON, session is null until they click the link.
    if (!data.session) {
      setInfo("Account created. Check your email once to verify, then come back and log in with your email + password. You won't need to verify again.");
      setMode("login");
    }
  }

  async function google() {
    reset();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    if (error) setErr(error.message);
  }

  const submit = mode === "login" ? login : register;

  return (
    <div style={{ fontFamily: "'Inter',-apple-system,system-ui,sans-serif", background: BG, color: TEXT, minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap'); body{margin:0;background:${BG}}`}</style>

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke={ACCENT} strokeWidth="1.8"><path d="M12 3a9 9 0 1 0 9 9"/><path d="M12 7v5l3 2"/></svg>
        <div style={{ fontWeight: 800, fontSize: 24, letterSpacing: -0.5 }}>Predictor<span style={{ color: ACCENT }}>Pro</span></div>
      </div>
      <div style={{ color: MUTED, fontSize: 14, marginBottom: 28 }}>{mode === "login" ? "Log in to continue" : "Create your account"}</div>

      <div style={{ width: "100%", maxWidth: 360, background: CARD, border: `1px solid ${BORDER}`, borderRadius: 20, padding: 22 }}>
        <button onClick={google} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, background: "#fff", color: "#1a1a1a", border: "none", borderRadius: 12, padding: "13px 0", fontSize: 15, fontWeight: 700, cursor: "pointer" }}>
          <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.6 30.2 0 24 0 14.6 0 6.4 5.4 2.5 13.2l7.8 6.1C12.2 13.3 17.6 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.5 3-2.2 5.5-4.7 7.2l7.3 5.7c4.3-4 6.7-9.9 6.7-17.4z"/><path fill="#FBBC05" d="M10.3 28.7c-.5-1.5-.8-3-.8-4.7s.3-3.2.8-4.7l-7.8-6.1C.9 16.5 0 20.1 0 24s.9 7.5 2.5 10.8l7.8-6.1z"/><path fill="#34A853" d="M24 48c6.2 0 11.4-2 15.2-5.5l-7.3-5.7c-2 1.4-4.7 2.3-7.9 2.3-6.4 0-11.8-3.8-13.7-9.3l-7.8 6.1C6.4 42.6 14.6 48 24 48z"/></svg>
          Continue with Google
        </button>

        <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "18px 0", color: MUTED, fontSize: 12 }}>
          <div style={{ flex: 1, height: 1, background: BORDER }} /> or <div style={{ flex: 1, height: 1, background: BORDER }} />
        </div>

        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@email.com" type="email" autoComplete="email"
          style={inp} />
        <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" type="password"
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
          style={{ ...inp, marginTop: 10 }} />

        {mode === "register" && (
          <div style={{ fontSize: 12, color: password && !isStrongPassword(password) ? "#FF6B6B" : MUTED, marginTop: 8, lineHeight: 1.5 }}>
            Password needs at least 8 characters, with 1 uppercase letter, 1 lowercase letter, and 1 number.
          </div>
        )}

        <button onClick={submit} disabled={busy} style={{ width: "100%", marginTop: 14, background: ACCENT, color: "#04140E", border: "none", borderRadius: 12, padding: "13px 0", fontSize: 15, fontWeight: 800, cursor: "pointer" }}>
          {busy ? "Please wait…" : mode === "login" ? "Log in" : "Register"}
        </button>

        {err && <div style={{ color: "#FF6B6B", fontSize: 13, marginTop: 12, lineHeight: 1.5 }}>{err}</div>}
        {info && <div style={{ color: ACCENT, fontSize: 13, marginTop: 12, lineHeight: 1.5 }}>{info}</div>}

        <div style={{ textAlign: "center", marginTop: 16, color: MUTED, fontSize: 13 }}>
          {mode === "login" ? (
            <>No account? <button onClick={() => { setMode("register"); reset(); }} style={linkBtn}>Register</button></>
          ) : (
            <>Already registered? <button onClick={() => { setMode("login"); reset(); }} style={linkBtn}>Log in</button></>
          )}
        </div>
      </div>

      <div style={{ color: MUTED, fontSize: 11.5, marginTop: 22, maxWidth: 340, textAlign: "center", lineHeight: 1.6 }}>
        Private app for invited users. Predictions are AI-generated entertainment, not betting advice.
      </div>
    </div>
  );
}

const inp = { width: "100%", background: "#0A1120", border: `1px solid ${BORDER}`, borderRadius: 12, padding: "13px 14px", color: TEXT, fontSize: 15, outline: "none" };
const linkBtn = { background: "none", border: "none", color: ACCENT, fontWeight: 700, fontSize: 13, cursor: "pointer", padding: 0, textDecoration: "underline" };
