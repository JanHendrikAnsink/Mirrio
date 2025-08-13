// src/mirrio.jsx — Admin CRUD for Editions & Statements + Supabase RPC for statements
import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabaseClient";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/react";

import {
  listEditions, createEdition, renameEdition, changeEditionSlug, toggleEditionActive, deleteEdition,
  listStatements, createStatement, updateStatementText, deleteStatement,
  rpcNextStatementForGroup, markStatementUsed, getUserId
} from "./lib/supaApi";

const DB_KEY = "mirror.db.v1";
const now = () => Date.now();
const DAY = 24 * 60 * 60 * 1000;
const WEEK = 7 * DAY;

function uid(prefix = "id") {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}

function createEmptyDB() {
  return {
    users: {},
    groups: {},
    statements: [],
    notifications: {},
    editions: [],
  };
}
function loadDB() {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (!raw) return createEmptyDB();
    const data = JSON.parse(raw);
    return { ...createEmptyDB(), ...data };
  } catch {
    return createEmptyDB();
  }
}
function saveDB(db) { localStorage.setItem(DB_KEY, JSON.stringify(db)); }

function dbAddNotification(db, email, note) {
  db.notifications[email] = db.notifications[email] || [];
  db.notifications[email].unshift({ id: uid("notif"), ts: now(), ...note });
}

