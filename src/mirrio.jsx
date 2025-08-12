
import React, { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "./supabaseClient";

// =============================================================
// MIRRIO — updated for real Supabase Magic Link email auth
// =============================================================
// What changed vs your original Mirror.jsx:
// - Removed demo magic-link generation in the UI (no URL shown in frontend)
// - Replaced local token/session with Supabase session handling
// - AuthView now calls supabase.auth.signInWithOtp({ email, options:{ emailRedirectTo: window.location.origin }})
// - App reacts to auth state via supabase.auth.onAuthStateChange and redirects to groups after login
// - Sign out uses supabase.auth.signOut()
// - Rest of your components (groups, rounds, votes, comments, admin) remain as before (still using localStorage)
//   → You can migrate data flows to Supabase later; this file only fixes the login flow to send real emails

// =============== Utilities & Faux DB (unchanged) ========================
const DB_KEY = "mirror.db.v1";
const now = () => Date.now();
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

function uid(prefix = "id") {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}

function loadDB() {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (!raw) return createEmptyDB();
    const data = JSON.parse(raw);
    return {
      ...createEmptyDB(),
      ...data,
      users: data.users || {},
      sessions: data.sessions || {},
      groups: data.groups || {},
      statements: Array.isArray(data.statements) ? data.statements : defaultStatements(),
      notifications: data.notifications || {},
    };
  } catch (e) {
    return createEmptyDB();
  }
}

function saveDB(db) {
  localStorage.setItem(DB_KEY, JSON.stringify(db));
}

function createEmptyDB() {
  return {
    users: {}, // email -> { email, firstName, lastName, imageDataURL }
    sessions: {}, // (unused now, kept for compatibility)
    groups: {}, // id -> { id, name, ownerEmail, members: [email], rounds: [...], leaderboard: {email: points}, usedStatementIds: [], nextIssueAt?: number }
    statements: defaultStatements(), // {id, text}
    notifications: {}, // email -> [{ id, ts, text, groupId }]
  };
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
  useEffect(() => {
    const id = setInterval(() => setT((t) => t + 1), interval);
    return () => clearInterval(id);
  }, [interval]);
}

// =============== Auth (Supabase Magic Link) =============================
// Removed: createMagicLink, tryConsumeMagicToken, useAuthedEmail

// =============== Core App ==============================================
export default function Mirrio() {
  const [db, setDb] = useState(loadDB());

  // Supabase-backed email (null until signed in)
  const [email, setEmail] = useState(null);
  const [view, setView] = useState(() =>
    (new URL(location.href)).searchParams.get("admin") ? "admin" : "login"
  );
  const [activeGroupId, setActiveGroupId] = useState(null);
  const [adminOpen, setAdminOpen] = useState(false);

  // Load current session & react to auth changes
  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data } = await supabase.auth.getSession();
      const em = data?.session?.user?.email || null;
      if (mounted) {
        setEmail(em);
        setView((v) => (em ? (v === "login" ? "groups" : v) : "login"));
      }
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      const em = session?.user?.email || null;
      setEmail(em);
      setView((v) => (em ? (v === "login" ? "groups" : v) : "login"));
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => saveDB(db), [db]);
  useTicker(1000);

  // Auto-join via invite link once email is known
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
      <Header
        email={email}
        me={me}
        onSignOut={() => { supabase.auth.signOut(); setView("login"); }}
        onGo={(v) => setView(v)}
        setAdminOpen={setAdminOpen}
      />

      <main className="mx-auto w-full max-w-md p-3 pb-24">
        {view === "login" && (
          <AuthView db={db} setDb={setDb} setView={setView} />
        )}
        {view === "profile" && email && (
          <ProfileView db={db} setDb={setDb} email={email} />
        )}
        {view === "groups" && email && (
          <GroupsView db={db} setDb={setDb} email={email} setView={setView} setActiveGroupId={setActiveGroupId} />
        )}
        {view === "group" && activeGroupId && email && (
          <GroupDetail db={db} setDb={setDb} groupId={activeGroupId} meEmail={email} />
        )}
        {view === "admin" && (
          <AdminView db={db} setDb={setDb} />
        )}
      </main>

      <AdminQuickAccess adminOpen={adminOpen} setAdminOpen={setAdminOpen} onGoAdmin={() => setView("admin")} />
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

