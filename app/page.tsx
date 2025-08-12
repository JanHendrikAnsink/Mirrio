"use client";
import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";

function uid(prefix = "id") {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}
const HOUR = 60 * 60 * 1000; const DAY = 24 * HOUR;
function humanTime(ms: number) {
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

export default function App() {
  const [session, setSession] = useState<any>(null);
  const [view, setView] = useState<"login"|"profile"|"groups"|"group"|"admin">("login");
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setView(data.session? "groups":"login"); });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => { setSession(s); setView(s? "groups":"login"); });
    return () => sub.subscription.unsubscribe();
  }, []);

  // Auto-join via invite link (client-side insert to membership)
  useEffect(() => {
    const url = new URL(location.href);
    const invite = url.searchParams.get("invite");
    if (invite && session) {
      (async () => {
        const user = (await supabase.auth.getUser()).data.user!;
        await supabase.from("group_members").upsert({ group_id: invite, user_id: user.id });
        url.searchParams.delete("invite"); history.replaceState({}, "", url.toString());
        setActiveGroupId(invite); setView("group");
      })();
    }
  }, [session]);

  const email = session?.user?.email as string | undefined;

  return (
    <div>
      <Header email={email} onGo={setView} onSignOut={() => supabase.auth.signOut()} />
      <main className="mx-auto w-full max-w-md p-3 pb-24">
        {view === "login" && <AuthView />}
        {view === "profile" && email && <ProfileView />}
        {view === "groups" && email && (
          <GroupsView onOpen={(gid)=>{ setActiveGroupId(gid); setView("group"); }} />
        )}
        {view === "group" && activeGroupId && email && (
          <GroupDetail groupId={activeGroupId} />
        )}
        {view === "admin" && <AdminView />}
      </main>
    </div>
  );
}

function Header({ email, onGo, onSignOut }: { email?: string, onGo: (v:any)=>void, onSignOut: ()=>void }) {
  return (
    <header className="sticky top-0 z-10 bg-white border-b-4 border-black">
      <div className="mx-auto max-w-md flex items-center justify-between p-3">
        <div className="font-black text-xl tracking-tight">MIRRIO</div>
        <div className="flex items-center gap-2">
          {email && (<button className="px-2 py-1 border-2 border-black active:translate-y-0.5" onClick={()=>onGo("groups")}>Groups</button>)}
          <button className="px-2 py-1 border-2 border-black active:translate-y-0.5" onClick={()=>onGo("admin")}>☰</button>
        </div>
      </div>
      {email && (
        <div className="mx-auto max-w-md px-3 pb-2 flex items-center gap-3">
          <div className="text-xs">
            <div className="font-bold leading-tight">{email}</div>
            <div className="opacity-70">Signed in</div>
          </div>
          <div className="flex-1" />
          <button className="px-2 py-1 border-2 border-black" onClick={()=>onGo("profile")}>Profile</button>
          <button className="px-2 py-1 border-2 border-black" onClick={onSignOut}>Sign out</button>
        </div>
      )}
    </header>
  );
}

function AuthView() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-black">Sign in</h1>
      {!sent && (
        <div className="space-y-2">
          <label className="block text-sm font-bold">E-mail</label>
          <input className="w-full p-3 border-4 border-black" placeholder="you@example.com" value={email} onChange={(e)=>setEmail(e.target.value)} />
          <button className="w-full p-3 border-4 border-black font-bold active:translate-y-0.5" onClick={async()=>{
            if (!email.includes("@")) return alert("Enter a valid email");
            const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin } });
            if (error) return alert(error.message);
            setSent(email);
          }}>Send Magic Link</button>
          <p className="text-xs opacity-70">We send a magic link to your inbox.</p>
        </div>
      )}
      {sent && (
        <div className="space-y-2">
          <div className="p-3 border-4 border-black bg-black text-white text-sm">Check <b>{sent}</b> for the link.</div>
          <button className="w-full p-3 border-4 border-black" onClick={()=>setSent(null)}>Use a different e-mail</button>
        </div>
      )}
    </section>
  );
}

