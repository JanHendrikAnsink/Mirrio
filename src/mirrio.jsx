// src/mirrio.jsx – Vollständige Supabase Integration
import React, { useEffect, useState } from "react";
import { supabase } from "./supabaseClient";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/react";

import {
  // Auth
  getUser, getUserId,
  // Profiles
  getProfile, upsertProfile,
  // Editions & Statements
  listEditions, listStatements,
  createEdition, renameEdition, changeEditionSlug, toggleEditionActive, deleteEdition,
  createStatement, updateStatementText, deleteStatement,
  // Groups
  listGroups, getGroup, createGroup, addGroupMember,
  // Rounds
  listRounds, getActiveRound, createRound, closeRound,
  // Votes
  submitVote, getVotes,
  // Comments
  listComments, createComment,
  // Leaderboard
  getLeaderboard, incrementPoints,
  // Statement selection
  rpcNextStatementForGroup, markStatementUsed,
  // Join group
  joinGroupByInvite
} from "./lib/supaApi";

const ADMIN_UUID = "be064bc9-0f03-4333-b832-688b8ba636d1";
const DAY = 24 * 60 * 60 * 1000;

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
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [view, setView] = useState(() => location.pathname === "/admin" ? "admin" : "login");
  const [activeGroupId, setActiveGroupId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Auth state management
  useEffect(() => {
    const initAuth = async () => {
      setLoading(true);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
          setUser(session.user);
          const prof = await getProfile(session.user.id);
          setProfile(prof);
          if (location.pathname !== "/admin") setView("groups");
        }
      } catch (e) {
        console.error("Auth init error:", e);
      } finally {
        setLoading(false);
      }
    };

    initAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session?.user) {
        setUser(session.user);
        const prof = await getProfile(session.user.id);
        setProfile(prof);
        if (location.pathname !== "/admin") setView("groups");
      } else {
        setUser(null);
        setProfile(null);
        if (location.pathname !== "/admin") setView("login");
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // Handle invite links
  useEffect(() => {
    const handleInvite = async () => {
      const params = new URLSearchParams(location.search);
      const inviteCode = params.get("invite");
      
      if (inviteCode && user) {
        try {
          await joinGroupByInvite(inviteCode);
          alert("Du wurdest zur Gruppe hinzugefügt!");
          // Clear invite from URL
          const url = new URL(location.href);
          url.searchParams.delete("invite");
          history.replaceState({}, "", url.toString());
          setView("groups");
        } catch (e) {
          console.error("Could not join group:", e);
        }
      }
    };

    if (user) handleInvite();
  }, [user]);

  // Navigation handling
  useEffect(() => {
    const onPop = () => setView(location.pathname === "/admin" ? "admin" : (user ? "groups" : "login"));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [user]);

  if (loading) {
    return (
      <div className="min-h-dvh bg-white grid place-items-center">
        <div className="text-center">
          <div className="font-black text-2xl mb-2">MIRRIO</div>
          <div className="text-sm opacity-70">Lädt...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-white text-black">
      <Header
        user={user}
        profile={profile}
        onSignOut={() => supabase.auth.signOut()}
        onGo={(v) => setView(v)}
      />

      <main className="mx-auto w-full max-w-md p-3 pb-24">
        {error && (
          <div className="mb-4 p-3 border-4 border-red-600 bg-red-50 text-red-700">
            {error}
          </div>
        )}

        {view === "login" && !user && <AuthView />}
        {view === "profile" && user && (
          <ProfileView user={user} profile={profile} onUpdate={() => location.reload()} />
        )}
        {view === "groups" && user && (
          <GroupsView user={user} setView={setView} setActiveGroupId={setActiveGroupId} />
        )}
        {view === "group" && activeGroupId && user && (
          <GroupDetail groupId={activeGroupId} user={user} setView={setView} />
        )}
        {view === "admin" && (
          <AdminView
            onExit={() => { 
              history.pushState({}, "", "/"); 
              setView(user ? "groups" : "login"); 
            }}
          />
        )}
      </main>

      {import.meta.env.PROD && (<><Analytics /><SpeedInsights /></>)}
    </div>
  );
}

function Header({ user, profile, onSignOut, onGo }) {
  const displayName = profile ? 
    `${profile.first_name || ""} ${profile.last_name || ""}`.trim() || user?.email : 
    user?.email;

  return (
    <header className="sticky top-0 z-10 bg-white border-b-4 border-black">
      <div className="mx-auto max-w-md flex items-center justify-between p-3">
        <div className="font-black text-xl tracking-tight">MIRRIO</div>
        {user && (
          <div className="flex items-center gap-2">
            <button className="px-2 py-1 border-2 border-black" onClick={() => onGo("groups")}>Groups</button>
          </div>
        )}
      </div>
      {user && (
        <div className="mx-auto max-w-md px-3 pb-2 flex items-center gap-3">
          <Avatar img={profile?.image_url} label={displayName} />
          <div className="text-xs">
            <div className="font-bold leading-tight">{displayName}</div>
            <div className="opacity-70">{user.email}</div>
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
        {img ? 
          <img src={img} alt="avatar" className="w-full h-full object-cover" /> : 
          <div className="w-full h-full grid place-items-center text-xs">🙂</div>
        }
      </div>
      {label && <span className="text-sm font-bold line-clamp-1">{label}</span>}
    </div>
  );
}

function AuthView() {
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
          <input 
            className="w-full p-3 border-4 border-black" 
            placeholder="you@example.com" 
            value={email} 
            onChange={(e) => setEmail(e.target.value)} 
          />
          <button
            className="w-full p-3 border-4 border-black font-bold disabled:opacity-60"
            disabled={sending}
            onClick={async () => {
              if (!email.includes("@")) return alert("Enter a valid email");
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
          <p className="text-xs opacity-70">We'll e-mail you a secure sign-in link.</p>
        </div>
      )}
      {step === "sent" && (
        <div className="space-y-3">
          <div className="p-3 border-4 border-black bg-black text-white text-sm break-all">
            We sent a link to <b>{sentTo}</b>. Check your inbox and click it.
          </div>
          <button 
            className="block w-full p-3 border-4 border-black text-center font-bold" 
            onClick={() => setStep("email")}
          >
            Use a different e-mail
          </button>
        </div>
      )}
    </section>
  );
}

function ProfileView({ user, profile, onUpdate }) {
  const [firstName, setFirstName] = useState(profile?.first_name || "");
  const [lastName, setLastName] = useState(profile?.last_name || "");
  const [imageUrl, setImageUrl] = useState(profile?.image_url || "");
  const [saving, setSaving] = useState(false);

  async function onPick(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    
    // For production, you should upload to Supabase Storage
    // For now, we'll use data URLs (limited to small images)
    const reader = new FileReader();
    reader.onload = () => setImageUrl(reader.result);
    reader.readAsDataURL(file);
  }

  async function handleSave() {
    setSaving(true);
    try {
      await upsertProfile({
        id: user.id,
        email: user.email,
        firstName,
        lastName,
        imageUrl
      });
      alert("Profile saved!");
      onUpdate();
    } catch (e) {
      alert("Error saving profile: " + e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-black">Your profile</h1>
      <div className="grid grid-cols-3 gap-3 items-center">
        <div className="col-span-1">
          <Avatar img={imageUrl} size={64} label={firstName || user.email} />
        </div>
        <div className="col-span-2 text-xs opacity-70">
          Upload a square image for best results.
        </div>
      </div>
      <div className="space-y-2">
        <label className="block text-sm font-bold">First name</label>
        <input 
          className="w-full p-3 border-4 border-black" 
          value={firstName} 
          onChange={(e) => setFirstName(e.target.value)} 
        />
        <label className="block text-sm font-bold">Last name</label>
        <input 
          className="w-full p-3 border-4 border-black" 
          value={lastName} 
          onChange={(e) => setLastName(e.target.value)} 
        />
        <label className="block text-sm font-bold">Profile picture</label>
        <input 
          className="w-full p-3 border-4 border-black" 
          type="file" 
          accept="image/*" 
          onChange={onPick} 
        />
        <button 
          className="w-full p-3 border-4 border-black font-bold disabled:opacity-60" 
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? "Saving..." : "Save"}
        </button>
      </div>
    </section>
  );
}

function GroupsView({ user, setView, setActiveGroupId }) {
  const [groups, setGroups] = useState([]);
  const [editions, setEditions] = useState([]);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      const [grps, eds] = await Promise.all([listGroups(), listEditions()]);
      setGroups(grps);
      setEditions(eds.filter(e => e.active));
    } catch (e) {
      console.error("Error loading data:", e);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateGroup() {
    if (!name.trim()) return alert("Name required");
    
    const activeEdition = editions.find(e => e.active);
    if (!activeEdition) {
      return alert("No active edition available. Please contact admin.");
    }

    setCreating(true);
    try {
      await createGroup({ name: name.trim(), editionId: activeEdition.id });
      setName("");
      await loadData();
    } catch (e) {
      alert("Error creating group: " + e.message);
    } finally {
      setCreating(false);
    }
  }

  if (loading) return <div className="text-center py-8">Loading groups...</div>;

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-black">Your groups</h1>

      <div className="space-y-2">
        <label className="block text-sm font-bold">Create a new group</label>
        <input 
          className="w-full p-3 border-4 border-black" 
          placeholder="Group name" 
          value={name} 
          onChange={(e) => setName(e.target.value)} 
        />
        <button
          className="w-full p-3 border-4 border-black font-bold disabled:opacity-60"
          onClick={handleCreateGroup}
          disabled={creating || editions.length === 0}
        >
          {creating ? "Creating..." : "Create group"}
        </button>
      </div>

      <div className="grid gap-3">
        {groups.map(g => (
          <div key={g.id} className="p-3 border-4 border-black">
            <div className="flex items-center gap-2">
              <div className="font-extrabold text-lg">{g.name}</div>
              <span className="ml-auto text-xs px-2 py-0.5 border-2 border-black">
                {g.group_members?.length || 0} members
              </span>
            </div>
            <div className="text-xs mt-1 opacity-70">
              Edition: {g.editions?.name || "—"}
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button 
                className="p-2 border-2 border-black" 
                onClick={() => { 
                  setActiveGroupId(g.id); 
                  setView("group"); 
                }}
              >
                Open
              </button>
              <InviteButton groupId={g.id} />
            </div>
          </div>
        ))}
        {groups.length === 0 && (
          <p className="text-sm opacity-70">
            No groups yet. Create one and invite your friends.
          </p>
        )}
      </div>
    </section>
  );
}

function InviteButton({ groupId }) {
  const [copied, setCopied] = useState(false);
  
  const inviteURL = `${location.origin}?invite=${groupId}`;

  return (
    <button 
      className="p-2 border-2 border-black" 
      onClick={() => {
        navigator.clipboard.writeText(inviteURL);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? "Link copied" : "Copy invite"}
    </button>
  );
}

function GroupDetail({ groupId, user, setView }) {
  const [group, setGroup] = useState(null);
  const [rounds, setRounds] = useState([]);
  const [activeRound, setActiveRound] = useState(null);
  const [leaderboard, setLeaderboard] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);

  useTicker(1000); // For countdown timer

  useEffect(() => {
    loadGroupData();
  }, [groupId, refresh]);

  async function loadGroupData() {
    setLoading(true);
    try {
      const [grp, rnds, active, board] = await Promise.all([
        getGroup(groupId),
        listRounds(groupId),
        getActiveRound(groupId),
        getLeaderboard(groupId)
      ]);
      
      setGroup(grp);
      setRounds(rnds);
      setActiveRound(active);
      setLeaderboard(board);
    } catch (e) {
      console.error("Error loading group:", e);
    } finally {
      setLoading(false);
    }
  }

  async function handleStartNewRound() {
    try {
      const stmt = await rpcNextStatementForGroup(groupId);
      if (!stmt) {
        alert("Keine unbenutzten Statements in dieser Edition.");
        return;
      }

      await createRound({
        groupId,
        statementId: stmt.id,
        expiresIn: DAY
      });

      await markStatementUsed(groupId, stmt.id);
      setRefresh(r => r + 1);
    } catch (e) {
      alert("Error starting round: " + e.message);
    }
  }

  async function checkAndCloseRound() {
    if (!activeRound) return;
    
    const now = new Date();
    const expires = new Date(activeRound.expires_at);
    
    if (now > expires || activeRound.votes?.length >= group.group_members?.length) {
      // Calculate winner
      const voteCounts = {};
      activeRound.votes?.forEach(v => {
        if (v.target) {
          voteCounts[v.target] = (voteCounts[v.target] || 0) + 1;
        }
      });
      
      const maxVotes = Math.max(0, ...Object.values(voteCounts));
      const winners = Object.entries(voteCounts)
        .filter(([, count]) => count === maxVotes)
        .map(([userId]) => userId);
      
      const winner = winners.length === 1 ? winners[0] : null;
      
      try {
        await closeRound(activeRound.id, winner, maxVotes);
        setRefresh(r => r + 1);
      } catch (e) {
        console.error("Error closing round:", e);
      }
    }
  }

  useEffect(() => {
    checkAndCloseRound();
  }, [activeRound]);

  if (loading) return <div className="text-center py-8">Loading group...</div>;
  if (!group) return <div className="text-center py-8">Group not found</div>;

  const timeLeft = activeRound ? 
    Math.max(0, new Date(activeRound.expires_at).getTime() - Date.now()) : 0;

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <button 
          className="px-2 py-1 border-2 border-black"
          onClick={() => setView("groups")}
        >
          ← Back
        </button>
        <h1 className="text-2xl font-black">{group.name}</h1>
        <span className="ml-auto text-xs px-2 py-0.5 border-2 border-black">
          {group.group_members?.length || 0} members
        </span>
      </div>

      {/* Active Round or Start Button */}
      {!activeRound ? (
        <div className="p-3 border-4 border-black bg-yellow-200">
          <div className="font-bold">No active voting right now.</div>
          <button
            className="mt-2 w-full p-3 border-4 border-black font-bold"
            onClick={handleStartNewRound}
          >
            Start new round
          </button>
        </div>
      ) : (
        <div className="p-3 border-4 border-black">
          <div className="text-xs mb-1">
            Voting ends in <b>{humanTime(timeLeft)}</b>
          </div>
          <div className="font-extrabold text-lg">
            "{activeRound.statements?.text}"
          </div>
          <VotePanel 
            round={activeRound} 
            group={group}
            user={user} 
            onVoted={() => setRefresh(r => r + 1)}
          />
        </div>
      )}

      {/* Leaderboard */}
      <div className="p-3 border-4 border-black">
        <div className="font-extrabold mb-2">Leaderboard</div>
        <div className="grid gap-1">
          {leaderboard.map(({ profiles, points }, idx) => (
            <div key={profiles.id} className="flex items-center gap-2">
              <span className="w-6 text-right font-bold">{idx + 1}.</span>
              <span className="flex-1">
                {profiles.first_name || profiles.last_name ? 
                  `${profiles.first_name || ""} ${profiles.last_name || ""}`.trim() : 
                  profiles.email}
              </span>
              <span className="px-2 border-2 border-black">
                {points} pt{points === 1 ? "" : "s"}
              </span>
            </div>
          ))}
          {leaderboard.length === 0 && (
            <div className="text-sm opacity-70">No points yet</div>
          )}
        </div>
      </div>

      {/* History */}
      <div className="p-3 border-4 border-black">
        <div className="font-extrabold mb-2">Rounds</div>
        <div className="grid gap-3">
          {rounds.map(r => (
            <RoundHistoryItem 
              key={r.id} 
              round={r} 
              user={user}
              onComment={() => setRefresh(prev => prev + 1)}
            />
          ))}
          {rounds.length === 0 && (
            <div className="opacity-70 text-sm">No rounds yet.</div>
          )}
        </div>
      </div>

      {/* Members */}
      <div className="p-3 border-4 border-black">
        <div className="font-extrabold mb-2">Members</div>
        <div className="grid gap-2">
          {group.group_members?.map(({ profiles }) => (
            <div key={profiles.id} className="flex items-center gap-2">
              <Avatar 
                img={profiles.image_url} 
                label={profiles.first_name || profiles.last_name ? 
                  `${profiles.first_name || ""} ${profiles.last_name || ""}`.trim() : 
                  profiles.email}
              />
              <span className="ml-auto text-xs opacity-70">{profiles.email}</span>
            </div>
          ))}
        </div>
        <div className="mt-3">
          <InviteButton groupId={groupId} />
        </div>
      </div>
    </section>
  );
}

function VotePanel({ round, group, user, onVoted }) {
  const userVote = round.votes?.find(v => v.voter === user.id);
  const [selected, setSelected] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const remainingVotes = (group.group_members?.length || 0) - (round.votes?.length || 0);

  async function handleSubmit() {
    if (!selected) return alert("Select an option");
    
    setSubmitting(true);
    try {
      await submitVote({
        roundId: round.id,
        target: selected === "abstain" ? null : selected
      });
      onVoted();
    } catch (e) {
      alert("Error submitting vote: " + e.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (userVote) {
    const targetMember = group.group_members?.find(m => m.profiles.id === userVote.target);
    const targetName = targetMember ? 
      `${targetMember.profiles.first_name || ""} ${targetMember.profiles.last_name || ""}`.trim() || 
      targetMember.profiles.email : 
      "Abstain";
    
    return (
      <div className="mt-2 text-sm">
        You voted: <b>{targetName}</b>
        <div className="text-xs opacity-70 mt-1">
          Waiting on <b>{remainingVotes}</b> vote(s)...
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="text-sm opacity-70">
        Pick the person this statement fits best, or abstain.
      </div>
      <div className="mt-2 grid gap-2">
        {group.group_members
          ?.filter(m => m.profiles.id !== user.id)
          .map(m => (
            <label key={m.profiles.id} className="flex items-center gap-2 p-2 border-2 border-black">
              <input 
                type="radio" 
                name="vote" 
                value={m.profiles.id} 
                checked={selected === m.profiles.id} 
                onChange={() => setSelected(m.profiles.id)} 
              />
              <span className="font-bold">
                {m.profiles.first_name || m.profiles.last_name ? 
                  `${m.profiles.first_name || ""} ${m.profiles.last_name || ""}`.trim() : 
                  m.profiles.email}
              </span>
            </label>
          ))}
        <label className="flex items-center gap-2 p-2 border-2 border-black">
          <input 
            type="radio" 
            name="vote" 
            value="abstain" 
            checked={selected === "abstain"} 
            onChange={() => setSelected("abstain")} 
          />
          <span className="font-bold">Abstain</span>
        </label>
        <button 
          className="p-2 border-2 border-black font-bold disabled:opacity-60" 
          onClick={handleSubmit}
          disabled={submitting}
        >
          {submitting ? "Submitting..." : "Submit vote"}
        </button>
        <div className="text-xs opacity-70">
          Waiting on <b>{remainingVotes}</b> vote(s)...
        </div>
      </div>
    </div>
  );
}

function RoundHistoryItem({ round, user, onComment }) {
  const [comments, setComments] = useState([]);
  const [newComment, setNewComment] = useState("");
  const [showComments, setShowComments] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (showComments) loadComments();
  }, [showComments]);

  async function loadComments() {
    try {
      const cmts = await listComments(round.id);
      setComments(cmts);
    } catch (e) {
      console.error("Error loading comments:", e);
    }
  }

  async function handleComment() {
    if (!newComment.trim()) return;
    
    setSubmitting(true);
    try {
      await createComment({
        roundId: round.id,
        text: newComment.trim()
      });
      setNewComment("");
      await loadComments();
      onComment();
    } catch (e) {
      alert("Error posting comment: " + e.message);
    } finally {
      setSubmitting(false);
    }
  }

  const isClosed = !!round.round_results?.[0]?.closed_at;

  return (
    <div className={`p-2 border-2 border-black ${isClosed ? "bg-gray-100" : ""}`}>
      <div className="text-xs opacity-70">
        {new Date(round.issued_at).toLocaleString()}
      </div>
      <div className="font-bold">
        "{round.statements?.text}"
      </div>
      <div className="text-sm mt-1">
        {isClosed ? <i>Finished</i> : <i>Voting in progress…</i>}
      </div>
      
      {isClosed && (
        <>
          <button
            className="mt-2 text-xs underline"
            onClick={() => setShowComments(!showComments)}
          >
            {showComments ? "Hide" : "Show"} discussion ({comments.length})
          </button>
          
          {showComments && (
            <div className="mt-2 border-t-2 border-black pt-2">
              <div className="text-xs font-bold mb-1">Discussion</div>
              <div className="grid gap-1">
                {comments.map(c => (
                  <div key={c.id} className="text-sm">
                    <b>
                      {c.profiles.first_name || c.profiles.last_name ? 
                        `${c.profiles.first_name || ""} ${c.profiles.last_name || ""}`.trim() : 
                        c.profiles.email}:
                    </b> {c.text}
                  </div>
                ))}
              </div>
              <div className="mt-2 flex gap-2">
                <input 
                  className="flex-1 p-2 border-2 border-black" 
                  placeholder="Add a comment" 
                  value={newComment} 
                  onChange={(e) => setNewComment(e.target.value)} 
                />
                <button 
                  className="px-3 border-2 border-black disabled:opacity-60" 
                  onClick={handleComment}
                  disabled={submitting}
                >
                  {submitting ? "..." : "Post"}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** ===================== ADMIN VIEW ===================== **/
function AdminView({ onExit }) {
  const [passwordOk, setPasswordOk] = useState(false);
  const [pw, setPw] = useState("");

  const [user, setUser] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loadingAuth, setLoadingAuth] = useState(true);

  const [tab, setTab] = useState("editions");

  // data
  const [editions, setEditions] = useState([]);
  const [edsError, setEdsError] = useState("");
  const [edsLoading, setEdsLoading] = useState(false);

  const [selectedEditionId, setSelectedEditionId] = useState(null);
  const [statements, setStatements] = useState([]);
  const [stError, setStError] = useState("");
  const [stLoading, setStLoading] = useState(false);

  const redirectBase = import.meta.env.DEV ? "http://localhost:5173" : "https://mirrio.app";

  // ALL HOOKS MUST BE CALLED BEFORE ANY CONDITIONAL RETURNS
  // 2) supabase auth check
  useEffect(() => {
    if (!passwordOk) return; // Condition INSIDE the effect
    (async () => {
      setLoadingAuth(true);
      try {
        const u = await getUser();
        setUser(u);
        setIsAdmin(u?.id === ADMIN_UUID);
      } catch (e) {
        console.error(e);
      } finally {
        setLoadingAuth(false);
      }
    })();
  }, [passwordOk]);

  // 3) load editions when authed
  useEffect(() => {
    if (!passwordOk || !user) return; // Condition INSIDE the effect
    (async () => {
      setEdsLoading(true); 
      setEdsError("");
      try {
        const eds = await listEditions();
        setEditions(eds);
        if (!selectedEditionId && eds[0]?.id) setSelectedEditionId(eds[0].id);
      } catch (e) {
        setEdsError(e.message || "Could not load editions");
      } finally { 
        setEdsLoading(false); 
      }
    })();
  }, [passwordOk, user]);

  // 4) load statements when edition selected
  useEffect(() => {
    if (!passwordOk || !user || !selectedEditionId) { 
      setStatements([]); 
      return; 
    }
    (async () => {
      setStLoading(true); 
      setStError("");
      try {
        const sts = await listStatements({ editionId: selectedEditionId });
        setStatements(sts);
      } catch (e) {
        setStError(e.message || "Could not load statements");
      } finally { 
        setStLoading(false); 
      }
    })();
  }, [passwordOk, user, selectedEditionId]);

  // 1) password gate - NOW AFTER ALL HOOKS
  if (!passwordOk) {
    return (
      <section className="space-y-4">
        <h1 className="text-2xl font-black">Admin</h1>
        <input 
          className="w-full p-3 border-4 border-black" 
          type="password" 
          placeholder="Password" 
          value={pw} 
          onChange={(e) => setPw(e.target.value)} 
        />
        <div className="grid grid-cols-2 gap-2">
          <button 
            className="w-full p-3 border-4 border-black font-bold" 
            onClick={() => {
              if (pw === "XNAbaubauav1114!!!2") setPasswordOk(true); 
              else alert("Incorrect password");
            }}
          >
            Enter
          </button>
          <button className="w-full p-3 border-4 border-black" onClick={onExit}>
            Exit
          </button>
        </div>
      </section>
    );
  }

  // If not signed in
  if (!loadingAuth && !user) {
    return (
      <section className="space-y-4">
        <h1 className="text-2xl font-black">Admin</h1>
        <div className="p-3 border-4 border-black bg-yellow-100 text-sm">
          You must be signed in to view and edit content.
        </div>
        <AdminInlineLogin redirectBase={redirectBase} />
        <button className="px-2 py-1 border-2 border-black" onClick={onExit}>
          Exit
        </button>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-black">Admin</h1>
        <div className="text-xs">
          {user ? (
            <>
              Signed in as <b>{user.email}</b> {isAdmin ? "(admin)" : "(read-only)"}
            </>
          ) : (
            "Not signed in"
          )}
        </div>
      </div>

      <div className="flex gap-2">
        <button 
          className={`px-2 py-1 border-2 border-black ${tab === "editions" ? "bg-black text-white" : ""}`} 
          onClick={() => setTab("editions")}
        >
          Editions
        </button>
        <button 
          className={`px-2 py-1 border-2 border-black ${tab === "statements" ? "bg-black text-white" : ""}`} 
          onClick={() => setTab("statements")}
        >
          Statements
        </button>
        <div className="ml-auto flex gap-2">
          <button 
            className="px-2 py-1 border-2 border-black" 
            onClick={async () => { 
              await supabase.auth.signOut(); 
              location.reload(); 
            }}
          >
            Sign out
          </button>
          <button className="px-2 py-1 border-2 border-black" onClick={onExit}>
            Exit
          </button>
        </div>
      </div>

      {tab === "editions" && (
        <AdminEditionsTab
          editions={editions}
          loading={edsLoading}
          error={edsError}
          isAdmin={isAdmin}
          onReload={async () => {
            const eds = await listEditions();
            setEditions(eds);
            if (!selectedEditionId && eds[0]?.id) setSelectedEditionId(eds[0].id);
          }}
        />
      )}

      {tab === "statements" && (
        <AdminStatementsTab
          editions={editions}
          selectedEditionId={selectedEditionId}
          onSelectEdition={setSelectedEditionId}
          statements={statements}
          loading={stLoading}
          error={stError}
          isAdmin={isAdmin}
          onReload={async () => {
            if (!selectedEditionId) return;
            const sts = await listStatements({ editionId: selectedEditionId });
            setStatements(sts);
          }}
        />
      )}
    </section>
  );
}

function AdminInlineLogin({ redirectBase }) {
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  
  return (
    <div className="space-y-2">
      <label className="block text-sm font-bold">E-mail</label>
      <input 
        className="w-full p-3 border-4 border-black" 
        placeholder="you@example.com" 
        value={email} 
        onChange={(e) => setEmail(e.target.value)} 
      />
      <button
        className="w-full p-3 border-4 border-black font-bold disabled:opacity-60"
        disabled={sending}
        onClick={async () => {
          if (!email.includes("@")) return alert("Enter a valid email");
          setSending(true);
          const { error } = await supabase.auth.signInWithOtp({
            email: email.trim(),
            options: { emailRedirectTo: redirectBase },
          });
          setSending(false);
          if (error) return alert(error.message);
          alert("Magic link sent. Please open it and return to /admin.");
        }}
      >
        {sending ? "Sending…" : "Send Magic Link"}
      </button>
      <div className="text-xs opacity-70">
        After clicking the link, return to <code>/admin</code>.
      </div>
    </div>
  );
}

function AdminEditionsTab({ editions, loading, error, isAdmin, onReload }) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");

  return (
    <div className="space-y-4">
      <div className="p-3 border-4 border-black bg-black text-white text-sm">
        RLS: Only the admin user can write. You can still read if authenticated.
      </div>
      {error && (
        <div className="p-2 border-2 border-red-600 text-red-700 text-sm">{error}</div>
      )}
      {loading ? (
        <div>Loading…</div>
      ) : (
        <div className="grid gap-2">
          {editions.map(ed => (
            <EditionRow key={ed.id} ed={ed} isAdmin={isAdmin} onChanged={onReload} />
          ))}
          {editions.length === 0 && <div className="opacity-70">No editions found.</div>}
        </div>
      )}

      <div className="border-t-4 border-black pt-3">
        <div className="font-bold mb-2">Add edition</div>
        <div className="grid gap-2">
          <input 
            className="p-2 border-2 border-black" 
            placeholder="Name" 
            value={name} 
            onChange={(e) => setName(e.target.value)} 
          />
          <input 
            className="p-2 border-2 border-black" 
            placeholder="slug (unique)" 
            value={slug} 
            onChange={(e) => setSlug(e.target.value)} 
          />
          <button 
            className="p-2 border-2 border-black font-bold disabled:opacity-50" 
            disabled={!isAdmin} 
            onClick={async () => {
              if (!isAdmin) return alert("Admin only");
              if (!name.trim() || !slug.trim()) return alert("Enter name and slug");
              await createEdition({ name: name.trim(), slug: slug.trim() });
              setName(""); 
              setSlug("");
              await onReload();
            }}
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}

function EditionRow({ ed, isAdmin, onChanged }) {
  const [name, setName] = useState(ed.name);
  const [slug, setSlug] = useState(ed.slug);
  const [active, setActive] = useState(!!ed.active);
  
  return (
    <div className="p-2 border-2 border-black">
      <div className="text-sm">ID: <code>{ed.id}</code></div>
      <div className="grid grid-cols-2 gap-2 mt-2">
        <input 
          className="p-2 border-2 border-black" 
          value={name} 
          onChange={(e) => setName(e.target.value)} 
        />
        <input 
          className="p-2 border-2 border-black" 
          value={slug} 
          onChange={(e) => setSlug(e.target.value)} 
        />
      </div>
      <div className="mt-2 flex items-center gap-2">
        <label className="flex items-center gap-2 text-sm">
          <input 
            type="checkbox" 
            checked={active} 
            onChange={(e) => setActive(e.target.checked)} 
          />
          Active
        </label>
        <div className="ml-auto flex gap-2">
          <button 
            className="px-2 py-1 border-2 border-black disabled:opacity-50" 
            disabled={!isAdmin} 
            onClick={async () => {
              if (!isAdmin) return;
              await renameEdition(ed.id, name.trim());
              await changeEditionSlug(ed.id, slug.trim());
              await toggleEditionActive(ed.id, active);
              await onChanged();
            }}
          >
            Save
          </button>
          <button 
            className="px-2 py-1 border-2 border-black disabled:opacity-50" 
            disabled={!isAdmin} 
            onClick={async () => {
              if (!isAdmin) return;
              if (!confirm("Delete edition?")) return;
              await deleteEdition(ed.id);
              await onChanged();
            }}
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

function AdminStatementsTab({ editions, selectedEditionId, onSelectEdition, statements, loading, error, isAdmin, onReload }) {
  const [text, setText] = useState("");

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <label className="text-sm font-bold">Edition</label>
        <select 
          className="p-2 border-2 border-black" 
          value={selectedEditionId || ""} 
          onChange={(e) => onSelectEdition(e.target.value || null)}
        >
          {editions.map(ed => (
            <option key={ed.id} value={ed.id}>{ed.name}</option>
          ))}
        </select>
      </div>

      {error && (
        <div className="p-2 border-2 border-red-600 text-red-700 text-sm">{error}</div>
      )}
      {loading ? (
        <div>Loading…</div>
      ) : (
        <div className="grid gap-2">
          {statements.map(st => (
            <StatementRow key={st.id} st={st} isAdmin={isAdmin} onChanged={onReload} />
          ))}
          {statements.length === 0 && (
            <div className="opacity-70">No statements in this edition.</div>
          )}
        </div>
      )}

      <div className="border-t-4 border-black pt-3">
        <div className="font-bold mb-2">Add statement</div>
        <div className="grid gap-2">
          <textarea 
            className="p-2 border-2 border-black" 
            rows={3} 
            placeholder="Statement text…" 
            value={text} 
            onChange={(e) => setText(e.target.value)} 
          />
          <button 
            className="p-2 border-2 border-black font-bold disabled:opacity-50" 
            disabled={!isAdmin || !selectedEditionId} 
            onClick={async () => {
              if (!isAdmin) return alert("Admin only");
              if (!text.trim()) return alert("Enter text");
              await createStatement({ text: text.trim(), editionId: selectedEditionId });
              setText("");
              await onReload();
            }}
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}

function StatementRow({ st, isAdmin, onChanged }) {
  const [text, setText] = useState(st.text || "");
  
  return (
    <div className="p-2 border-2 border-black">
      <div className="text-xs opacity-70 mb-1">ID: <code>{st.id}</code></div>
      <textarea 
        className="w-full p-2 border-2 border-black" 
        rows={2} 
        value={text} 
        onChange={(e) => setText(e.target.value)} 
      />
      <div className="mt-2 flex gap-2 justify-end">
        <button 
          className="px-2 py-1 border-2 border-black disabled:opacity-50" 
          disabled={!isAdmin} 
          onClick={async () => {
            if (!isAdmin) return;
            await updateStatementText(st.id, text.trim());
            await onChanged();
          }}
        >
          Save
        </button>
        <button 
          className="px-2 py-1 border-2 border-black disabled:opacity-50" 
          disabled={!isAdmin} 
          onClick={async () => {
            if (!isAdmin) return;
            if (!confirm("Delete statement?")) return;
            await deleteStatement(st.id);
            await onChanged();
          }}
        >
          Delete
        </button>
      </div>
    </div>
  );
}