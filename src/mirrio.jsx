// src/mirrio.jsx — Admin improvements + /admin route + Editions
import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabaseClient";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/react";

// =============== Utilities & Faux DB ==========================
const DB_KEY = "mirror.db.v1";
const now = () => Date.now();
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

function uid(prefix = "id") {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}

function defaultEditions() {
  // seed 2 editions
  const friends = { id: uid("ed"), name: "Friends", slug: "friends", active: true };
  const family  = { id: uid("ed"), name: "Family",  slug: "family",  active: true };
  return [friends, family];
}

function defaultStatementsFor(editions) {
  const friendsId = (editions.find(e=>e.slug==="friends")||editions[0]).id;
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
  ].map((text) => ({ id: uid("stmt"), text, editionId: friendsId }));
}

function createEmptyDB() {
  const editions = defaultEditions();
  return {
    users: {}, // email -> { email, firstName, lastName, imageDataURL }
    groups: {}, // id -> { id, name, ownerEmail, members: [email], rounds: [...], leaderboard: {email: points}, usedStatementIds: [], nextIssueAt?: number, editionId? }
    statements: defaultStatementsFor(editions), // {id, text, editionId}
    notifications: {}, // email -> [{ id, ts, text, groupId }]
    editions, // [{id,name,slug,active}]
  };
}

function loadDB() {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (!raw) return createEmptyDB();
    const data = JSON.parse(raw);
    // ensure editions exist; if missing, seed
    const editions = Array.isArray(data.editions) && data.editions.length ? data.editions : defaultEditions();
    // upgrade existing statements without editionId to default
    const upgradedStatements = (data.statements || defaultStatementsFor(editions)).map(s => (s.editionId ? s : { ...s, editionId: editions[0].id }));
    return {
      ...createEmptyDB(),
      ...data,
      users: data.users || {},
      groups: data.groups || {},
      statements: upgradedStatements,
      notifications: data.notifications || {},
      editions,
    };
  } catch (e) {
    return createEmptyDB();
  }
}

function saveDB(db) {
  localStorage.setItem(DB_KEY, JSON.stringify(db));
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
  useEffect(() => {
    const id = setInterval(() => setT((t) => t + 1), interval);
    return () => clearInterval(id);
  }, [interval]);
}

// =============== Core App ====================================
export default function Mirrio() {
  const [db, setDb] = useState(loadDB());
  const [email, setEmail] = useState(null);
  const [view, setView] = useState(() => location.pathname === "/admin" ? "admin" : "login");
  const [activeGroupId, setActiveGroupId] = useState(null);
  const [adminOpen, setAdminOpen] = useState(false);

  // keep view in sync with path for /admin
  useEffect(() => {
    const onPop = () => setView(location.pathname === "/admin" ? "admin" : (email ? "groups" : "login"));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [email]);

  // Process Supabase session
  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data } = await supabase.auth.getSession();
      const em = data?.session?.user?.email || null;
      if (mounted) {
        setEmail(em);
        if (location.pathname !== "/admin") {
          setView(em ? "groups" : "login");
        }
      }
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => {
      const em = session?.user?.email || null;
      setEmail(em);
      if (location.pathname !== "/admin") {
        setView(em ? "groups" : "login");
      }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // Handle redirect hash errors from magic links
  useEffect(() => {
    if (location.hash && location.hash.includes("error=")) {
      const p = new URLSearchParams(location.hash.slice(1));
      const code = p.get("error_code");
      const desc = p.get("error_description");
      console.error("Supabase redirect error:", code, desc);
      alert(`Login-Fehler: ${desc || code}`);
      history.replaceState({}, "", location.pathname + location.search); // clear hash
    }
  }, []);

  useEffect(() => saveDB(db), [db]);
  useTicker(1000);

  // Auto-join via invite link
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
      // clean URL once processed
      url.searchParams.delete("invite");
      history.replaceState({}, "", url.toString());
      setActiveGroupId(invite);
      setView("group");
    }
  }, [email]);

  // Auto-issue/close statements (every tick)
  useEffect(() => {
    setDb((prev) => {
      const copy = { ...prev, groups: { ...prev.groups } };
      const t = now();
      Object.values(copy.groups).forEach((g) => {
        const active = g.rounds?.find((r) => !r.closed);
        if (active && t >= active.expiresAt) {
          closeRound(copy, g, active);
        }
        if (!g.rounds?.some((r) => !r.closed) && g.nextIssueAt && t >= g.nextIssueAt) {
          issueNewStatement(copy, g);
        }
      });
      return copy;
    });
  });

  const me = email ? db.users[email] : null;

  return (
    <div className="min-h-dvh bg-white text-black">
      <Header
        email={email}
        me={me}
        onSignOut={() => { supabase.auth.signOut(); if (location.pathname !== "/admin") setView("login"); }}
        onGo={(v) => setView(v)}
        setAdminOpen={setAdminOpen}
      />

      <main className="mx-auto w-full max-w-md p-3 pb-24">
        {view === "login" && (
          <AuthView db={db} setDb={setDb} onLoggedIn={() => setView("groups")} />
        )}
        {view === "profile" && email && (
          <ProfileView db={db} setDb={setDb} email={email} />
        )}
        {view === "groups" && email && (
          <GroupsView db={db} setDb={setDb} email={email} setView={setView} setActiveGroupId={setActiveGroupId} editions={db.editions} />
        )}
        {view === "group" && activeGroupId && email && (
          <GroupDetail db={db} setDb={setDb} groupId={activeGroupId} meEmail={email} />
        )}
        {view === "admin" && (
          <AdminView db={db} setDb={setDb} onExit={() => { history.pushState({}, "", "/"); setView(email ? "groups" : "login"); }} />
        )}
      </main>

      {/* AdminQuickAccess: Admin-Link entfernt (nur noch /admin direkt) */}
      <AdminQuickAccess adminOpen={adminOpen} setAdminOpen={setAdminOpen} />

      {import.meta.env.PROD && (
        <>
          <Analytics />
          <SpeedInsights />
        </>
      )}
    </div>
  );
}