function ProfileView() {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [img, setImg] = useState<string>("");
  useEffect(()=>{ (async()=>{
    const { data } = await supabase.from("profiles").select("first_name,last_name,avatar_url").eq("id", (await supabase.auth.getUser()).data.user?.id).maybeSingle();
    if (data) { setFirstName(data.first_name||""); setLastName(data.last_name||""); setImg(data.avatar_url||""); }
  })(); },[]);

  async function onPickImage(e: any) {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader(); reader.onload = () => setImg(reader.result as string); reader.readAsDataURL(file);
  }

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-black">Your profile</h1>
      <div className="space-y-2">
        <label className="block text-sm font-bold">First name</label>
        <input className="w-full p-3 border-4 border-black" value={firstName} onChange={(e)=>setFirstName(e.target.value)} />
        <label className="block text-sm font-bold">Last name</label>
        <input className="w-full p-3 border-4 border-black" value={lastName} onChange={(e)=>setLastName(e.target.value)} />
        <label className="block text-sm font-bold">Profile picture</label>
        <input className="w-full p-3 border-4 border-black" type="file" accept="image/*" onChange={onPickImage} />
        <button className="w-full p-3 border-4 border-black font-bold active:translate-y-0.5" onClick={async()=>{
          const user = (await supabase.auth.getUser()).data.user!;
          const { error } = await supabase.from("profiles").upsert({ id: user.id, first_name: firstName, last_name: lastName, avatar_url: img });
          if (error) return alert(error.message); alert("Profile saved.");
        }}>Save</button>
      </div>
    </section>
  );
}

function GroupsView({ onOpen }: { onOpen: (gid:string)=>void }) {
  const [groups, setGroups] = useState<any[]>([]);
  const [name, setName] = useState("");
  useEffect(()=>{ (async()=>{
    const { data, error } = await supabase.rpc("my_groups");
    if (error) console.error(error); setGroups(data||[]);
  })(); },[]);

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-black">Your groups</h1>
      <div className="space-y-2">
        <label className="block text-sm font-bold">Create a new group</label>
        <input className="w-full p-3 border-4 border-black" placeholder="Group name" value={name} onChange={(e)=>setName(e.target.value)} />
        <button className="w-full p-3 border-4 border-black font-bold active:translate-y-0.5" onClick={async()=>{
          if (!name.trim()) return alert("Name required");
          const { data, error } = await supabase.rpc("create_group", { p_name: name.trim() });
          if (error) return alert(error.message); setName(""); setGroups([data, ...groups]);
        }}>Create group</button>
      </div>

      <div className="grid gap-3">
        {groups.map((g)=> (
          <div key={g.id} className="p-3 border-4 border-black">
            <div className="flex items-center gap-2">
              <div className="font-extrabold text-lg">{g.name}</div>
              <span className="ml-auto text-xs px-2 py-0.5 border-2 border-black">{g.member_count} members</span>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button className="p-2 border-2 border-black" onClick={()=>onOpen(g.id)}>Open</button>
              <InviteButton groupId={g.id} />
            </div>
          </div>
        ))}
        {groups.length===0 && <p className="text-sm opacity-70">No groups yet. Create one and invite your friends.</p>}
      </div>
    </section>
  );
}

function InviteButton({ groupId }: { groupId: string }) {
  const [copied, setCopied] = useState(false);
  const inviteURL = useMemo(()=>{ const url = new URL(location.href); url.searchParams.set("invite", groupId); return url.toString(); }, [groupId]);
  return (
    <button className="p-2 border-2 border-black" onClick={()=>{ navigator.clipboard.writeText(inviteURL); setCopied(true); setTimeout(()=>setCopied(false),1500); }}>{copied? "Link copied":"Copy invite"}</button>
  );
}