function humanTime(ms) {
  if (ms <= 0) return "00:00";
  const tot = Math.floor(ms / 1000);
  const h = Math.floor(tot / 3600);
  const m = Math.floor((tot % 3600) / 60);
  const s = tot % 60;
  if (h > 0) return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
  return `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
}

function useTicker(interval = 1000) {
  const [, setT] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setT(t => t + 1), interval);
    return () => clearInterval(id);
  }, [interval]);
}

export default function Mirrio() {
  const [db, setDb] = useState(loadDB());
  const [email, setEmail] = useState(null);
  const [view, setView] = useState(() => location.pathname === "/admin" ? "admin" : "login");
  const [activeGroupId, setActiveGroupId] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);

  // SPA route sync
  useEffect(() => {
    const onPop = () => setView(location.pathname === "/admin" ? "admin" : (email ? "groups" : "login"));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [email]);

  // Auth session
  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      const em = data?.session?.user?.email || null;
      setEmail(em);
      if (location.pathname !== "/admin") setView(em ? "groups" : "login");
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => {
      const em = session?.user?.email || null;
      setEmail(em);
      if (location.pathname !== "/admin") setView(em ? "groups" : "login");
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // Hash error
  useEffect(() => {
    if (location.hash && location.hash.includes("error=")) {
      const p = new URLSearchParams(location.hash.slice(1));
      const desc = p.get("error_description");
      alert(`Login-Fehler: ${desc || "Unknown error"}`);
      history.replaceState({}, "", location.pathname + location.search);
    }
  }, []);

  // Persist
  useEffect(() => saveDB(db), [db]);
  useTicker(1000);

  // Load editions on login
  useEffect(() => {
    (async () => {
      if (!email) return;
      try {
        const eds = await listEditions();
        setDb(prev => ({ ...prev, editions: eds }));
      } catch (e) {
        console.error("Loading editions failed:", e);
      }
    })();
  }, [email]);

  const me = email ? db.users[email] : null;

  return (
    <div className="min-h-dvh bg-white text-black">
      <Header
        email={email}
        me={me}
        onSignOut={() => { supabase.auth.signOut(); if (location.pathname !== "/admin") setView("login"); }}
        onGo={(v) => setView(v)}
        setMenuOpen={setMenuOpen}
      />

      <main className="mx-auto w-full max-w-md p-3 pb-24">
        {view === "login" && <AuthView db={db} setDb={setDb} onLoggedIn={() => setView("groups")} />}
        {view === "profile" && email && <ProfileView db={db} setDb={setDb} email={email} />}
        {view === "groups" && email && (
          <GroupsView db={db} setDb={setDb} email={email} setView={setView} setActiveGroupId={setActiveGroupId} />
        )}
        {view === "group" && activeGroupId && email && (
          <GroupDetail db={db} setDb={setDb} groupId={activeGroupId} meEmail={email} />
        )}
        {view === "admin" && <AdminView db={db} setDb={setDb} onExit={() => { history.pushState({}, "", "/"); setView(email ? "groups" : "login"); }} />}
      </main>

      {import.meta.env.PROD && (<><Analytics /><SpeedInsights /></>)}
    </div>
  );
}

function Header({ email, me, onSignOut, onGo, setMenuOpen }) {
  return (
    <header className="sticky top-0 z-10 bg-white border-b-4 border-black">
      <div className="mx-auto max-w-md flex items-center justify-between p-3">
        <div className="font-black text-xl tracking-tight">MIRRIO</div>
        <div className="flex items-center gap-2">
          {email && <button className="px-2 py-1 border-2 border-black" onClick={() => onGo("groups")}>Groups</button>}
          <button className="px-2 py-1 border-2 border-black" onClick={() => setMenuOpen(true)}>☰</button>
        </div>
      </div>
      {email && (
        <div className="mx-auto max-w-md px-3 pb-2 flex items-center gap-3">
          <Avatar img={me?.imageDataURL} label={me ? `${me.firstName} ${me.lastName}` : email} />
          <div className="text-xs">
            <div className="font-bold leading-tight">{me ? `${me.firstName} ${me.lastName}` : email}</div>
            <div className="opacity-70">{email}</div>
          </div>
          <div className="flex-1" />
          <button className="px-2 py-1 border-2 border-black" onClick={() => onGo("profile")}>Profile</button>
          <button className="px-2 py-1 border-2 border-black" onClick={onSignOut}>Sign out</button>
        </div>
      )}
    </header>
  );
}

function Avatar({ img, label, size = 40 }) {
  return (
    <div className="flex items-center gap-2">
      <div className="shrink-0 border-2 border-black bg-white" style={{ width: size, height: size }}>
        {img ? <img src={img} alt="avatar" className="w-full h-full object-cover" /> : <div className="w-full h-full grid place-items-center text-xs">🙂</div>}
      </div>
      {label && <span className="text-sm font-bold line-clamp-1">{label}</span>}
    </div>
  );
}

function AuthView({ db, setDb }) {
  const [step, setStep] = useState("email");
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState(null);
  const [sending, setSending] = useState(false);
  const redirectBase = import.meta.env.DEV ? "http://localhost:5173" : "https://mirrio.app";

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-black">Sign in</h1>
      {step === "email" && (
        <div className="space-y-2">
          <label className="block text-sm font-bold">E-mail</label>
          <input className="w-full p-3 border-4 border-black" placeholder="you@example.com" value={email} onChange={(e)=>setEmail(e.target.value)} />
          <button
            className="w-full p-3 border-4 border-black font-bold disabled:opacity-60"
            disabled={sending}
            onClick={async () => {
              if (!email.includes("@")) return alert("Enter a valid email");
              setDb(prev => {
                const copy = { ...prev, users: { ...prev.users } };
                copy.users[email] = copy.users[email] || { email, firstName: "", lastName: "", imageDataURL: "" };
                return copy;
              });
              setSending(true);
              const { error } = await supabase.auth.signInWithOtp({
                email: email.trim(),
                options: { emailRedirectTo: redirectBase },
              });
              setSending(false);
              if (error) return alert(error.message);
              setSentTo(email.trim());
              setStep("sent");
            }}
          >
            {sending ? "Sending…" : "Send Magic Link"}
          </button>
          <p className="text-xs opacity-70">We’ll e-mail you a secure sign-in link.</p>
        </div>
      )}
      {step === "sent" && (
        <div className="space-y-3">
          <div className="p-3 border-4 border-black bg-black text-white text-sm break-all">
            We sent a link to <b>{sentTo}</b>. Check your inbox and click it.
          </div>
          <button className="block w-full p-3 border-4 border-black text-center font-bold" onClick={()=>setStep("email")}>Use a different e-mail</button>
        </div>
      )}
    </section>
  );
}

function ProfileView({ db, setDb, email }) {
  const u = db.users[email] || { email };
  const [firstName, setFirstName] = useState(u.firstName || "");
  const [lastName, setLastName] = useState(u.lastName || "");
  const [img, setImg] = useState(u.imageDataURL || "");

  async function onPick(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setImg(reader.result);
    reader.readAsDataURL(file);
  }

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-black">Your profile</h1>
      <div className="grid grid-cols-3 gap-3 items-center">
        <div className="col-span-1"><Avatar img={img} size={64} label={firstName || email} /></div>
        <div className="col-span-2 text-xs opacity-70">Upload a square image for best results.</div>
      </div>
      <div className="space-y-2">
        <label className="block text-sm font-bold">First name</label>
        <input className="w-full p-3 border-4 border-black" value={firstName} onChange={(e)=>setFirstName(e.target.value)} />
        <label className="block text-sm font-bold">Last name</label>
        <input className="w-full p-3 border-4 border-black" value={lastName} onChange={(e)=>setLastName(e.target.value)} />
        <label className="block text-sm font-bold">Profile picture</label>
        <input className="w-full p-3 border-4 border-black" type="file" accept="image/*" onChange={onPick} />
        <button className="w-full p-3 border-4 border-black font-bold" onClick={()=>{
          setDb(prev=>{
            const copy = { ...prev, users: { ...prev.users } };
            copy.users[email] = { email, firstName, lastName, imageDataURL: img };
            return copy;
          });
          alert("Profile saved.");
        }}>Save</button>
      </div>
    </section>
  );
}

function GroupsView({ db, setDb, email, setView, setActiveGroupId }) {
  const myGroups = Object.values(db.groups).filter(g => g.members.includes(email));
  const [name, setName] = useState("");

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-black">Your groups</h1>

      <div className="space-y-2">
        <label className="block text-sm font-bold">Create a new group</label>
        <input className="w-full p-3 border-4 border-black" placeholder="Group name" value={name} onChange={(e)=>setName(e.target.value)} />
        <button
          className="w-full p-3 border-4 border-black font-bold"
          onClick={async ()=>{
            if (!name.trim()) return alert("Name required");
            try {
              const editionId = db.editions[0]?.id; // simple default
              if (!editionId) return alert("No edition available. Please add one in Admin.");
              const userId = await getUserId();
              if (!userId) throw new Error("Not authenticated");

              // 1) create Supabase group
              const { data: g, error } = await supabase
                .from("groups")
                .insert({ name: name.trim(), owner: userId, edition_id: editionId })
                .select()
                .single();
              if (error) throw error;

              // 2) self membership
              const { error: mErr } = await supabase
                .from("group_members")
                .insert({ group_id: g.id, user_id: userId });
              if (mErr) throw mErr;

              // 3) local mirror with supabaseId
              const id = uid("group");
              setDb(prev=>{
                const copy = { ...prev, groups: { ...prev.groups } };
                copy.groups[id] = {
                  id,
                  supabaseId: g.id,
                  name: name.trim(),
                  ownerEmail: email,
                  members: [email],
                  rounds: [],
                  leaderboard: { [email]: 0 },
                  usedStatementIds: [],
                  nextIssueAt: null,
                  editionId,
                };
                return copy;
              });
              setName("");
            } catch (e) {
              console.error(e);
              alert(e.message || "Failed to create group");
            }
          }}
        >
          Create group
        </button>
      </div>

      <div className="grid gap-3">
        {myGroups.map(g => (
          <div key={g.id} className="p-3 border-4 border-black">
            <div className="flex items-center gap-2">
              <div className="font-extrabold text-lg">{g.name}</div>
              <span className="ml-auto text-xs px-2 py-0.5 border-2 border-black">{g.members.length} members</span>
            </div>
            <div className="text-xs mt-1 opacity-70">
              Edition: {db.editions.find(e=>e.id===g.editionId)?.name || "—"}
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button className="p-2 border-2 border-black" onClick={()=>{ setActiveGroupId(g.id); setView("group"); }}>Open</button>
              <InviteButton group={g} />
            </div>
          </div>
        ))}
        {myGroups.length === 0 && <p className="text-sm opacity-70">No groups yet. Create one and invite your friends.</p>}
      </div>
    </section>
  );
}

function InviteButton({ group }) {
  const [copied, setCopied] = useState(false);
  const inviteURL = useMemo(()=>{
    const url = new URL(location.href);
    url.searchParams.set("invite", group.id);
    return url.toString();
  }, [group.id]);

  return (
    <button className="p-2 border-2 border-black" onClick={()=>{
      navigator.clipboard.writeText(inviteURL);
      setCopied(true);
      setTimeout(()=>setCopied(false), 1500);
    }}>{copied ? "Link copied" : "Copy invite"}</button>
  );
}

function GroupDetail({ db, setDb, groupId, meEmail }) {
  const g = db.groups[groupId];
  const active = (g.rounds || []).find(r => !r.closed);
  const [comment, setComment] = useState("");

  useTicker(1000);
  const timeLeft = active ? Math.max(0, active.expiresAt - now()) : 0;

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-black">{g.name}</h1>
        <span className="ml-auto text-xs px-2 py-0.5 border-2 border-black">{g.members.length} members</span>
      </div>

      {!active && (
        <div className="p-3 border-4 border-black bg-yellow-200">
          <div className="font-bold">No active voting right now.</div>
          <button
            className="mt-2 w-full p-3 border-4 border-black font-bold"
            onClick={async ()=>{
              const copy = structuredClone(db);
              const gg = copy.groups[groupId];
              await issueNewStatement(copy, gg);
              setDb(copy);
            }}
          >
            Start first circle
          </button>
        </div>
      )}

      {active && (
        <div className="p-3 border-4 border-black">
          <div className="text-xs mb-1">Voting ends in <b>{humanTime(timeLeft)}</b></div>
          <div className="font-extrabold text-lg">“{getStatementText(db, active.statementId)}”</div>
          <VotePanel db={db} setDb={setDb} group={g} round={active} meEmail={meEmail} />
        </div>
      )}

      {/* Leaderboard */}
      <div className="p-3 border-4 border-black">
        <div className="font-extrabold mb-2">Leaderboard</div>
        <div className="grid gap-1">
          {Object.entries(g.leaderboard).sort((a,b)=>b[1]-a[1]).map(([em, pts], idx)=> (
            <div key={em} className="flex items-center gap-2">
              <span className="w-6 text-right font-bold">{idx+1}.</span>
              <span className="flex-1">{formatUser(db.users[em] || { email: em })}</span>
              <span className="px-2 border-2 border-black">{pts} pt{pts===1?"":"s"}</span>
            </div>
          ))}
        </div>
      </div>

      {/* History with comments */}
      <div className="p-3 border-4 border-black">
        <div className="font-extrabold mb-2">Rounds</div>
        <div className="grid gap-3">
          {(g.rounds || []).map(r => (
            <div key={r.id} className={`p-2 border-2 border-black ${r.closed ? "bg-gray-100" : ""}`}>
              <div className="text-xs opacity-70">{new Date(r.issuedAt).toLocaleString()}</div>
              <div className="font-bold">“{getStatementText(db, r.statementId)}”</div>
              <div className="text-sm mt-1">{r.closed ? <i>Finished</i> : <i>Voting in progress…</i>}</div>
              <div className="mt-2 border-t-2 border-black pt-2">
                <div className="text-xs font-bold mb-1">Discussion</div>
                <div className="grid gap-1">
                  {(r.comments||[]).map(c => (
                    <div key={c.id} className="text-sm"><b>{formatUser(db.users[c.email]||{email:c.email})}:</b> {c.text}</div>
                  ))}
                </div>
                {r.closed && (
                  <div className="mt-2 flex gap-2">
                    <input className="flex-1 p-2 border-2 border-black" placeholder="Add a comment" value={comment} onChange={(e)=>setComment(e.target.value)} />
                    <button className="px-3 border-2 border-black" onClick={()=>{
                      if (!comment.trim()) return;
                      setDb(prev=>{
                        const copy = structuredClone(prev);
                        const rr = copy.groups[groupId].rounds.find(x=>x.id===r.id);
                        rr.comments = rr.comments || [];
                        rr.comments.push({ id: uid("cmt"), email: meEmail, text: comment.trim(), ts: now() });
                        return copy;
                      });
                      setComment("");
                    }}>Post</button>
                  </div>
                )}
              </div>
            </div>
          ))}
          {(g.rounds||[]).length===0 && <div className="opacity-70 text-sm">No rounds yet.</div>}
        </div>
      </div>

      {/* Members */}
      <div className="p-3 border-4 border-black">
        <div className="font-extrabold mb-2">Members</div>
        <div className="grid gap-2">
          {g.members.map(em => (
            <div key={em} className="flex items-center gap-2">
              <Avatar img={db.users[em]?.imageDataURL} label={formatUser(db.users[em] || { email: em })} />
              <span className="ml-auto text-xs opacity-70">{em}</span>
            </div>
          ))}
        </div>
        <div className="mt-3"><InviteButton group={g} /></div>
      </div>
    </section>
  );
}

function getStatementText(db, statementId) {
  const local = db.statements.find(s => s.id === statementId)?.text;
  return local || "[statement from server]";
}

function VotePanel({ db, setDb, group, round, meEmail }) {
  const hasVoted = round.votes && Object.prototype.hasOwnProperty.call(round.votes, meEmail);
  const myVote = hasVoted ? round.votes[meEmail] : null;
  const [selected, setSelected] = useState(myVote || "");

  const remainingNeeded = group.members.length - Object.keys(round.votes||{}).length;

  return (
    <div>
      <div className="text-sm opacity-70">Pick the person this statement fits best, or abstain.</div>
      {!hasVoted ? (
        <div className="mt-2 grid gap-2">
          {group.members.filter(e=>e!==meEmail).map(e => (
            <label key={e} className="flex items-center gap-2 p-2 border-2 border-black">
              <input type="radio" name="vote" value={e} checked={selected===e} onChange={()=>setSelected(e)} />
              <span className="font-bold">{formatUser(db.users[e]||{email:e})}</span>
            </label>
          ))}
          <label className="flex items-center gap-2 p-2 border-2 border-black">
            <input type="radio" name="vote" value="abstain" checked={selected==="abstain"} onChange={()=>setSelected("abstain")} />
            <span className="font-bold">Abstain</span>
          </label>
          <button className="p-2 border-2 border-black font-bold" onClick={()=>{
            if (!selected) return alert("Select an option");
            setDb(prev=>{
              const copy = structuredClone(prev);
              const g = copy.groups[group.id];
              const r = g.rounds.find(x=>x.id===round.id);
              r.votes = r.votes || {};
              r.votes[meEmail] = selected;
              const total = g.members.length;
              const current = Object.keys(r.votes).length;
              if (current >= total) closeRound(copy, g, r);
              return copy;
            });
          }}>Submit vote</button>
          <div className="text-xs opacity-70">Waiting on <b>{remainingNeeded}</b> vote(s)…</div>
        </div>
      ) : (
        <div className="mt-2 text-sm">
          You voted: <b>{myVote === "abstain" ? "Abstain" : formatUser(db.users[myVote]||{email:myVote})}</b>
        </div>
      )}
    </div>
  );
}

function closeRound(db, group, round) {
  if (round.closed) return;
  round.closed = true;
  const tally = {};
  Object.values(round.votes||{}).forEach(v => { if (v && v !== "abstain") tally[v] = (tally[v]||0) + 1; });
  round.tally = tally;
  const max = Math.max(0, ...Object.values(tally));
  const winners = Object.entries(tally).filter(([,c])=>c===max).map(([e])=>e);
  round.winnerEmails = winners;
  winners.forEach(e => { group.leaderboard[e] = (group.leaderboard[e]||0) + 1; });
  group.members.forEach(m => dbAddNotification(db, m, { text: `Round finished in “${group.name}”.`, groupId: group.id }));
  group.nextIssueAt = now() + WEEK;
}

async function issueNewStatement(db, group) {
  if (!group.supabaseId) {
    alert("Group has no supabaseId yet. Please recreate it so it links to Supabase.");
    return;
  }
  const stmt = await rpcNextStatementForGroup(group.supabaseId);
  if (!stmt) { alert("Keine unbenutzten Statements in dieser Edition."); return; }

  const newRound = {
    id: uid("round"),
    statementId: stmt.id,
    issuedAt: now(),
    expiresAt: now() + DAY,
    votes: {},
    closed: false,
    comments: [],
  };
  group.rounds = group.rounds || [];
  group.rounds.unshift(newRound);
  group.nextIssueAt = null;
  try { await markStatementUsed(group.supabaseId, stmt.id); } catch (e) { console.error(e); }
  group.usedStatementIds = Array.from(new Set([...(group.usedStatementIds||[]), stmt.id]));
  group.members.forEach(m => dbAddNotification(db, m, { text: `New statement in “${group.name}”. Time to vote!`, groupId: group.id }));
}

function formatUser(u) {
  if (!u) return "Unknown";
  if (u.firstName || u.lastName) return `${u.firstName||""} ${u.lastName||""}`.trim();
  return u.email;
}

function AdminView({ db, setDb, onExit }) {
  const [authed, setAuthed] = useState(false);
  const [pw, setPw] = useState("");
  const [tab, setTab] = useState("editions");

  const [eds, setEds] = useState(db.editions);
  const [selEdition, setSelEdition] = useState(eds[0]?.id || "");
  const [stmts, setStmts] = useState([]);

  useEffect(() => { setEds(db.editions); if (!selEdition && db.editions[0]) setSelEdition(db.editions[0].id); }, [db.editions]);

  async function reloadEditions() {
    const ed = await listEditions();
    setEds(ed);
    setDb(prev => ({ ...prev, editions: ed }));
    if (!ed.find(e => e.id === selEdition)) setSelEdition(ed[0]?.id || "");
  }
  async function reloadStatements(editionId) {
    if (!editionId) { setStmts([]); return; }
    const list = await listStatements({ editionId });
    setStmts(list);
  }

  useEffect(() => { if (authed && selEdition) reloadStatements(selEdition); }, [authed, selEdition]);

  if (!authed) {
    return (
      <section className="space-y-4">
        <h1 className="text-2xl font-black">Admin</h1>
        <input className="w-full p-3 border-4 border-black" type="password" placeholder="Password" value={pw} onChange={(e)=>setPw(e.target.value)} />
        <div className="grid grid-cols-2 gap-2">
          <button className="w-full p-3 border-4 border-black font-bold" onClick={()=>{
            if (pw === "XNAbaubauav1114!!!2") { setAuthed(true); reloadEditions(); } else alert("Incorrect password");
          }}>Enter</button>
          <button className="w-full p-3 border-4 border-black" onClick={onExit}>Exit</button>
        </div>
        <p className="text-xs opacity-70">Hinweis: Schreibzugriffe funktionieren nur, wenn du mit deinem Admin‑Supabase‑Account eingeloggt bist (RLS).</p>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-black">Admin</h1>
        <div className="flex gap-2">
          <button className={`px-2 py-1 border-2 border-black ${tab==="editions"?"bg-black text-white":""}`} onClick={()=>setTab("editions")}>Editions</button>
          <button className={`px-2 py-1 border-2 border-black ${tab==="statements"?"bg-black text-white":""}`} onClick={()=>setTab("statements")}>Statements</button>
          <button className="px-2 py-1 border-2 border-black" onClick={()=>{ setAuthed(false); setPw(""); }}>Log out</button>
          <button className="px-2 py-1 border-2 border-black" onClick={onExit}>Exit Admin</button>
        </div>
      </div>

      {tab === "editions" && <AdminEditions eds={eds} onReload={reloadEditions} />}
      {tab === "statements" && <AdminStatements eds={eds} selEdition={selEdition} setSelEdition={setSelEdition} stmts={stmts} reloadStatements={reloadStatements} />}
    </section>
  );
}

function AdminEditions({ eds, onReload }) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");

  return (
    <div className="space-y-4">
      <div className="p-3 border-4 border-black">
        <div className="font-bold mb-2">Add Edition</div>
        <div className="grid gap-2">
          <input className="p-2 border-2 border-black" placeholder="Name" value={name} onChange={(e)=>setName(e.target.value)} />
          <input className="p-2 border-2 border-black" placeholder="slug (unique, a-z-0-9)" value={slug} onChange={(e)=>setSlug(e.target.value)} />
          <button className="p-2 border-2 border-black font-bold" onClick={async()=>{
            if (!name.trim() || !slug.trim()) return alert("Name and slug required");
            try {
              await createEdition({ name: name.trim(), slug: slug.trim().toLowerCase(), active: true });
              setName(""); setSlug("");
              await onReload();
            } catch (e) { alert(e.message || "Failed to create edition"); }
          }}>Create</button>
        </div>
      </div>

      <div className="grid gap-2">
        {eds.map(ed => <EditionRow key={ed.id} ed={ed} onReload={onReload} />)}
        {eds.length === 0 && <div className="opacity-70 text-sm">No editions found.</div>}
      </div>
    </div>
  );
}

function EditionRow({ ed, onReload }) {
  const [name, setName] = useState(ed.name);
  const [slug, setSlug] = useState(ed.slug);
  const [active, setActive] = useState(!!ed.active);
  return (
    <div className="p-3 border-2 border-black grid gap-2">
      <div className="flex items-center gap-2">
        <input className="flex-1 p-2 border-2 border-black" value={name} onChange={(e)=>setName(e.target.value)} />
        <button className="px-2 py-1 border-2 border-black" onClick={async()=>{
          try { await renameEdition(ed.id, name.trim()); await onReload(); } catch (e) { alert(e.message); }
        }}>Rename</button>
      </div>
      <div className="flex items-center gap-2">
        <input className="flex-1 p-2 border-2 border-black" value={slug} onChange={(e)=>setSlug(e.target.value)} />
        <button className="px-2 py-1 border-2 border-black" onClick={async()=>{
          try { await changeEditionSlug(ed.id, slug.trim().toLowerCase()); await onReload(); } catch (e) { alert(e.message); }
        }}>Change slug</button>
      </div>
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={active} onChange={async(e)=>{
            const val = e.target.checked; setActive(val);
            try { await toggleEditionActive(ed.id, val); await onReload(); } catch (er) { alert(er.message); }
          }} />
          <span>Active</span>
        </label>
        <button className="ml-auto px-2 py-1 border-2 border-black" onClick={async()=>{
          if (!confirm("Delete this edition? Statements linked to it will remain but might be filtered out by your UI.")) return;
          try { await deleteEdition(ed.id); await onReload(); } catch (e) { alert(e.message); }
        }}>Delete</button>
      </div>
    </div>
  );
}

function AdminStatements({ eds, selEdition, setSelEdition, stmts, reloadStatements }) {
  const [text, setText] = useState("");

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="text-sm font-bold">Edition:</span>
        <select className="p-2 border-2 border-black" value={selEdition} onChange={async(e)=>{
          const id = e.target.value; setSelEdition(id); await reloadStatements(id);
        }}>
          {eds.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        <button className="ml-auto px-2 py-1 border-2 border-black" onClick={()=> selEdition && reloadStatements(selEdition)}>Reload</button>
      </div>

      <div className="p-3 border-4 border-black">
        <div className="font-bold mb-2">Add Statement</div>
        <div className="grid gap-2">
          <textarea className="p-2 border-2 border-black" rows="3" placeholder="Statement text" value={text} onChange={(e)=>setText(e.target.value)} />
          <button className="p-2 border-2 border-black font-bold" onClick={async()=>{
            if (!selEdition) return alert("Select an edition first");
            if (!text.trim()) return alert("Text required");
            try {
              await createStatement({ text: text.trim(), editionId: selEdition });
              setText("");
              await reloadStatements(selEdition);
            } catch (e) { alert(e.message || "Failed to create statement"); }
          }}>Create</button>
        </div>
      </div>

      <div className="grid gap-2">
        {stmts.map(s => <StatementRow key={s.id} s={s} onChanged={()=> reloadStatements(selEdition)} />)}
        {stmts.length === 0 && <div className="opacity-70 text-sm">No statements in this edition.</div>}
      </div>
    </div>
  );
}

function StatementRow({ s, onChanged }) {
  const [text, setText] = useState(s.text);
  return (
    <div className="p-2 border-2 border-black grid gap-2">
      <textarea className="p-2 border-2 border-black" rows="3" value={text} onChange={(e)=>setText(e.target.value)} />
      <div className="flex items-center gap-2">
        <button className="px-2 py-1 border-2 border-black" onClick={async()=>{
          try { await updateStatementText(s.id, text.trim()); await onChanged(); } catch (e) { alert(e.message); }
        }}>Save</button>
        <button className="ml-auto px-2 py-1 border-2 border-black" onClick={async()=>{
          if (!confirm("Delete this statement?")) return;
          try { await deleteStatement(s.id); await onChanged(); } catch (e) { alert(e.message); }
        }}>Delete</button>
      </div>
    </div>
  );
}
