import React, { useState, useEffect } from "react";
import { supabase } from "./supabase.js";

// ============================================================================
//  PredictorPro — personal AI football predictor (web-app build)
//  Calls /api/predict (serverless) which proxies to Claude Opus 4.8 + web search.
//  Fixtures + predictions synced via Supabase; Stats tab tracks accuracy.
//  Gated behind Supabase auth (see main.jsx / Auth.jsx).
// ============================================================================

const ACCENT = "#1FE3A8";
const ACCENT_DIM = "#0E8E68";
const BG = "#070B14";
const CARD = "#0E1626";
const CARD_HI = "#13203A";
const BORDER = "#1B2A45";
const TEXT = "#E8EEF7";
const MUTED = "#8294AE";

// ---------- Supabase-backed storage (PRIVATE per user) ----------
// Tables (see README for SQL):
//   fixtures(user_id uuid, date_key text, data jsonb, pk(user_id,date_key))
//   predictions(user_id uuid, match_id text, data jsonb, pk(user_id,match_id))
//   results(user_id uuid, match_id text, actual text, pk(user_id,match_id))
// Every user only ever sees their own rows (enforced by RLS).
async function loadFixturesMap(userId) {
  const { data } = await supabase.from("fixtures").select("date_key,data").eq("user_id", userId);
  const out = {};
  (data || []).forEach((r) => { out[r.date_key] = r.data; });
  return out;
}
async function loadPredictionsMap(userId) {
  const { data } = await supabase.from("predictions").select("match_id,data").eq("user_id", userId);
  const out = {};
  (data || []).forEach((r) => { out[r.match_id] = r.data; });
  return out;
}
async function loadResultsMap(userId) {
  const { data } = await supabase.from("results").select("match_id,actual").eq("user_id", userId);
  const out = {};
  (data || []).forEach((r) => { out[r.match_id] = r.actual; });
  return out;
}
async function saveFixture(userId, dateKey, data) {
  await supabase.from("fixtures").upsert({ user_id: userId, date_key: dateKey, data });
}
async function savePrediction(userId, matchId, data) {
  await supabase.from("predictions").upsert({ user_id: userId, match_id: matchId, data });
}
async function saveResult(userId, matchId, actual) {
  await supabase.from("results").upsert({ user_id: userId, match_id: matchId, actual });
}

// ---------- kickoff helpers ----------
// Parse a "HH:MM" kickoff (24h) on a given calendar day into a Date.
function kickoffDate(day, kickoff) {
  if (!kickoff || !/^\d{1,2}:\d{2}/.test(kickoff)) return null;
  const [h, m] = kickoff.split(":").map((n) => parseInt(n, 10));
  const d = new Date(day);
  d.setHours(h, m, 0, 0);
  return d;
}
// Has this match already kicked off? (used only for a neutral status badge)
function hasStarted(day, kickoff) {
  const k = kickoffDate(day, kickoff);
  if (!k) return false; // unknown time → treat as not started
  return Date.now() >= k.getTime();
}

const PALETTE = ["#6FA8DC", "#E06666", "#111827", "#F1C232", "#76A5AF", "#8E7CC3", "#6AA84F", "#E69138", "#A64D79", "#45818E"];
function teamColor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

function Jersey({ name, size = 36 }) {
  const color = teamColor(name);
  const id = "j" + name.replace(/\W/g, "");
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.95" />
          <stop offset="1" stopColor={color} stopOpacity="0.55" />
        </linearGradient>
      </defs>
      <path d="M22 10 L16 16 L8 22 L14 30 L20 26 L20 52 Q20 54 22 54 L42 54 Q44 54 44 52 L44 26 L50 30 L56 22 L48 16 L42 10 Q38 16 32 16 Q26 16 22 10 Z"
        fill={`url(#${id})`} stroke={color} strokeWidth="1.2" strokeOpacity="0.5" />
    </svg>
  );
}

function Bar({ value }) {
  return (
    <div style={{ width: "100%", height: 6, background: "#16223A", borderRadius: 99, overflow: "hidden", marginTop: 9 }}>
      <div style={{ width: `${value}%`, height: "100%", background: `linear-gradient(90deg, ${ACCENT_DIM}, ${ACCENT})`, borderRadius: 99, transition: "width .8s cubic-bezier(.2,.8,.2,1)" }} />
    </div>
  );
}

const target = (s = 18, c = ACCENT) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2"><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.4" fill={c} /></svg>
);

function buildDays() {
  const out = [];
  const today = new Date();
  for (let i = 0; i <= 1; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    out.push(d);
  }
  return out; // [today, tomorrow]
}

