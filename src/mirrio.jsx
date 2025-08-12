// src/mirrio.jsx — with Vercel Analytics (Vite + React) — FIXED
import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabaseClient";
import { Analytics } from "@vercel/analytics/react"; // Vite/React import

const DB_KEY = "mirror.db.v1";
const now = () => Date.now();
const DAY = 24 * 60 * 60 * 1000;
const WEEK = 7 * DAY;

function uid(prefix = "id") {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}
function loadDB() {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (!raw) return createEmptyDB();
    const data = JSON.parse(raw);
    return { ...createEmptyDB(), ...data, users: data.users || {}, sessions: data.sessions || {}, groups: data.groups || {}, statements: Array.isArray(data.statements) ? data.statements : defaultStatements(), notifications: data.notifications || {} };
  } catch { return createEmptyDB(); }
}
function saveDB(db) { localStorage.setItem(DB_KEY, JSON.stringify(db)); }
function createEmptyDB() {
  return { users: {}, sessions: {}, groups: {}, statements: defaultStatements(), notifications: {} };
}
function defaultStatements() {
  return [
    "Would most likely befriend a stranger in an elevator.",
    "Has the most chaotic desktop (real or computer).",
    "Would survive longest without a smartphone.",
    "Is most likely to forget their own birthday (once).",
    "Has the strongest poker face.",
    "Would join a reality show just for the memes.",
    "Brings snacks to every gathering.",
    "Secretly judges everyone’s playlist (but with love).",
    "Would start dancing first at a silent disco.",
    "Will adopt the next stray cat they see.",
  ].map((text) => ({ id: uid("stmt"), text }));
}
function dbAddNotification(db, email, note) {
  db.notifications[email] = db.notifications[email] || [];
  db.notifications[email].unshift({ id: uid("notif"), ts: now(), ...note });
}
function humanTime(ms) {
  if (ms <= 0) return "00:00";
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
function useTicker(interval = 1000) {
  const [, setT] = useState(0);
  useEffect(() => { const id = setInterval(() => setT((t) => t + 1), interval); return () => clearInterval(id); }, [interval]);
}

export default function Mirrio() {
  const [db, setDb] = useState(loadDB());
  const [email, setEmail] = useState(null);
  const [view, setView] = useState(() => (new URL(location.href)).searchParams.get("admin") ? "admin" : "login");
  const [activeGroupId, setActiveGroupId] = useState(null);
  const [adminOpen, setAdminOpen] = useState(false);

  // init session & listen for changes
  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data } = await supabase.auth.getSession();
      const em = data?.session?.user?.email || null;
      if (mounted) { setEmail(em); setView((v)=> (em ? (v==="login" ? "groups" : v) : "login")); }
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => {
      const em = session?.user?.email || null;
      setEmail(em);
      setView((v)=> (em ? (v==="login" ? "groups" : v) : "login"));
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => saveDB(db), [db]);
  useTicker(1000);

  // Auto-join via invite link (local demo logic)
  useEffect(() => {
    const url = new URL(window.location.href);
    const invite = url.searchParams.get("invite");
    if (invite && email) {
      setDb((prev) => {
        const copy = { ...prev, groups: { ...prev.groups } };
        const g = copy.groups[invite];
        if (g && !g.members.includes(email)) {
          g.members.push(email);
          dbAddNotification(copy, email, { text: `You joined group “${g.name}”.`, groupId: g.id });
        }
        return copy;
      });
      url.searchParams.delete("invite");
      history.replaceState({}, "", url.toString());
      setActiveGroupId(invite);
      setView("group");
    }
  }, [email]);

  const me = email ? db.users[email] : null;

  return (
    <div className="min-h-dvh bg-white text-black">
      <Header email={email} me={me} onSignOut={() => { supabase.auth.signOut(); setView("login"); }} onGo={(v)=>setView(v)} setAdminOpen={setAdminOpen} />
      <main className="mx-auto w-full max-w-md p-3 pb-24">
        {view === "login" && <AuthView />}
        {/* Add the rest of your views here (profile, groups, group, admin) */}
      </main>

      {import.meta.env.PROD && <Analytics />}
    </div>
  );
}

function Header({ email, me, onSignOut, onGo, setAdminOpen }) {
  return (
    <header className="sticky top-0 z-10 bg-white border-b-4 border-black">
      <div className="mx-auto max-w-md flex items-center justify-between p-3">
        <div className="font-black text-xl tracking-tight">MIRRIO</div>
        <div className="flex items-center gap-2">
          {email && (<button className="px-2 py-1 border-2 border-black active:translate-y-0.5" onClick={()=>onGo("groups")}>Groups</button>)}
          <button className="px-2 py-1 border-2 border-black active:translate-y-0.5" onClick={()=>setAdminOpen(true)}>☰</button>
        </div>
      </div>
      {email && (
        <div className="mx-auto max-w-md px-3 pb-2 flex items-center gap-3">
          <div className="text-xs"><div className="font-bold leading-tight">{email}</div><div className="opacity-70">Signed in</div></div>
          <div className="flex-1" />
          <button className="px-2 py-1 border-2 border-black" onClick={()=>onGo("profile")}>Profile</button>
          <button className="px-2 py-1 border-2 border-black" onClick={onSignOut}>Sign out</button>
        </div>
      )}
    </header>
  );
}

function AuthView() {
  const [step, setStep] = useState("email");
  const [emailInput, setEmailInput] = useState("");
  const [sentTo, setSentTo] = useState(null);
  const [sending, setSending] = useState(false);

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-black">Sign in</h1>
      {step === "email" && (
        <div className="space-y-2">
          <label className="block text-sm font-bold">E-mail</label>
          <input className="w-full p-3 border-4 border-black" placeholder="you@example.com" value={emailInput} onChange={(e)=>setEmailInput(e.target.value)} />
          <button className="w-full p-3 border-4 border-black font-bold active:translate-y-0.5 disabled:opacity-60"
            disabled={sending}
            onClick={async()=>{
              if (!emailInput.includes("@")) return alert("Enter a valid email");
              setSending(true);
              const { error } = await supabase.auth.signInWithOtp({
                email: emailInput.trim(),
                options: { emailRedirectTo: window.location.origin },
              });
              setSending(false);
              if (error) return alert(error.message);
              setSentTo(emailInput.trim()); setStep("sent");
            }}>
            {sending ? "Sending…" : "Send Magic Link"}
          </button>
          <p className="text-xs opacity-70">We’ve sent a sign-in link to your inbox.</p>
        </div>
      )}
      {step === "sent" && (
        <div className="space-y-3">
          <div className="p-3 border-4 border-black bg-black text-white text-sm">Check <b>{sentTo}</b> and click the link to finish sign-in.</div>
          <button className="block w-full p-3 border-4 border-black text-center font-bold" onClick={()=>setStep("email")}>Use a different e-mail</button>
        </div>
      )}
    </section>
  );
}