function GroupDetail({ groupId }: { groupId: string }) {
  const [group, setGroup] = useState<any|null>(null);
  const [round, setRound] = useState<any|null>(null);
  const [leaderboard, setLeaderboard] = useState<any[]>([]);
  const [comments, setComments] = useState<any[]>([]);
  const [text, setText] = useState("");
  useTicker(1000);

  async function loadAll() {
    const { data: g } = await supabase.from("groups").select("id,name").eq("id", groupId).single();
    setGroup(g);
    const { data: gs } = await supabase.from("group_statements").select("id,statement_id,issued_at,closes_at,status").eq("group_id", groupId).order("issued_at", { ascending: false }).limit(1);
    const r = gs?.[0] || null; setRound(r);
    const { data: lb } = await supabase.from("points").select("user_id,points").eq("group_id", groupId).order("points", { ascending: false });
    setLeaderboard(lb||[]);
    if (r) {
      const { data: cs } = await supabase.from("comments").select("author_id,body,created_at").eq("group_statement_id", r.id).order("created_at", { ascending: true });
      setComments(cs||[]);
    } else setComments([]);
  }
  useEffect(()=>{ loadAll(); }, [groupId]);

  const timeLeft = round ? Math.max(0, new Date(round.closes_at).getTime() - Date.now()) : 0;

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2"><h1 className="text-2xl font-black">{group?.name||"Group"}</h1></div>

      {!round || round.status!=="open" ? (
        <div className="p-3 border-4 border-black bg-yellow-200">
          <div className="font-bold">No active voting right now.</div>
          <button className="mt-2 w-full p-3 border-4 border-black font-bold active:translate-y-0.5" onClick={async()=>{
            const { error } = await supabase.rpc("issue_new_statement", { p_group_id: groupId });
            if (error) return alert(error.message); await loadAll();
          }}>Start first circle</button>
        </div>
      ) : (
        <div className="p-3 border-4 border-black">
          <div className="text-xs mb-1">Voting ends in <b>{humanTime(timeLeft)}</b></div>
          <StatementText statementId={round.statement_id} />
          <VotePanel groupId={groupId} groupStatementId={round.id} onVoted={loadAll} />
        </div>
      )}

      <div className="p-3 border-4 border-black">
        <div className="font-extrabold mb-2">Leaderboard</div>
        <div className="grid gap-1">
          {leaderboard.map((row, idx)=> (
            <div key={row.user_id} className="flex items-center gap-2">
              <span className="w-6 text-right font-bold">{idx+1}.</span>
              <span className="flex-1">{row.user_id}</span>
              <span className="px-2 border-2 border-black">{row.points} pt{row.points===1?"":"s"}</span>
            </div>
          ))}
        </div>
      </div>

      {round && (
        <div className="p-3 border-4 border-black">
          <div className="text-xs font-bold mb-1">Discussion</div>
          <div className="grid gap-1">{comments.map((c,i)=>(<div key={i} className="text-sm"><b>{c.author_id}:</b> {c.body}</div>))}</div>
          <div className="mt-2 flex gap-2">
            <input className="flex-1 p-2 border-2 border-black" placeholder="Add a comment" value={text} onChange={(e)=>setText(e.target.value)} />
            <button className="px-3 border-2 border-black" onClick={async()=>{
              if (!text.trim()) return;
              const user = (await supabase.auth.getUser()).data.user!;
              const { error } = await supabase.from("comments").insert({ group_statement_id: round.id, author_id: user.id, body: text.trim() });
              if (error) return alert(error.message); setText("");
              const { data: cs } = await supabase.from("comments").select("author_id,body,created_at").eq("group_statement_id", round.id).order("created_at", { ascending: true });
              setComments(cs||[]);
            }}>Post</button>
          </div>
        </div>
      )}
    </section>
  );
}