function AdminQuickAccess({ adminOpen, setAdminOpen, onGoAdmin }) {
  if (!adminOpen) return null;
  return (
    <div className="fixed inset-0 z-20 bg-black/60 flex items-end justify-center" onClick={() => setAdminOpen(false)}>
      <div className="w-full max-w-md bg-white border-4 border-black m-3 p-4" onClick={(e) => e.stopPropagation()}>
        <div className="font-extrabold text-lg mb-2">Menu</div>
        <div className="space-y-2">
          <a className="block w-full px-3 py-2 border-2 border-black text-center" href={withQuery({ admin: "1" })} onClick={(e)=>{e.preventDefault(); setAdminOpen(false); onGoAdmin();}}>Admin</a>
          <a className="block w-full px-3 py-2 border-2 border-black text-center" href={withQuery({})}>Copy current URL</a>
          <p className="text-xs opacity-70">Tip: Share group invites or magic links from within the respective pages.</p>
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

// =============== Auth Views (updated) =========================
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
          <button
            className="w-full p-3 border-4 border-black font-bold active:translate-y-0.5 disabled:opacity-60"
            disabled={sending}
            onClick={async () => {
              if (!emailInput.includes("@")) return alert("Enter a valid email");
              setSending(true);
              const { error } = await supabase.auth.signInWithOtp({
                email: emailInput.trim(),
                options: { emailRedirectTo: window.location.origin },
              });
              setSending(false);
              if (error) return alert(error.message);
              setSentTo(emailInput.trim());
              setStep("sent");
            }}
          >
            {sending ? "Sending…" : "Send Magic Link"}
          </button>
          <p className="text-xs opacity-70">We’ve sent a sign-in link to your inbox.</p>
        </div>
      )}
      {step === "sent" && (
        <div className="space-y-3">
          <div className="p-3 border-4 border-black bg-black text-white text-sm break-all">
            Check <b>{sentTo}</b> and click the link to finish sign-in.
          </div>
          <button className="block w-full p-3 border-4 border-black text-center font-bold" onClick={()=>setStep("email")}>Use a different e-mail</button>
        </div>
      )}
    </section>
  );
}

// =============== Profile (unchanged) =========================
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
        <label className="block text-sm font-bold">First name</label>
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