// =============== Header ======================================
function Header({ email, me, onSignOut, onGo, setAdminOpen }) {
  return (
    <header className="sticky top-0 z-10 bg-white border-b-4 border-black">
      <div className="mx-auto max-w-md flex items-center justify-between p-3">
        <div className="font-black text-xl tracking-tight">MIRRIO</div>
        <div className="flex items-center gap-2">
          {email && (
            <button className="px-2 py-1 border-2 border-black active:translate-y-0.5" onClick={() => onGo("groups")}>
              Groups
            </button>
          )}
          <button className="px-2 py-1 border-2 border-black active:translate-y-0.5" onClick={() => setAdminOpen(true)}>
            ☰
          </button>
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

function AdminQuickAccess({ adminOpen, setAdminOpen }) {
  if (!adminOpen) return null;
  return (
    <div className="fixed inset-0 z-20 bg-black/60 flex items-end justify-center" onClick={() => setAdminOpen(false)}>
      <div className="w-full max-w-md bg-white border-4 border-black m-3 p-4" onClick={(e) => e.stopPropagation()}>
        <div className="font-extrabold text-lg mb-2">Menu</div>
        <div className="space-y-2">
          {/* Admin-Link entfernt, /admin ist nur direkt erreichbar */}
          <a className="block w-full px-3 py-2 border-2 border-black text-center" href={withQuery({})}>Copy current URL</a>
          <p className="text-xs opacity-70">Tip: Share group invites from within group pages.</p>
        </div>
      </div>
    </div>
  );
}

function withQuery(extra) {
  const url = new URL(location.href);
  Object.keys(extra).forEach((k) => {
    if (extra[k] == null) url.searchParams.delete(k);
    else url.searchParams.set(k, extra[k]);
  });
  return url.toString();
}

// =============== Auth Views ==================================
function AuthView({ db, setDb, onLoggedIn }) {
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
            className="w-full p-3 border-4 border-black font-bold active:translate-y-0.5 disabled:opacity-60"
            disabled={sending}
            onClick={async () => {
              if (!email.includes("@")) return alert("Enter a valid email");
              // ensure local demo-profile exists so UI has data after login
              setDb((prev) => {
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
              if (error) {
                console.error("Magic link error:", error);
                alert(error.message);
                return;
              }
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
            We sent a link to <b>{sentTo}</b>. Check your inbox and click it to finish sign-in.
          </div>
          <button className="block w-full p-3 border-4 border-black text-center font-bold" onClick={()=>setStep("email")}>Use a different e-mail</button>
        </div>
      )}
    </section>
  );
}

// =============== Profile =====================================
function ProfileView({ db, setDb, email }) {
  const u = db.users[email] || { email };
  const [firstName, setFirstName] = useState(u.firstName || "");
  const [lastName, setLastName] = useState(u.lastName || "");
  const [img, setImg] = useState(u.imageDataURL || "");

  async function onPickImage(e) {
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
        <label className="block text	sm font-bold">First name</label>
        <input className="w-full p-3 border-4 border-black" value={firstName} onChange={(e)=>setFirstName(e.target.value)} />
        <label className="block text-sm font-bold">Last name</label>
        <input className="w-full p-3 border-4 border-black" value={lastName} onChange={(e)=>setLastName(e.target.value)} />
        <label className="block text-sm font-bold">Profile picture</label>
        <input className="w-full p-3 border-4 border-black" type="file" accept="image/*" onChange={onPickImage} />
        <button className="w-full p-3 border-4 border-black font-bold active:translate-y-0.5" onClick={()=>{
          setDb((prev)=>{
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

function Avatar({ img, label, size = 40 }) {
  return (
    <div className="flex items-center gap-2">
      <div className="shrink-0 border-2 border-black bg-white" style={{ width: size, height: size }}>
        {img ? (
          <img src={img} alt="avatar" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full grid place-items-center text-xs">🙂</div>
        )}
      </div>
      {label && <span className="text-sm font-bold line-clamp-1">{label}</span>}
    </div>
  );
}

// =============== Groups ======================================
function GroupsView({ db, setDb, email, setView, setActiveGroupId, editions }) {
  const myGroups = Object.values(db.groups).filter((g) => g.members.includes(email));
  const [name, setName] = useState("");

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-black">Your groups</h1>

      <div className="space-y-2">
        <label className="block text-sm font-bold">Create a new group</label>
        <input className="w-full p-3 border-4 border-black" placeholder="Group name" value={name} onChange={(e)=>setName(e.target.value)} />
        <button className="w-full p-3 border-4 border-black font-bold active:translate-y-0.5" onClick={()=>{
          if (!name.trim()) return alert("Name required");
          const id = uid("group");
          const defaultEditionId = editions[0]?.id;
          setDb((prev)=>{
            const copy = { ...prev, groups: { ...prev.groups } };
            copy.groups[id] = { id, name: name.trim(), ownerEmail: email, members: [email], rounds: [], leaderboard: { [email]: 0 }, usedStatementIds: [], nextIssueAt: null, editionId: defaultEditionId };
            return copy;
          });
          setName("");
        }}>Create group</button>
      </div>

      <div className="grid gap-3">
        {myGroups.map((g)=> (
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
        {myGroups.length === 0 && (
          <p className="text-sm opacity-70">No groups yet. Create one and invite your friends.</p>
        )}
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

// =============== Group Detail & Game ==========================
function GroupDetail({ db, setDb, groupId, meEmail }) {
  const g = db.groups[groupId];
  const me = db.users[meEmail] || { email: meEmail };
  const active = g.rounds.find((r) => !r.closed);
  const [comment, setComment] = useState("");

  // Countdown logic
  useTicker(1000);
  const timeLeft = active ? Math.max(0, active.expiresAt - now()) : 0;
  const nextIn = !active && g.nextIssueAt ? Math.max(0, g.nextIssueAt - now()) : null;

  const membersDetailed = g.members.map((e)=>({ email: e, name: formatUser(db.users[e]) }));

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-black">{g.name}</h1>
        <span className="ml-auto text-xs px-2 py-0.5 border-2 border-black">{g.members.length} members</span>
      </div>

      {!active && (
        <div className="p-3 border-4 border-black bg-yellow-200">
          <div className="font-bold">No active voting right now.</div>
          {g.nextIssueAt ? (
            <div className="text-sm">Next statement in <b>{humanTime(nextIn)}</b>.</div>
          ) : (
            <button className="mt-2 w-full p-3 border-4 border-black font-bold active:translate-y-0.5" onClick={()=>{
              setDb((prev)=>{ const copy = { ...prev }; issueNewStatement(copy, copy.groups[groupId], true); return copy; });
            }}>Start first circle</button>
          )}
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
          {Object.entries(g.leaderboard).sort((a,b)=>b[1]-a[1]).map(([email, pts], idx)=> (
            <div key={email} className="flex items-center gap-2">
              <span className="w-6 text-right font-bold">{idx+1}.</span>
              <span className="flex-1">{formatUser(db.users[email] || { email })}</span>
              <span className="px-2 border-2 border-black">{pts} pt{pts===1?"":"s"}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Round history */}
      <div className="p-3 border-4 border-black">
        <div className="font-extrabold mb-2">Rounds</div>
        <div className="grid gap-3">
          {g.rounds.map((r)=> (
            <div key={r.id} className={`p-2 border-2 border-black ${r.closed?"bg-gray-100":""}`}>
              <div className="text-xs opacity-70">{new Date(r.issuedAt).toLocaleString()}</div>
              <div className="font-bold">“{getStatementText(db, r.statementId)}”</div>
              <div className="text	sm mt-1">{r.closed ? (
                <>
                  <b>Winner:</b> {r.winnerEmails.length>0 ? r.winnerEmails.map((e)=>formatUser(db.users[e]||{email:e})).join(", ") : "—"}
                  <div className="text-xs mt-1">Votes: {Object.entries(r.tally || {}).map(([e,c])=>`${formatUser(db.users[e]||{email:e})} (${c})`).join(" · ") || "—"}</div>
                </>
              ) : (
                <i>Voting in progress…</i>
              )}</div>

              {/* Comments */}
              <div className="mt-2 border-t-2 border-black pt-2">
                <div className="text-xs font-bold mb-1">Discussion</div>
                <div className="grid gap-1">
                  {(r.comments||[]).map((c)=> (
                    <div key={c.id} className="text-sm"><b>{formatUser(db.users[c.email]||{email:c.email})}:</b> {c.text}</div>
                  ))}
                </div>
                {r.closed && (
                  <div className="mt-2 flex gap-2">
                    <input className="flex-1 p-2 border-2 border-black" placeholder="Add a comment" value={comment} onChange={(e)=>setComment(e.target.value)} />
                    <button className="px-3 border-2 border-black" onClick={()=>{
                      if (!comment.trim()) return;
                      setDb((prev)=>{
                        const copy = { ...prev, groups: { ...prev.groups } };
                        const rr = copy.groups[groupId].rounds.find((x)=>x.id===r.id);
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
          {g.rounds.length===0 && <div className="opacity-70 text-sm">No rounds yet.</div>}
        </div>
      </div>

      {/* Members */}
      <div className="p-3 border-4 border-black">
        <div className="font-extrabold mb-2">Members</div>
        <div className="grid gap-2">
          {membersDetailed.map((	m)=> (
            <div key={m.email} className="flex items-center gap-2">
              <Avatar img={db.users[m.email]?.imageDataURL} label={m.name} />
              <span className="ml-auto text-xs opacity-70">{m.email}</span>
            </div>
          ))}
        </div>
        <div className="mt-3"><InviteButton group={g} /></div>
      </div>
    </section>
  );
}

function getStatementText(db, statementId) {
  return (db.statements.find((s)=>s.id===statementId)?.text) || "[deleted statement]";
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
          {group.members.filter((e)=>e!==meEmail).map((e)=> (
            <label key={e} className="flex items-center gap-2 p-2 border-2 border-black">
              <input type="radio" name="vote" value={e} checked={selected===e} onChange={()=>setSelected(e)} />
              <span className="font-bold">{formatUser(db.users[e]||{email:e})}</span>
            </label>
          ))}
          <label className="flex items-center gap-2 p-2 border-2 border-black">
            <input type="radio" name="vote" value="abstain" checked={selected==="abstain"} onChange={()=>setSelected("abstain")} />
            <span className="font-bold">Abstain</span>
          </label>
          <button className="p-2 border-2 border-black font-bold active:translate-y-0.5" onClick={()=>{
            if (!selected) return alert("Select an option");
            setDb((prev)=>{
              const copy = { ...prev, groups: { ...prev.groups } };
              const g = copy.groups[group.id];
              const r = g.rounds.find((x)=>x.id===round.id);
              r.votes = r.votes || {};
              r.votes[meEmail] = selected;
              // If all votes in, close early
              const total = g.members.length;
              const current = Object.keys(r.votes).length;
              if (current >= total) {
                closeRound(copy, g, r);
              }
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
  // tally
  const tally = {};
  Object.values(round.votes||{}).forEach((v)=>{
    if (v && v !== "abstain") tally[v] = (tally[v]||0) + 1;
  });
  round.tally = tally;
  const max = Math.max(0, ...Object.values(tally));
  const winners = Object.entries(tally).filter(([,c])=>c===max).map(([e])=>e);
  round.winnerEmails = winners;
  // points (1 point per winner)
  winners.forEach((e)=>{ group.leaderboard[e] = (group.leaderboard[e]||0) + 1; });
  // notify group members with results
  group.members.forEach((m)=>{
    dbAddNotification(db, m, { text: `Round finished in “${group.name}”. ${winners.length?`Winner: ${winners.map((e)=>formatUser(db.users[e]||{email:e})).join(", ")}`:"No votes"}.`, groupId: group.id });
  });
  // schedule next issue in 7 days
  group.nextIssueAt = now() + WEEK;
}

function issueNewStatement(db, group, immediate = false) {
  // pick an unused statement limited by edition if group.editionId set
  const used = new Set(group.usedStatementIds || []);
  const filterByEdition = (s) => !group.editionId || s.editionId === group.editionId;
  const pool = db.statements.filter((s)=> filterByEdition(s) && !used.has(s.id));
  if (pool.length === 0) {
    // all used for this edition — reset usage for this edition only
    group.usedStatementIds = (group.usedStatementIds || []).filter((sid) => {
      const st = db.statements.find(s=>s.id===sid);
      return st && (!group.editionId || st.editionId !== group.editionId);
    });
  }
  const available = db.statements.filter((s)=> filterByEdition(s) && !(new Set(group.usedStatementIds)).has(s.id));
  if (available.length === 0) return; // still nothing — abort
  const pick = available[Math.floor(Math.random()*available.length)];

  group.usedStatementIds = Array.from(new Set([...(group.usedStatementIds||[]), pick.id]));
  const newRound = {
    id: uid("round"),
    statementId: pick.id,
    issuedAt: now(),
    expiresAt: now() + DAY, // 24h voting window
    votes: {},
    closed: false,
    comments: [],
  };
  group.rounds = group.rounds || [];
  group.rounds.unshift(newRound); // newest first
  // notify group members
  group.members.forEach((m)=>{
    dbAddNotification(db, m, { text: `New statement in “${group.name}”. Time to vote!`, groupId: group.id });
  });
  // clear nextIssueAt — will be set when this round closes
  group.nextIssueAt = null;
}

function formatUser(u) {
  if (!u) return "Unknown";
  if (u.firstName || u.lastName) return `${u.firstName||""} ${u.lastName||""}`.trim();
  return u.email;
}

// =============== Admin (with Editions) =======================
function AdminView({ db, setDb, onExit }) {
  const [authed, setAuthed] = useState(false);
  const [pw, setPw] = useState("");
  const [text, setText] = useState("");
  const [editionId, setEditionId] = useState(db.editions[0]?.id || "");
  const [tab, setTab] = useState("statements"); // 'statements' | 'editions'

  if (!authed) {
    return (
      <section className="space-y-4">
        <h1 className="text-2xl font-black">Admin</h1>
        <p className="text-sm opacity-70">Enter password to manage statements & editions.</p>
        <input className="w-full p-3 border-4 border-black" type="password" placeholder="Password" value={pw} onChange={(e)=>setPw(e.target.value)} />
        <div className="grid grid-cols-2 gap-2">
          <button className="w-full p-3 border-4 border-black font-bold" onClick={()=>{
            if (pw === "XNAbaubauav1114!!!2") setAuthed(true); else alert("Incorrect password");
          }}>Enter</button>
          <button className="w-full p-3 border-4 border-black" onClick={onExit}>Exit</button>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-black">Admin</h1>
        <div className="flex gap-2">
          <button className={`px-2 py-1 border-2 border-black ${tab==="statements"?"bg-black text-white":""}`} onClick={()=>setTab("statements")}>Statements</button>
          <button className={`px-2 py-1 border-2 border-black ${tab==="editions"?"bg-black text-white":""}`} onClick={()=>setTab("editions")}>Editions</button>
          <button className="px-2 py-1 border-2 border-black" onClick={()=>{ setAuthed(false); setPw(""); }}>Log out</button>
          <button className="px-2 py-1 border-2 border-black" onClick={onExit}>Exit Admin</button>
        </div>
      </div>

      {tab === "statements" && (
        <>
          <div className="space-y-2">
            <label className="block text-sm font-bold">Add new statement</label>
            <textarea className="w-full p-3 border-4 border-black" rows={3} placeholder="Type a new statement…" value={text} onChange={(e)=>setText(e.target.value)} />
            <label className="block text-sm font-bold">Edition</label>
            <select className="w-full p-3 border-4 border-black" value={editionId} onChange={(e)=>setEditionId(e.target.value)}>
              {db.editions.map(ed => <option key={ed.id} value={ed.id}>{ed.name}</option>)}
            </select>
            <button className="w	full p-3 border-4 border-black font-bold" onClick={()=>{
              if (!text.trim()) return alert("Enter a statement");
              if (!editionId) return alert("Select an edition");
              setDb((prev)=> ({ ...prev, statements: [{ id: uid("stmt"), text: text.trim(), editionId }, ...prev.statements] }));
              setText("");
            }}>Add statement</button>
          </div>

          <div className="grid gap-2">
            {db.statements.map((s)=> (
              <div key={s.id} className="p-2 border-2 border-black">
                <div className="font-bold">{s.text}</div>
                <div className="text-xs opacity-70">Edition: {db.editions.find(e=>e.id===s.editionId)?.name || "—"}</div>
                <div className="mt-2 flex gap-2">
                  <button className="px-2 py-1 border-2 border-black" onClick={()=>{
                    const nxt = prompt("Edit statement", s.text);
                    if (nxt==null) return;
                    setDb((prev)=> ({ ...prev, statements: prev.statements.map((x)=>x.id===s.id?{...x, text:nxt}:x) }));
                  }}>Edit</button>
                  <button className="px-2 py-1 border-2 border-black" onClick={()=>{
                    if (!confirm("Delete statement?")) return;
                    setDb((prev)=> ({ ...prev, statements: prev.statements.filter((x)=>x.id!==s.id) }));
                  }}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {tab === "editions" && (
        <>
          <EditionManager db={db} setDb={setDb} />
        </>
      )}
    </section>
  );
}

function EditionManager({ db, setDb }) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <label className="block text-sm font-bold">New edition name</label>
        <input className="w-full p-3 border-4 border-black" value={name} onChange={(e)=>setName(e.target.value)} placeholder="e.g., Friends" />
        <label className="block text-sm font-bold">Slug (unique)</label>
        <input className="w-full p-3 border-4 border-black" value={slug} onChange={(e)=>setSlug(e.target.value)} placeholder="e.g., friends" />
        <button className="w-full p-3 border-4 border-black font-bold" onClick={()=>{
          if (!name.trim() || !slug.trim()) return alert("Fill name & slug");
          if (db.editions.some(e=>e.slug===slug.trim())) return alert("Slug already exists");
          const ed = { id: uid("ed"), name: name.trim(), slug: slug.trim(), active: true };
          setDb((prev)=> ({ ...prev, editions: [ed, ...prev.editions] }));
          setName(""); setSlug("");
        }}>Add edition</button>
      </div>

      <div className="grid gap-2">
        {db.editions.map(ed => (
          <div key={ed.id} className="p-2 border-2 border-black">
            <div className="font-bold">{ed.name} <span className="text-xs opacity-70">({ed.slug})</span></div>
            <div className="mt-2 flex gap-2">
              <button className="px-2 py-1 border-2 border-black" onClick={()=>{
                const newName = prompt("Rename edition", ed.name);
                if (newName==null) return;
                setDb((prev)=> ({ ...prev, editions: prev.editions.map(x=>x.id===ed.id?{...x, name:newName}:x) }));
              }}>Rename</button>
              <button className="px-2 py-1 border-2 border-black" onClick={()=>{
                const newSlug = prompt("Change slug", ed.slug);
                if (newSlug==null) return;
                if (db.editions.some(e=>e.slug===newSlug && e.id!==ed.id)) return alert("Slug already in use");
                setDb((prev)=> ({ ...prev, editions: prev.editions.map(x=>x.id===ed.id?{...x, slug:newSlug}:x) }));
              }}>Change slug</button>
              <button className="px-2 py-1 border-2 border-black" onClick={()=>{
                if (!confirm("Delete edition? Statements referencing it will remain with orphaned editionId.")) return;
                setDb((prev)=> ({ ...prev, editions: prev.editions.filter(x=>x.id!==ed.id) }));
              }}>Delete</button>
              <button className="px-2 py-1 border-2 border-black" onClick={()=>{
                setDb((prev)=> ({ ...prev, editions: prev.editions.map(x=>x.id===ed.id?{...x, active:!x.active}:x) }));
              }}>{ed.active ? "Deactivate" : "Activate"}</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// =============== Notifications (simple) =======================
function Notifications({ db, email }) {
  const items = (db.notifications[email]||[]).slice(0, 10);
  if (items.length === 0) return null;
  return (
    <div className="mt-2 grid gap-1">
      {items.map((n)=> (
        <div key={n.id} className="text-xs p-2 border-2 border-black bg-gray-50">
          <b>{new Date(n.ts).toLocaleString()}:</b> {n.text}
        </div>
      ))}
    </div>
  );
}