// ---- calls our own serverless endpoint, which holds the API key ----
// For gated full-prediction calls, pass matchId + token; the server validates
// and consumes the single-use token before spending an API call. The fixtures
// list omits both and is not gated.
async function callOpus(prompt, maxTokens = 1200, matchId = null, token = null) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch("/api/predict", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: session ? `Bearer ${session.access_token}` : "",
    },
    body: JSON.stringify({ prompt, max_tokens: maxTokens, match_id: matchId, token }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  const text = (data.content || []).map((b) => (b.type === "text" ? b.text : "")).filter(Boolean).join("\n");
  const clean = text.replace(/```json/g, "").replace(/```/g, "").trim();
  const s = clean.indexOf("{") >= 0 && (clean.indexOf("[") < 0 || clean.indexOf("{") < clean.indexOf("[")) ? clean.indexOf("{") : clean.indexOf("[");
  const e = Math.max(clean.lastIndexOf("}"), clean.lastIndexOf("]"));
  return JSON.parse(clean.slice(s, e + 1));
}

const matchId = (dateKey, m) => `${dateKey}__${m.home}__${m.away}`.replace(/\s+/g, "_");

export default function App({ session }) {
  const userId = session?.user?.id;
  const days = buildDays();
  const todayIdx = 0; // buildDays: index 0 = today, 1 = tomorrow
  const [activeDay, setActiveDay] = useState(days[todayIdx]);
  const [filter, setFilter] = useState("all");
  const [fixtures, setFixtures] = useState({});
  const [predictions, setPredictions] = useState({});
  const [results, setResults] = useState({});
  const [hydrated, setHydrated] = useState(false);
  const [loadingDay, setLoadingDay] = useState(false);
  const [dayError, setDayError] = useState("");
  const [selected, setSelected] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailTab, setDetailTab] = useState("analysis");
  const [detailStage, setDetailStage] = useState("");
  const [needToken, setNeedToken] = useState(false); // show token entry before analysis
  const [tokenErr, setTokenErr] = useState("");
  const [page, setPage] = useState("home");

  const dayKey = (d) => d.toISOString().slice(0, 10);

  // hydrate everything from Supabase on mount (all private to this user)
  useEffect(() => {
    if (!userId) return;
    (async () => {
      const [fx, pr, rs] = await Promise.all([
        loadFixturesMap(userId),
        loadPredictionsMap(userId),
        loadResultsMap(userId),
      ]);
      setFixtures(fx); setPredictions(pr); setResults(rs);
      setHydrated(true);
    })();
  }, [userId]);

  useEffect(() => {
    if (!hydrated) return;
    const key = dayKey(activeDay);
    if (fixtures[key]) return;
    loadFixtures(activeDay);
    // eslint-disable-next-line
  }, [activeDay, hydrated]);

  async function loadFixtures(day, force = false) {
    const key = dayKey(day);
    if (fixtures[key] && !force) return;
    setLoadingDay(true);
    setDayError("");
    const human = day.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
    const prompt = `List the FIFA World Cup 2026 football matches scheduled for ${human}. Use web search to get the actual fixtures and kickoff times for that date. If there are no World Cup matches that day, list the most notable scheduled fixtures from major competitions that day instead.

Respond with ONLY a valid JSON array — just the fixtures, NO predictions, no markdown, no backticks:
[
  {"competition":"World Cup","home":"<home>","away":"<away>","kickoff":"<24h local time e.g. 18:00>"}
]
Return up to 10 matches, ordered by kickoff. Use 24-hour HH:MM for kickoff. If you cannot find any fixtures for that date, return [].`;
    try {
      const arr = await callOpus(prompt, 700);
      const clean = Array.isArray(arr) ? arr : [];
      setFixtures((f) => ({ ...f, [key]: clean }));
      saveFixture(userId, key, clean);
    } catch (e) {
      console.error(e);
      setDayError("Couldn't load fixtures for this day. Tap retry.");
      setFixtures((f) => ({ ...f, [key]: [] }));
    } finally {
      setLoadingDay(false);
    }
  }

  function openMatch(m) {
    const key = dayKey(activeDay);
    const id = matchId(key, m);

    // Already have your private prediction? Show it (free, no token needed).
    if (predictions[id]) {
      setSelected(m); setSelectedId(id); setDetailTab("analysis");
      setDetail(predictions[id]); setDetailLoading(false);
      setNeedToken(false); setTokenErr("");
      return;
    }

    // Otherwise: show the token-entry screen before any analysis runs.
    setSelected(m); setSelectedId(id); setDetailTab("analysis");
    setDetail(null); setDetailLoading(false);
    setTokenErr("");
    setNeedToken(true);
  }

  async function runAnalysis(enteredToken) {
    const m = selected;
    const id = selectedId;
    if (!m || !id) return;
    if (!enteredToken || !enteredToken.trim()) { setTokenErr("Enter the access token for this match."); return; }

    setNeedToken(false);
    setDetail(null); setDetailLoading(true);
    const stages = ["Searching recent form & results…", "Checking injuries & lineups…", "Pulling tactical context…", "Opus 4.8 reasoning through the match…"];
    let i = 0; setDetailStage(stages[0]);
    const t = setInterval(() => { i = (i + 1) % stages.length; setDetailStage(stages[i]); }, 2500);

    const prompt = `You are an elite football analyst. Deeply analyze this upcoming match and produce a full prediction.

MATCH: ${m.home} (home) vs ${m.away} (away)
COMPETITION: ${m.competition}${m.kickoff ? ` · kickoff ${m.kickoff}` : ""}

Use up to 3 focused web searches (prioritise: recent form/results, injuries & likely lineups, then head-to-head or stakes) before deciding — be efficient, don't search more than needed. Then respond with ONLY valid JSON, no markdown, no backticks:
{"homeScore":<int>,"awayScore":<int>,"confidence":<int 0-100>,"topPick":"<short market pick>","topPickOdds":"<implied odds>","topPickProb":<int percent>,"matchTitle":"<e.g. 'Argentina vs Austria — World Cup Group Stage'>","keyInsights":["<4-5 short bullets ~10 words each>"],"analysis":[{"heading":"<heading>","body":"<2-4 sentences>"}],"caseAgainst":"<strongest counter-argument, 3-5 sentences>","picks":[{"market":"<market>","selection":"<pick>","prob":<int>}]}
Provide 4-6 analysis sections and 4-6 picks across different markets. Be specific and grounded in what you found.`;
    try {
      const d = await callOpus(prompt, 1500, id, enteredToken.trim());
      setDetail(d);
      setPredictions((p) => ({ ...p, [id]: d }));
      savePrediction(userId, id, d);
    } catch (e) {
      console.error(e);
      // token errors come back as the thrown message; show them on the token screen
      const msg = String(e?.message || e);
      if (/token|access/i.test(msg)) {
        setDetailLoading(false);
        setNeedToken(true);
        setTokenErr(msg);
        clearInterval(t);
        return;
      }
      setDetail({ error: true });
    } finally {
      clearInterval(t); setDetailLoading(false);
    }
  }

  function logResult(id, actual) {
    setResults((r) => ({ ...r, [id]: actual }));
    if (userId) saveResult(userId, id, actual);
  }
  async function clearMyResults() {
    if (!userId) return;
    await supabase.from("results").delete().eq("user_id", userId);
    setResults({});
  }
  async function signOut() {
    await supabase.auth.signOut();
  }

  const list = fixtures[dayKey(activeDay)] || [];
  const wcCount = list.filter((m) => /world cup/i.test(m.competition)).length;

  function gradeOf(id) {
    const pred = predictions[id]; const actual = results[id];
    if (!pred || pred.error || !actual) return null;
    const [ah, aa] = actual.split("-").map((n) => parseInt(n.trim(), 10));
    if (isNaN(ah) || isNaN(aa)) return null;
    const po = pred.homeScore > pred.awayScore ? "H" : pred.homeScore < pred.awayScore ? "A" : "D";
    const ao = ah > aa ? "H" : ah < aa ? "A" : "D";
    return { outcome: po === ao, exact: ah === pred.homeScore && aa === pred.awayScore };
  }

  return (
    <div style={{ fontFamily: "'Inter',-apple-system,system-ui,sans-serif", background: BG, color: TEXT, minHeight: "100vh", maxWidth: 460, margin: "0 auto", paddingBottom: 90, position: "relative" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
        *{box-sizing:border-box} ::-webkit-scrollbar{width:0}
        body{margin:0;background:${BG}}
        input,textarea{font-family:inherit}
        @keyframes pulse{0%,100%{opacity:.45}50%{opacity:1}}
        @keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
        @keyframes shimmer{0%{background-position:-400px 0}100%{background-position:400px 0}}
        .fade{animation:fadeIn .4s ease both}
        .skel{background:linear-gradient(90deg,#0E1626 25%,#16233d 50%,#0E1626 75%);background-size:800px 100%;animation:shimmer 1.4s infinite}
      `}</style>

      <div style={{ padding: "18px 16px 6px", display: "flex", alignItems: "center", gap: 9 }}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={ACCENT} strokeWidth="1.8"><path d="M12 3a9 9 0 1 0 9 9"/><path d="M12 7v5l3 2"/></svg>
        <div style={{ fontWeight: 800, fontSize: 18, letterSpacing: -0.4 }}>Predictor<span style={{ color: ACCENT }}>Pro</span></div>
        <button onClick={signOut} title="Sign out" style={{ marginLeft: "auto", background: CARD, border: `1px solid ${BORDER}`, color: MUTED, borderRadius: 9, padding: "6px 12px", fontWeight: 600, fontSize: 12.5, cursor: "pointer" }}>Sign out</button>
      </div>

      {page === "home" && (<>
        <div style={{ display: "flex", gap: 9, padding: "8px 14px 0", overflowX: "auto" }}>
          {days.map((d) => {
            const on = dayKey(d) === dayKey(activeDay);
            return (
              <button key={dayKey(d)} onClick={() => setActiveDay(d)}
                style={{ flex: "1 0 0", minWidth: 78, background: on ? ACCENT : CARD, color: on ? "#04140E" : TEXT, border: `1px solid ${on ? ACCENT : BORDER}`, borderRadius: 14, padding: "12px 4px", cursor: "pointer", textAlign: "center" }}>
                <div style={{ fontWeight: 800, fontSize: 14, letterSpacing: 0.4 }}>{d.toLocaleDateString(undefined, { weekday: "short" }).toUpperCase()}</div>
                <div style={{ fontSize: 11, fontWeight: 600, opacity: on ? 0.8 : 0.6, marginTop: 2 }}>{d.toLocaleDateString(undefined, { day: "numeric", month: "short" }).toUpperCase()}</div>
              </button>
            );
          })}
        </div>

        <div style={{ display: "flex", gap: 9, padding: "12px 14px 4px", alignItems: "center" }}>
          <div style={{ display: "flex", flex: 1, background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 4 }}>
            {[["all", "🧠 ALL"], ["score", "# SCORE"]].map(([k, label]) => (
              <button key={k} onClick={() => setFilter(k)} style={{ flex: 1, border: "none", borderRadius: 9, padding: "9px 0", fontWeight: 800, fontSize: 12.5, letterSpacing: 0.5, cursor: "pointer", background: filter === k ? ACCENT : "transparent", color: filter === k ? "#04140E" : MUTED }}>{label}</button>
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 7, border: `1px solid ${ACCENT_DIM}`, color: ACCENT, borderRadius: 12, padding: "9px 13px", fontWeight: 800, fontSize: 12.5, letterSpacing: 0.5 }}>
            {target(15)} OPUS 4.8
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "18px 16px 10px" }}>
          <span style={{ fontSize: 16 }}>📌</span><span style={{ fontSize: 16 }}>🏆</span>
          <div style={{ fontWeight: 800, fontSize: 16, letterSpacing: 1.2 }}>
            {wcCount ? "WORLD CUP" : "FIXTURES"} <span style={{ color: MUTED, fontWeight: 600 }}>({list.length})</span>
          </div>
          <div style={{ flex: 1, height: 1, background: BORDER, marginLeft: 4 }} />
          {fixtures[dayKey(activeDay)] && !loadingDay && (
            <button onClick={() => loadFixtures(activeDay, true)} title="Refresh this day" style={{ background: "none", border: "none", cursor: "pointer", color: MUTED, fontSize: 13 }}>↻</button>
          )}
        </div>

        <div style={{ padding: "0 14px" }}>
          {loadingDay && [0, 1, 2].map((i) => (<div key={i} className="skel" style={{ height: 118, borderRadius: 18, marginBottom: 13 }} />))}

          {!loadingDay && dayError && (
            <div style={{ textAlign: "center", color: MUTED, padding: "40px 20px", fontSize: 14 }}>
              {dayError}<div><button onClick={() => loadFixtures(activeDay, true)} style={retryBtn}>Retry</button></div>
            </div>
          )}

          {!loadingDay && !dayError && list.length === 0 && (
            <div style={{ textAlign: "center", color: MUTED, padding: "50px 20px", fontSize: 14 }}>No fixtures found for this day. Try another date.</div>
          )}

          {!loadingDay && list.map((m, i) => {
            const id = matchId(dayKey(activeDay), m);
            const g = gradeOf(id);
            const started = hasStarted(activeDay, m.kickoff);
            const analyzed = !!predictions[id];
            return (
              <div key={i} className="fade" onClick={() => openMatch(m)}
                style={{ background: CARD, border: `1px solid ${analyzed ? ACCENT_DIM : BORDER}`, borderRadius: 18, marginBottom: 13, cursor: "pointer", overflow: "hidden" }}>
                <div style={{ display: "flex", alignItems: "center", padding: "16px 16px 14px" }}>
                  <div style={{ flex: 1.4 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 9 }}>
                      <Jersey name={m.home} /><span style={{ fontWeight: 700, fontSize: 16 }}>{m.home}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
                      <Jersey name={m.away} /><span style={{ fontWeight: 700, fontSize: 16 }}>{m.away}</span>
                    </div>
                  </div>
                  <div style={{ flex: 0.7, textAlign: "center", color: analyzed ? ACCENT : MUTED, fontWeight: 900, fontSize: 26, letterSpacing: -1 }}>
                    {analyzed && !predictions[id].error ? `${predictions[id].homeScore}-${predictions[id].awayScore}` : "–"}
                  </div>
                  {filter === "all" && (
                    <div style={{ flex: 1, textAlign: "right", borderLeft: `1px solid ${BORDER}`, paddingLeft: 12 }}>
                      {analyzed && !predictions[id].error ? (<>
                        <div style={{ color: ACCENT, fontWeight: 800, fontSize: 15, lineHeight: 1.2 }}>{predictions[id].topPick}</div>
                        <div style={{ color: MUTED, fontSize: 12.5, marginTop: 4 }}>{predictions[id].topPickOdds || "—"} / {predictions[id].topPickProb || "—"}%</div>
                      </>) : (
                        <div style={{ color: MUTED, fontWeight: 700, fontSize: 13, lineHeight: 1.3 }}>token required</div>
                      )}
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "11px 16px", borderTop: `1px solid ${BORDER}`, background: "rgba(255,255,255,.015)" }}>
                  {started
                    ? <span style={{ background: "rgba(130,148,174,.16)", color: MUTED, fontWeight: 700, fontSize: 11, letterSpacing: 0.8, padding: "4px 10px", borderRadius: 7 }}>IN PLAY / DONE</span>
                    : <span style={{ background: "rgba(31,227,168,.13)", color: ACCENT, fontWeight: 700, fontSize: 11, letterSpacing: 0.8, padding: "4px 10px", borderRadius: 7 }}>UPCOMING</span>}
                  <span style={{ color: MUTED, fontSize: 13.5 }}>{activeDay.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} · {m.kickoff || "TBD"}</span>
                  {analyzed && <span style={{ color: ACCENT, fontSize: 11.5, fontWeight: 700 }}>● analyzed</span>}
                  {g && <span style={{ color: g.outcome ? ACCENT : "#FF6B6B", fontSize: 11.5, fontWeight: 700 }}>{g.exact ? "exact ✓" : g.outcome ? "hit ✓" : "miss ✗"}</span>}
                  <span style={{ marginLeft: "auto", color: MUTED, fontSize: 13 }}>{analyzed ? "view ›" : "tap ›"}</span>
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ padding: "18px 18px 0", color: MUTED, fontSize: 11.5, lineHeight: 1.6 }}>
          Your predictions are private to your account and generated on demand by Claude Opus 4.8 for today's and tomorrow's fixtures. For information and entertainment only — not betting advice.
        </div>
      </>)}

      {page === "stats" && (
        <StatsPage predictions={predictions} results={results} fixtures={fixtures} gradeOf={gradeOf} logResult={logResult} clearAll={clearMyResults} />
      )}

      <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, maxWidth: 460, margin: "0 auto", background: "rgba(7,11,20,.92)", borderTop: `1px solid ${BORDER}`, backdropFilter: "blur(8px)", display: "flex", justifyContent: "space-around", padding: "12px 0 16px" }}>
        {[
          { id: "home", label: "FIXTURES", ic: (c) => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2"><path d="M3 10l9-7 9 7v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg> },
          { id: "stats", label: "STATS", ic: (c) => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2"><path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/></svg> },
        ].map((nav) => {
          const on = page === nav.id;
          return (
            <div key={nav.id} onClick={() => setPage(nav.id)} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3, cursor: "pointer" }}>
              <div style={{ width: 46, height: 38, borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center", background: on ? "rgba(31,227,168,.12)" : "transparent" }}>{nav.ic(on ? ACCENT : MUTED)}</div>
              <span style={{ fontSize: 10.5, fontWeight: 700, color: on ? ACCENT : MUTED, letterSpacing: 0.4 }}>{nav.label}</span>
            </div>
          );
        })}
      </div>

      {selected && (
        <Detail match={selected} detail={detail} loading={detailLoading} stage={detailStage}
          tab={detailTab} setTab={setDetailTab} dayLabel={activeDay.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
          result={results[selectedId]} grade={gradeOf(selectedId)} onLog={(v) => logResult(selectedId, v)}
          needToken={needToken} tokenErr={tokenErr} onSubmitToken={(tok) => runAnalysis(tok)}
          onClose={() => { setSelected(null); setSelectedId(null); setDetail(null); setNeedToken(false); setTokenErr(""); }}
          onRetry={() => { setNeedToken(true); setTokenErr(""); setDetail(null); }} />
      )}
    </div>
  );
}

function StatsPage({ predictions, results, fixtures, gradeOf, logResult, clearAll }) {
  const rows = [];
  Object.entries(fixtures || {}).forEach(([dk, list]) => {
    (list || []).forEach((m) => {
      const id = `${dk}__${m.home}__${m.away}`.replace(/\s+/g, "_");
      if (predictions[id]) rows.push({ id, dk, m });
    });
  });
  rows.sort((a, b) => (a.dk < b.dk ? 1 : -1));
  const graded = rows.map((r) => ({ ...r, g: gradeOf(r.id) })).filter((r) => r.g);
  const outcomeHits = graded.filter((r) => r.g.outcome).length;
  const exactHits = graded.filter((r) => r.g.exact).length;

  return (
    <div className="fade" style={{ padding: "8px 14px 0" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9, margin: "8px 4px 16px" }}>
        <div style={{ fontWeight: 800, fontSize: 16, letterSpacing: 1.2 }}>YOUR ACCURACY</div>
        <div style={{ flex: 1, height: 1, background: BORDER }} />
      </div>
      <div style={{ display: "flex", gap: 10, marginBottom: 18 }}>
        <Stat label="Outcome accuracy" big={graded.length ? `${Math.round((outcomeHits / graded.length) * 100)}%` : "—"} sub={`${outcomeHits} of ${graded.length} graded`} />
        <Stat label="Exact scorelines" big={graded.length ? `${Math.round((exactHits / graded.length) * 100)}%` : "—"} sub={`${exactHits} of ${graded.length}`} />
      </div>
      <div style={{ display: "flex", gap: 10, marginBottom: 18 }}>
        <Stat label="Predictions made" big={rows.length} sub="cached & analyzed" />
        <Stat label="Awaiting result" big={rows.length - graded.length} sub="log scores below" />
      </div>
      {rows.length === 0 && (
        <div style={{ textAlign: "center", color: MUTED, padding: "50px 20px", fontSize: 14 }}>
          No analyzed matches yet. Open a fixture and let Opus 4.8 run a full prediction — it'll appear here so you can log the real result later.
        </div>
      )}
      {rows.map(({ id, dk, m }) => {
        const g = gradeOf(id); const pred = predictions[id];
        return (
          <div key={id} style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 16, padding: 15, marginBottom: 11 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontWeight: 700, fontSize: 14.5 }}>{m.home} <span style={{ color: ACCENT }}>{pred.homeScore}-{pred.awayScore}</span> {m.away}</div>
              <div style={{ fontSize: 11, color: MUTED }}>{dk}</div>
            </div>
            <div style={{ color: MUTED, fontSize: 12, marginTop: 3 }}>{m.competition} · pick: {pred.topPick}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 11 }}>
              <input placeholder="actual e.g. 1-1" defaultValue={results[id] || ""}
                onBlur={(e) => e.target.value.trim() && logResult(id, e.target.value.trim())}
                style={{ ...inputStyle, margin: 0, padding: "8px 11px", fontSize: 13, width: 120 }} />
              {g && (
                <span style={{ fontSize: 12, fontWeight: 700, padding: "5px 10px", borderRadius: 8, background: g.outcome ? "rgba(31,227,168,.15)" : "rgba(255,107,107,.15)", color: g.outcome ? ACCENT : "#FF6B6B" }}>
                  {g.exact ? "Exact ✓" : g.outcome ? "Outcome ✓" : "Miss ✗"}
                </span>
              )}
            </div>
          </div>
        );
      })}
      {rows.length > 0 && (
        <button onClick={() => { if (window.confirm("Clear your logged results? (Shared fixtures and predictions stay.)")) clearAll(); }}
          style={{ width: "100%", marginTop: 8, background: "transparent", border: `1px solid ${BORDER}`, color: "#FF6B6B", borderRadius: 12, padding: "12px 0", fontWeight: 700, fontSize: 13.5, cursor: "pointer" }}>
          Reset all data
        </button>
      )}
      <div style={{ padding: "16px 4px 0", color: MUTED, fontSize: 11.5, lineHeight: 1.6 }}>
        Accuracy reflects only matches you've logged a real score for. For information and entertainment only — not betting advice.
      </div>
    </div>
  );
}

function Stat({ label, big, sub }) {
  return (
    <div style={{ flex: 1, background: CARD, border: `1px solid ${BORDER}`, borderRadius: 16, padding: "16px 14px" }}>
      <div style={{ fontSize: 30, fontWeight: 900, color: ACCENT }}>{big}</div>
      <div style={{ fontSize: 11.5, color: MUTED, marginTop: 2 }}>{sub}</div>
      <div style={{ fontSize: 12.5, fontWeight: 600, marginTop: 6 }}>{label}</div>
    </div>
  );
}

function Detail({ match, detail, loading, stage, tab, setTab, dayLabel, result, grade, onLog, needToken, tokenErr, onSubmitToken, onClose, onRetry }) {
  const [tok, setTok] = React.useState("");
  return (
    <div className="fade" style={{ position: "fixed", inset: 0, maxWidth: 460, margin: "0 auto", background: BG, zIndex: 50, overflowY: "auto", paddingBottom: 40 }}>
      <div style={{ position: "sticky", top: 0, background: CARD, borderBottom: `1px solid ${BORDER}`, borderRadius: "0 0 22px 22px", padding: "16px 16px 20px", zIndex: 2 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", position: "relative", marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, color: ACCENT, fontWeight: 700, fontSize: 13 }}>{target(15)} Claude Opus 4.8</div>
          <button onClick={onClose} style={{ position: "absolute", right: 0, top: -2, width: 34, height: 34, borderRadius: 99, border: "none", background: CARD_HI, color: TEXT, fontSize: 18, cursor: "pointer" }}>×</button>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ textAlign: "center", width: 92 }}>
            <Jersey name={match.home} size={52} /><div style={{ fontWeight: 700, fontSize: 13.5, marginTop: 6 }}>{match.home}</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 44, fontWeight: 900, letterSpacing: -1, lineHeight: 1 }}>
              {detail && !detail.error
                ? <>{detail.homeScore} <span style={{ color: ACCENT }}>-</span> {detail.awayScore}</>
                : <span style={{ color: MUTED }}>– <span style={{ color: ACCENT }}>-</span> –</span>}
            </div>
            <div style={{ color: ACCENT, fontWeight: 700, fontSize: 11, letterSpacing: 1.4, marginTop: 6 }}>PREDICTED SCORE</div>
          </div>
          <div style={{ textAlign: "center", width: 92 }}>
            <Jersey name={match.away} size={52} /><div style={{ fontWeight: 700, fontSize: 13.5, marginTop: 6 }}>{match.away}</div>
          </div>
        </div>
      </div>

      {needToken && (
        <div className="fade" style={{ padding: "40px 24px", textAlign: "center" }}>
          <div style={{ fontSize: 30, marginBottom: 12 }}>🎟️</div>
          <div style={{ fontWeight: 700, fontSize: 17, color: TEXT }}>Enter access token</div>
          <div style={{ marginTop: 10, fontSize: 13.5, color: MUTED, lineHeight: 1.6, maxWidth: 300, marginInline: "auto" }}>
            This match needs a one-time token to run the Opus 4.8 analysis. Enter the token you were given for {match.home} vs {match.away}.
          </div>
          <input
            value={tok} onChange={(e) => setTok(e.target.value)} placeholder="token for this match"
            onKeyDown={(e) => { if (e.key === "Enter") onSubmitToken(tok); }}
            style={{ width: "100%", maxWidth: 280, marginTop: 18, background: "#0A1120", border: `1px solid ${BORDER}`, borderRadius: 12, padding: "13px 14px", color: TEXT, fontSize: 15, outline: "none", textAlign: "center" }} />
          {tokenErr && <div style={{ color: "#FF6B6B", fontSize: 13, marginTop: 12 }}>{tokenErr}</div>}
          <div>
            <button onClick={() => onSubmitToken(tok)} style={{ ...retryBtn, marginTop: 16 }}>Unlock & analyze</button>
          </div>
          <div style={{ marginTop: 14, color: MUTED, fontSize: 11.5 }}>The token is used once and works only for this match.</div>
        </div>
      )}

      {loading && (
        <div style={{ padding: "60px 28px", textAlign: "center" }}>
          <div style={{ display: "inline-block", animation: "pulse 1.4s infinite" }}>{target(28)}</div>
          <div style={{ marginTop: 16, color: ACCENT, fontSize: 14, animation: "pulse 1.8s infinite" }}>{stage}</div>
          <div style={{ marginTop: 8, color: MUTED, fontSize: 12 }}>Opus 4.8 is searching the web and reasoning — this takes a moment.</div>
        </div>
      )}

      {!loading && detail && detail.error && (
        <div style={{ padding: "50px 28px", textAlign: "center", color: MUTED }}>
          The model returned an unexpected format.<div><button onClick={onRetry} style={retryBtn}>Retry</button></div>
        </div>
      )}

      {!loading && detail && !detail.error && (
        <div className="fade">
          <div style={{ display: "flex", gap: 11, margin: "14px 14px 0" }}>
            <div style={{ flex: 1, background: CARD, border: `1px solid ${BORDER}`, borderRadius: 16, padding: 15 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7, color: MUTED, fontSize: 11.5, fontWeight: 700, letterSpacing: 0.8 }}>{target(15)} CONFIDENCE</div>
              <div style={{ fontSize: 30, fontWeight: 900, marginTop: 6 }}>{detail.confidence}%</div>
              <Bar value={detail.confidence} />
            </div>
            <div style={{ flex: 1.25, background: ACCENT, borderRadius: 16, padding: 15, color: "#04140E" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11.5, fontWeight: 800, letterSpacing: 0.8 }}>{target(15, "#04140E")} TOP PICK</div>
              <div style={{ fontSize: 17, fontWeight: 800, marginTop: 8, lineHeight: 1.15 }}>{detail.topPick}</div>
              {(detail.topPickOdds || detail.topPickProb) && (
                <div style={{ display: "inline-block", marginTop: 9, background: "rgba(0,0,0,.18)", borderRadius: 8, padding: "4px 9px", fontSize: 12.5, fontWeight: 700 }}>{detail.topPickOdds || "—"} / {detail.topPickProb || "—"}%</div>
              )}
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "16px 18px 4px", color: MUTED, fontSize: 13 }}>
            <span>📅 {dayLabel} · {match.kickoff || "TBD"}</span>
            <span style={{ background: "rgba(31,227,168,.13)", color: ACCENT, fontWeight: 700, fontSize: 11, letterSpacing: 0.6, padding: "4px 9px", borderRadius: 7 }}>{match.competition}</span>
          </div>

          <div style={{ display: "flex", gap: 9, margin: "10px 14px 0", background: CARD, padding: 6, borderRadius: 14, border: `1px solid ${BORDER}` }}>
            {["analysis", "picks"].map((t) => (
              <button key={t} onClick={() => setTab(t)} style={{ flex: 1, border: "none", borderRadius: 10, padding: "11px 0", fontWeight: 700, fontSize: 14, cursor: "pointer", background: tab === t ? ACCENT : "transparent", color: tab === t ? "#04140E" : MUTED, textTransform: "capitalize" }}>
                {t === "analysis" ? "🧠 Analysis" : "🎯 Picks"}
              </button>
            ))}
          </div>

          {tab === "analysis" && (
            <div className="fade">
              <div style={st}>{target()} Key Insights</div>
              <div style={{ margin: "0 14px", background: CARD, border: `1px solid ${BORDER}`, borderRadius: 16, padding: "14px 16px" }}>
                {(detail.keyInsights || []).map((k, i) => (<div key={i} style={{ display: "flex", gap: 9, padding: "5px 0", fontSize: 14.5, lineHeight: 1.4 }}><span style={{ color: ACCENT, fontWeight: 900 }}>·</span>{k}</div>))}
              </div>
              <div style={st}>🧠 Analysis</div>
              <div style={{ margin: "0 14px", background: CARD, border: `1px solid ${BORDER}`, borderRadius: 16, padding: "16px 18px" }}>
                <div style={{ fontSize: 19, fontWeight: 800, marginBottom: 12, letterSpacing: -0.3, lineHeight: 1.25 }}>{detail.matchTitle}</div>
                {(detail.analysis || []).map((sec, i) => (
                  <div key={i} style={{ marginTop: i === 0 ? 0 : 18 }}>
                    <div style={{ fontWeight: 700, fontSize: 15.5, marginBottom: 7 }}>{sec.heading}</div>
                    <div style={{ color: "#B9C6DA", fontSize: 14.5, lineHeight: 1.6 }}>{sec.body}</div>
                  </div>
                ))}
                {detail.caseAgainst && (
                  <div style={{ marginTop: 18, borderLeft: `3px solid ${ACCENT}`, background: "rgba(31,227,168,.06)", borderRadius: "0 12px 12px 0", padding: "12px 14px" }}>
                    <div style={{ fontWeight: 700, fontSize: 14.5, marginBottom: 6 }}>The case against this prediction</div>
                    <div style={{ color: "#B9C6DA", fontSize: 14, lineHeight: 1.6 }}>{detail.caseAgainst}</div>
                  </div>
                )}
              </div>
            </div>
          )}

          {tab === "picks" && (
            <div className="fade" style={{ margin: "16px 14px 0" }}>
              {(detail.picks || []).map((p, i) => (
                <div key={i} style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 14, padding: "14px 16px", marginBottom: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ color: MUTED, fontSize: 11.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.6 }}>{p.market}</div>
                    <div style={{ fontSize: 15.5, fontWeight: 700, marginTop: 3 }}>{p.selection}</div>
                  </div>
                  <div style={{ textAlign: "right", minWidth: 90 }}>
                    <div style={{ fontSize: 22, fontWeight: 900, color: ACCENT }}>{p.prob}%</div>
                    <Bar value={p.prob} />
                  </div>
                </div>
              ))}
            </div>
          )}

          <div style={{ margin: "20px 14px 0", background: CARD_HI, border: `1px solid ${BORDER}`, borderRadius: 14, padding: 15 }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 9 }}>After the match — log the real score to track accuracy</div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input placeholder="e.g. 1-1" defaultValue={result || ""} onBlur={(e) => e.target.value.trim() && onLog(e.target.value.trim())}
                style={{ ...inputStyle, margin: 0, padding: "9px 12px", width: 110 }} />
              {grade && (
                <span style={{ fontSize: 13, fontWeight: 700, padding: "6px 11px", borderRadius: 8, background: grade.outcome ? "rgba(31,227,168,.15)" : "rgba(255,107,107,.15)", color: grade.outcome ? ACCENT : "#FF6B6B" }}>
                  {grade.exact ? "Exact score ✓" : grade.outcome ? "Right outcome ✓" : "Miss ✗"}
                </span>
              )}
            </div>
          </div>

          <div style={{ margin: "20px 18px 0", color: MUTED, fontSize: 11.5, lineHeight: 1.6 }}>For information and entertainment only — not betting advice.</div>
        </div>
      )}
    </div>
  );
}

const st = { display: "flex", alignItems: "center", gap: 9, fontSize: 17, fontWeight: 700, margin: "26px 18px 12px", letterSpacing: -0.2 };
const retryBtn = { marginTop: 14, background: ACCENT, color: "#04140E", border: "none", borderRadius: 10, padding: "10px 20px", fontWeight: 800, fontSize: 13, cursor: "pointer" };
const inputStyle = { width: "100%", background: "#0A1120", border: `1px solid ${BORDER}`, borderRadius: 12, padding: "12px 14px", color: TEXT, fontSize: 15, outline: "none" };