// =============== Groups (unchanged, localStorage) =======================
function GroupsView({ db, setDb, email, setView, setActiveGroupId }) {
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
          setDb((prev)=>{
            const copy = { ...prev, groups: { ...prev.groups } };
            copy.groups[id] = { id, name: name.trim(), ownerEmail: email, members: [email], rounds: [], leaderboard: { [email]: 0 }, usedStatementIds: [], nextIssueAt: null };
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
    url.searchParams.delete("admin");
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

// =============== Group Detail & Game (unchanged, localStorage) =========
function GroupDetail({ db, setDb, groupId, meEmail }) {
  const g = db.groups[groupId];
  const me = db.users[meEmail] || { email: meEmail };
  const active = g.rounds.find((r) => !r.closed);
  const [comment, setComment] = useState("");

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

      <div className="p-3 border-4 border-black">
        <div className="font-extrabold mb-2">Rounds</div>
        <div className="grid gap-3">
          {g.rounds.map((r)=> (
            <div key={r.id} className={`p-2 border-2 border-black ${r.closed?"bg-gray-100":""}`}>
              <div className="text-xs opacity-70">{new Date(r.issuedAt).toLocaleString()}</div>
              <div className="font-bold">“{getStatementText(db, r.statementId)}”</div>
              <div className="text-sm mt-1">{r.closed ? (
                <>
                  <b>Winner:</b> {r.winnerEmails.length>0 ? r.winnerEmails.map((e)=>formatUser(db.users[e]||{email:e})).join(", ") : "—"}
                  <div className="text-xs mt-1">Votes: {Object.entries(r.tally || {}).map(([e,c])=>`${formatUser(db.users[e]||{email:e})} (${c})`).join(" · ") || "—"}</div>
                </>
              ) : (
                <i>Voting in progress…</i>
              )}</div>

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

      <div className="p-3 border-4 border-black">
        <div className="font-extrabold mb-2">Members</div>
        <div className="grid gap-2">
          {membersDetailed.map((m)=> (
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
  const tally = {};
  Object.values(round.votes||{}).forEach((v)=>{
    if (v && v !== "abstain") tally[v] = (tally[v]||0) + 1;
  });
  round.tally = tally;
  const max = Math.max(0, ...Object.values(tally));
  const winners = Object.entries(tally).filter(([,c])=>c===max).map(([e])=>e);
  round.winnerEmails = winners;
  winners.forEach((e)=>{ group.leaderboard[e] = (group.leaderboard[e]||0) + 1; });
  group.members.forEach((m)=>{
    dbAddNotification(db, m, { text: `Round finished in “${group.name}”. ${winners.length?`Winner: ${winners.map((e)=>formatUser(db.users[e]||{email:e})).join(", ")}`:"No votes"}.`, groupId: group.id });
  });
  group.nextIssueAt = now() + WEEK;
}

function issueNewStatement(db, group, immediate = false) {
  const used = new Set(group.usedStatementIds || []);
  const pool = db.statements.filter((s)=>!used.has(s.id));
  if (pool.length === 0) {
    group.usedStatementIds = [];
  }
  const available = db.statements.filter((s)=>!(new Set(group.usedStatementIds)).has(s.id));
  if (available.length === 0) return;
  const pick = available[Math.floor(Math.random()*available.length)];

  group.usedStatementIds = Array.from(new Set([...(group.usedStatementIds||[]), pick.id]));
  const newRound = {
    id: uid("round"),
    statementId: pick.id,
    issuedAt: now(),
    expiresAt: now() + DAY,
    votes: {},
    closed: false,
    comments: [],
  };
  group.rounds.unshift(newRound);
  group.members.forEach((m)=>{
    dbAddNotification(db, m, { text: `New statement in “${group.name}”. Time to vote!`, groupId: group.id });
  });
  group.nextIssueAt = null;
}

function formatUser(u) {
  if (!u) return "Unknown";
  if (u.firstName || u.lastName) return `${u.firstName||""} ${u.lastName||""}`.trim();
  return u.email;
}

// =============== Admin (unchanged, localStorage password) ===============
function AdminView({ db, setDb }) {
  const [authed, setAuthed] = useState(false);
  const [pw, setPw] = useState("");
  const [text, setText] = useState("");

  if (!authed) {
    return (
      <section className="space-y-4">
        <h1 className="text-2xl font-black">Admin</h1>
        <p className="text-sm opacity-70">Enter password to manage statements.</p>
        <input className="w-full p-3 border-4 border-black" type="password" placeholder="Password" value={pw} onChange={(e)=>setPw(e.target.value)} />
        <button className="w-full p-3 border-4 border-black font-bold" onClick={()=>{
          if (pw === "XNAbaubauav1114!!!2") setAuthed(true); else alert("Incorrect password");
        }}>Enter</button>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-black">Admin — Statements</h1>
      <div className="space-y-2">
        <label className="block text-sm font-bold">Add new statement</label>
        <textarea className="w-full p-3 border-4 border-black" rows={3} placeholder="Type a new statement…" value={text} onChange={(e)=>setText(e.target.value)} />
        <button className="w-full p-3 border-4 border-black font-bold" onClick={()=>{
          if (!text.trim()) return;
          setDb((prev)=> ({ ...prev, statements: [{ id: uid("stmt"), text: text.trim() }, ...prev.statements] }));
          setText("");
        }}>Add statement</button>
      </div>

      <div className="grid gap-2">
        {db.statements.map((s)=> (
          <div key={s.id} className="p-2 border-2 border-black">
            <div className="font-bold">{s.text}</div>
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
    </section>
  );
}

// =============== Notifications (unchanged) ====================
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