function StatementText({ statementId }: { statementId: string }) {
  const [text, setText] = useState<string>("");
  useEffect(()=>{ (async()=>{
    const { data } = await supabase.from("statements").select("text").eq("id", statementId).single();
    setText(data?.text||"[deleted statement]");
  })(); },[statementId]);
  return <div className="font-extrabold text-lg">“{text}”</div>;
}

function VotePanel({ groupId, groupStatementId, onVoted }: { groupId:string, groupStatementId:string, onVoted:()=>void }) {
  const [members, setMembers] = useState<any[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [hasVoted, setHasVoted] = useState(false);

  useEffect(()=>{ (async()=>{
    const { data: m } = await supabase.from("group_members").select("user_id").eq("group_id", groupId);
    setMembers(m||[]);
    const { data: v } = await supabase.from("votes").select("voter_id").eq("group_statement_id", groupStatementId).eq("voter_id", (await supabase.auth.getUser()).data.user?.id);
    setHasVoted((v||[]).length>0);
  })(); },[groupId, groupStatementId]);

  if (hasVoted) return <div className="mt-2 text-sm">Thanks! Your vote is in.</div>;

  return (
    <div>
      <div className="text-sm opacity-70">Pick the person this statement fits best, or abstain.</div>
      <div className="mt-2 grid gap-2">
        {members.map((m)=> (
          <label key={m.user_id} className="flex items-center gap-2 p-2 border-2 border-black">
            <input type="radio" name="vote" value={m.user_id} checked={selected===m.user_id} onChange={()=>setSelected(m.user_id)} />
            <span className="font-bold">{m.user_id}</span>
          </label>
        ))}
        <label className="flex items-center gap-2 p-2 border-2 border-black">
          <input type="radio" name="vote" value="abstain" checked={selected==="abstain"} onChange={()=>setSelected("abstain")} />
          <span className="font-bold">Abstain</span>
        </label>
        <button className="p-2 border-2 border-black font-bold active:translate-y-0.5" onClick={async()=>{
          if (!selected) return alert("Select an option");
          const user = (await supabase.auth.getUser()).data.user!;
          const payload: any = { group_statement_id: groupStatementId, voter_id: user.id };
          if (selected === "abstain") { payload.abstain = true; payload.target_user_id = null; }
          else { payload.abstain = false; payload.target_user_id = selected; }
          const { error } = await supabase.from("votes").insert(payload);
          if (error) return alert(error.message);
          await supabase.rpc("maybe_close_round", { p_gs: groupStatementId });
          onVoted();
        }}>Submit vote</button>
      </div>
    </div>
  );
}

function AdminView() {
  const [pw, setPw] = useState("");
  const [text, setText] = useState("");
  const [items, setItems] = useState<any[]>([]);

  async function load() {
    const res = await fetch("/api/admin/statements", { headers: { "x-admin-token": pw } });
    if (res.ok) setItems(await res.json()); else alert("Forbidden");
  }

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-black">Admin — Statements</h1>
      <input className="w-full p-3 border-4 border-black" type="password" placeholder="Password" value={pw} onChange={(e)=>setPw(e.target.value)} />
      <div className="grid grid-cols-2 gap-2">
        <button className="p-2 border-2 border-black" onClick={load}>Load</button>
        <button className="p-2 border-2 border-black" onClick={async()=>{
          if (!text.trim()) return;
          const res = await fetch("/api/admin/statements", { method:"POST", headers: { "Content-Type":"application/json", "x-admin-token": pw }, body: JSON.stringify({ text: text.trim() }) });
          if (!res.ok) return alert("Error");
          setText(""); load();
        }}>Add</button>
      </div>
      <textarea className="w-full p-3 border-4 border-black" rows={3} placeholder="Type a new statement…" value={text} onChange={(e)=>setText(e.target.value)} />
      <div className="grid gap-2">
        {items.map((s:any)=> (
          <div key={s.id} className="p-2 border-2 border-black">
            <div className="font-bold">{s.text}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
