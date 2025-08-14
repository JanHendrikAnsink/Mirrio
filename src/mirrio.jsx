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
  renameGroup, deleteGroup, leaveGroup,
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

const ADMIN_UUID = "5744d1ce-d6f5-42fb-9f0e-5e9126b845ca";
const DAY = 2 * 60 * 1000;

function humanTime(ms) {
  if (ms <= 0) return "0s";
  
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / (60 * 60 * 24));
  const hours = Math.floor((totalSeconds % (60 * 60 * 24)) / (60 * 60));
  const minutes = Math.floor((totalSeconds % (60 * 60)) / 60);
  const seconds = totalSeconds % 60;
  
  if (days > 0) {
    return `${days}d ${hours}h ${minutes}m ${seconds}s`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
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
  const [view, setView] = useState(() => location.pathname === "/admin" ? "admin" : "home");
  const [activeGroupId, setActiveGroupId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);

  // Set page title and meta description
  useEffect(() => {
    document.title = "Mirrio – Playfully understand each other better";
    
    // Set meta description
    let metaDescription = document.querySelector('meta[name="description"]');
    if (!metaDescription) {
      metaDescription = document.createElement('meta');
      metaDescription.name = 'description';
      document.head.appendChild(metaDescription);
    }
    metaDescription.content = "Discover your strengths, quirks, and special moments together with Mirrio. Playful, anonymous, and kind – for deeper conversations, more understanding, and stronger bonds.";
    
    // Add global styles for cursor pointer on all buttons
    const style = document.createElement('style');
    style.textContent = `
      button { cursor: pointer; }
      input[type="radio"] { cursor: pointer; }
      input[type="checkbox"] { cursor: pointer; }
      select { cursor: pointer; }
      label:has(input[type="radio"]) { cursor: pointer; }
      label:has(input[type="checkbox"]) { cursor: pointer; }
    `;
    document.head.appendChild(style);
    
    return () => {
      if (style.parentNode) {
        style.parentNode.removeChild(style);
      }
    };
  }, []);

  // Auth state management
  useEffect(() => {
    const initAuth = async () => {
      setLoading(true);
      try {
        // Check for auth params in URL (from magic link)
        const hashParams = new URLSearchParams(window.location.hash.substring(1));
        const accessToken = hashParams.get('access_token');
        
        if (accessToken) {
          console.log('Magic link token detected, processing...');
          // Let Supabase handle the token
          const { data: { session }, error } = await supabase.auth.getSession();
          
          if (error) {
            console.error('Error processing magic link:', error);
            setError(error.message);
          } else if (session?.user) {
            console.log('Magic link login successful:', session.user.email);
            setUser(session.user);
            
            // Try to load profile, but don't block on failure
            try {
              const prof = await getProfile(session.user.id);
              if (prof) {
                setProfile(prof);
              } else {
                console.log('No profile yet, creating default');
                // Auto-create profile if it doesn't exist
                await upsertProfile({
                  id: session.user.id,
                  email: session.user.email,
                  firstName: '',
                  lastName: '',
                  imageUrl: ''
                });
              }
            } catch (e) {
              console.error('Profile handling error:', e);
              // Continue anyway
            }
            
            // Clean up URL
            window.history.replaceState({}, document.title, window.location.pathname);
            
            if (location.pathname !== "/admin") setView("groups");
          }
        } else {
          // Normal session check
          const { data: { session }, error } = await supabase.auth.getSession();
          
          if (error) {
            console.error('Session error:', error);
          } else if (session?.user) {
            console.log('Existing session found:', session.user.email);
            setUser(session.user);
            
            try {
              const prof = await getProfile(session.user.id);
              if (prof) {
                setProfile(prof);
              } else {
                // Auto-create profile if it doesn't exist
                await upsertProfile({
                  id: session.user.id,
                  email: session.user.email,
                  firstName: '',
                  lastName: '',
                  imageUrl: ''
                });
              }
            } catch (e) {
              console.error('Profile error:', e);
            }
            
            if (location.pathname !== "/admin") setView("groups");
          } else {
            console.log('No session found');
            // Set view to homepage for non-logged in users
            if (location.pathname !== "/admin") setView("home");
          }
        }
      } catch (e) {
        console.error("Auth init error:", e);
        setError(e.message || "Authentication error");
      } finally {
        setLoading(false);
      }
    };

    initAuth();

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      console.log('Auth state changed:', event, session?.user?.email);
      
      if (event === 'SIGNED_IN' && session?.user) {
        setUser(session.user);
        
        // Try to load profile, but don't block on failure
        try {
          const prof = await getProfile(session.user.id);
          if (prof) {
            setProfile(prof);
          } else {
            console.log('No profile found, user will need to create one');
            setProfile(null);
          }
        } catch (e) {
          console.error('Error loading profile:', e);
          // Don't block login if profile doesn't exist yet
          setProfile(null);
        }
        
        // Important: Set loading to false even if profile fails
        setLoading(false);
        
        if (location.pathname !== "/admin") {
          setView("groups");
        }
      } else if (event === 'SIGNED_OUT') {
        setUser(null);
        setProfile(null);
        setLoading(false);
        if (location.pathname !== "/admin") setView("login");
      } else if (event === 'USER_UPDATED' && session?.user) {
        setUser(session.user);
        try {
          const prof = await getProfile(session.user.id);
          setProfile(prof);
        } catch (e) {
          console.error('Error updating profile:', e);
        }
      }
    });

    // Fallback: Check session after a delay if still loading
    const timeoutId = setTimeout(() => {
      if (loading) {
        console.log('Timeout reached, forcing session check...');
        initAuth();
      }
    }, 3000);

    return () => {
      subscription.unsubscribe();
      clearTimeout(timeoutId);
    };
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
          <div className="text-xs opacity-50 mt-4">
            {window.location.hash.includes('access_token') ? 'Verarbeite Login...' : 'Lade Daten...'}
          </div>
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
        menuOpen={menuOpen}
        setMenuOpen={setMenuOpen}
      />

{/* Mobile Menu Overlay */}
{menuOpen && (
  <div className="fixed inset-0 z-50 bg-white">
    <div className="flex flex-col h-full">
      <div className="border-b-4 border-black">
        <div className="mx-auto max-w-md p-3 flex items-center justify-between">
          <div className="font-black text-xl tracking-tight">MENU</div>
          <button 
            className="px-2 py-1 border-2 border-black"
            onClick={() => setMenuOpen(false)}
          >
            ✕
          </button>
        </div>
      </div>
      
      <div className="mx-auto max-w-md w-full flex-1 p-3 space-y-2">
        {!user ? (
          <>
            <button 
              className="w-full p-3 border-4 border-black font-bold text-left"
              style={{ backgroundColor: '#fed89e' }}
              onClick={() => { setMenuOpen(false); setView("login"); }}
            >
              Login / Sign Up
            </button>
            <button 
              className="w-full p-3 border-4 border-black font-bold text-left"
              style={{ backgroundColor: '#d8e1fc' }}
              onClick={() => { setMenuOpen(false); setView("imprint"); }}
            >
              Contact and Imprint
            </button>
          </>
        ) : (
          <>
            {/* Hauptmenü für eingeloggte Nutzer */}
            <button 
              className="w-full p-3 border-4 border-black font-bold text-left"
              style={{ backgroundColor: '#d8e1fc' }}
              onClick={() => { setMenuOpen(false); setView("groups"); }}
            >
              My Groups
            </button>
            <button 
              className="w-full p-3 border-4 border-black font-bold text-left"
              style={{ backgroundColor: '#dce7d0' }}
              onClick={() => { setMenuOpen(false); setView("profile"); }}
            >
              Edit Profile
            </button>
            <button 
              className="w-full p-3 border-4 border-black font-bold text-left"
              style={{ backgroundColor: '#ffd4e5' }}
              onClick={() => { setMenuOpen(false); setView("support"); }}
            >
              Made a donation
            </button>
            <button 
              className="w-full p-3 border-4 border-black font-bold text-left"
              style={{ backgroundColor: '#ffe4cc' }}
              onClick={() => { setMenuOpen(false); setView("imprint"); }}
            >
              Contact and Imprint
            </button>
            <button 
              className="w-full p-3 border-4 border-black font-bold text-left"
              style={{ backgroundColor: '#ffcccc' }}
              onClick={() => { 
                setMenuOpen(false); 
                supabase.auth.signOut(); 
              }}
            >
              Sign Out
            </button>
          </>
        )}
      </div>
    </div>
  </div>
)}

      <main className="mx-auto w-full max-w-md p-3 pb-24">
        {error && (
          <div className="mb-4 p-3 border-4 border-red-600 bg-red-50 text-red-700">
            {error}
          </div>
        )}

        {view === "home" && !user && <HomeView onGetStarted={() => setView("login")} />}
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
        {view === "support" && <SupportView onBack={() => setView(user ? "groups" : "home")} />}
        {view === "imprint" && <ImprintView onBack={() => setView(user ? "groups" : "home")} />}
        {view === "admin" && (
          <AdminView
            onExit={() => { 
              history.pushState({}, "", "/"); 
              setView(user ? "groups" : "home"); 
            }}
          />
        )}
      </main>

      {/* Temporär deaktiviert wegen Kompatibilitätsproblemen mit React 19
      {import.meta.env.PROD && (
        <>
          <Analytics debug={false} />
          <SpeedInsights debug={false} />
        </>
      )}
      */}
    </div>
  );
}

function Header({ user, profile, onSignOut, onGo, menuOpen, setMenuOpen }) {
  const displayName = profile ? 
    `${profile.first_name || ""} ${profile.last_name || ""}`.trim() || user?.email : 
    user?.email;

  return (
    <header className="sticky top-0 z-10 bg-white border-b-4 border-black">
      <div className="mx-auto max-w-md flex items-center justify-between p-3">
        <button 
          className="font-black text-xl tracking-tight cursor-pointer"
          onClick={() => onGo(user ? "groups" : "home")}
        >
          MIRRIO
        </button>
        <button 
          className="px-2 py-1 border-2 border-black cursor-pointer"
          onClick={() => setMenuOpen(!menuOpen)}
        >
          ☰
        </button>
      </div>
      {user && (
        <div className="mx-auto max-w-md px-3 pb-2 flex items-center gap-3">
          <Avatar img={profile?.image_url} label={displayName} />
          <div className="text-xs">
            <div className="font-bold leading-tight">{displayName}</div>
            <div className="opacity-70">{user.email}</div>
          </div>
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
  const [mode, setMode] = useState("login"); // login, signup, magic
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [sentTo, setSentTo] = useState(null);
  const [loading, setLoading] = useState(false);
  const redirectBase = import.meta.env.DEV ? "http://localhost:5173" : "https://mirrio.app";

  async function handleEmailPassword(isSignup) {
    if (!email.includes("@")) return alert("Enter a valid email");
    if (password.length < 6) return alert("Password must be at least 6 characters");
    
    setLoading(true);
    try {
      if (isSignup) {
        const { error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            emailRedirectTo: redirectBase
          }
        });
        if (error) throw error;
        alert("Account created! Please check your email to verify your account.");
        setMode("login");
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password
        });
        if (error) throw error;
      }
    } catch (error) {
      alert(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleMagicLink() {
    if (!email.includes("@")) return alert("Enter a valid email");
    
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: redirectBase },
      });
      if (error) throw error;
      setSentTo(email.trim());
    } catch (error) {
      alert(error.message);
    } finally {
      setLoading(false);
    }
  }

  if (sentTo) {
    return (
      <section className="space-y-4">
        <h1 className="text-2xl font-black">Check your email</h1>
        <div className="p-3 border-4 border-black bg-black text-white text-sm break-all">
          We sent a magic link to <b>{sentTo}</b>. Click it to sign in.
        </div>
        <button 
          className="block w-full p-3 border-4 border-black text-center font-bold" 
          onClick={() => { setSentTo(null); setMode("login"); }}
        >
          Back to login
        </button>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-black">
        {mode === "signup" ? "Create account" : "Sign in"}
      </h1>
      
      <div className="space-y-2">
        <label className="block text-sm font-bold">Email</label>
        <input 
          className="w-full p-3 border-4 border-black" 
          type="email"
          placeholder="you@example.com" 
          value={email} 
          onChange={(e) => setEmail(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && mode !== 'magic' && handleEmailPassword(mode === 'signup')}
        />
        
        {mode !== "magic" && (
          <>
            <label className="block text-sm font-bold">Password</label>
            <input 
              className="w-full p-3 border-4 border-black" 
              type="password"
              placeholder="••••••••" 
              value={password} 
              onChange={(e) => setPassword(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleEmailPassword(mode === 'signup')}
            />
          </>
        )}

        {mode === "login" && (
          <>
            <button
              className="w-full p-3 border-4 border-black font-bold disabled:opacity-60 hover:opacity-90 transition-opacity"
              style={{ backgroundColor: '#fed89e' }}
              disabled={loading}
              onClick={() => handleEmailPassword(false)}
            >
              {loading ? "Signing in..." : "Sign in"}
            </button>
            <div className="flex gap-2">
              <button
                className="flex-1 p-3 border-4 border-black disabled:opacity-60 hover:opacity-90 transition-opacity"
                style={{ backgroundColor: '#d8e1fc' }}
                disabled={loading}
                onClick={() => setMode("magic")}
              >
                Use Magic Link
              </button>
              <button
                className="flex-1 p-3 border-4 border-black disabled:opacity-60 hover:opacity-90 transition-opacity"
                style={{ backgroundColor: '#dce7d0' }}
                disabled={loading}
                onClick={() => setMode("signup")}
              >
                Create account
              </button>
            </div>
          </>
        )}

        {mode === "signup" && (
          <>
            <button
              className="w-full p-3 border-4 border-black font-bold disabled:opacity-60 hover:opacity-90 transition-opacity"
              style={{ backgroundColor: '#dce7d0' }}
              disabled={loading}
              onClick={() => handleEmailPassword(true)}
            >
              {loading ? "Creating account..." : "Create account"}
            </button>
            <button
              className="w-full p-3 border-4 border-black disabled:opacity-60 hover:opacity-90 transition-opacity"
              style={{ backgroundColor: '#d8e1fc' }}
              disabled={loading}
              onClick={() => setMode("login")}
            >
              Already have an account? Sign in
            </button>
          </>
        )}

        {mode === "magic" && (
          <>
            <button
              className="w-full p-3 border-4 border-black font-bold disabled:opacity-60 hover:opacity-90 transition-opacity"
              style={{ backgroundColor: '#fed89e' }}
              disabled={loading}
              onClick={handleMagicLink}
            >
              {loading ? "Sending..." : "Send Magic Link"}
            </button>
            <button
              className="w-full p-3 border-4 border-black disabled:opacity-60 hover:opacity-90 transition-opacity"
              style={{ backgroundColor: '#d8e1fc' }}
              disabled={loading}
              onClick={() => setMode("login")}
            >
              Back to password login
            </button>
            <p className="text-xs opacity-70">
              We'll email you a secure sign-in link.
            </p>
          </>
        )}
      </div>
    </section>
  );
}

// Aktualisierte ProfileView Komponente mit Supabase Storage

function ProfileView({ user, profile, onUpdate }) {
  const [firstName, setFirstName] = useState(profile?.first_name || "");
  const [lastName, setLastName] = useState(profile?.last_name || "");
  const [imageUrl, setImageUrl] = useState(profile?.image_url || "");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  
  // Password management
  const [showPasswordSection, setShowPasswordSection] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);

  async function onPick(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    
    // Validate file
    if (!file.type.startsWith('image/')) {
      alert("Please select an image file");
      return;
    }
    
    // Check file size (max 5MB)
    const maxSize = 5 * 1024 * 1024; // 5MB
    if (file.size > maxSize) {
      alert("Image must be smaller than 5MB");
      return;
    }
    
    setUploading(true);
    
    try {
      // Option 1: Supabase Storage (EMPFOHLEN)
      // Erstelle einen eindeutigen Dateinamen mit korrekter Ordnerstruktur
      const fileExt = file.name.split('.').pop();
      const fileName = `${Date.now()}.${fileExt}`;
      const filePath = `${user.id}/${fileName}`; // Wichtig: user.id als Ordner!
      
      // Upload zu Supabase Storage
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('profiles') // Bucket Name
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: true
        });
      
      if (uploadError) {
        console.error('Upload error:', uploadError);
        
        // Fallback zu Data URL wenn Storage nicht konfiguriert
        if (uploadError.message?.includes('bucket') || uploadError.statusCode === 404) {
          console.log('Storage not configured, using data URL fallback');
          
          // Resize image before converting to data URL
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          const img = new Image();
          
          const reader = new FileReader();
          reader.onload = (e) => {
            img.onload = () => {
              // Resize to max 200x200
              const maxDim = 200;
              let width = img.width;
              let height = img.height;
              
              if (width > height) {
                if (width > maxDim) {
                  height = (height * maxDim) / width;
                  width = maxDim;
                }
              } else {
                if (height > maxDim) {
                  width = (width * maxDim) / height;
                  height = maxDim;
                }
              }
              
              canvas.width = width;
              canvas.height = height;
              ctx.drawImage(img, 0, 0, width, height);
              
              // Convert to data URL with compression
              const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.7);
              
              // Check size
              if (compressedDataUrl.length > 65535) { // ~64KB limit for safety
                alert("Image is too large even after compression. Please choose a smaller image.");
                setUploading(false);
                return;
              }
              
              setImageUrl(compressedDataUrl);
              setUploading(false);
            };
            img.src = e.target.result;
          };
          reader.readAsDataURL(file);
          return;
        }
        
        throw uploadError;
      }
      
      // Get public URL
      const { data: urlData } = supabase.storage
        .from('profiles')
        .getPublicUrl(filePath);
      
      setImageUrl(urlData.publicUrl);
      
    } catch (error) {
      console.error('Error handling image:', error);
      alert(`Error uploading image: ${error.message}`);
    } finally {
      setUploading(false);
    }
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
      console.error("Error saving profile:", e);
      alert("Error saving profile: " + e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handlePasswordSet() {
    if (!newPassword || newPassword.length < 6) {
      alert("Password must be at least 6 characters");
      return;
    }
    
    if (newPassword !== confirmPassword) {
      alert("Passwords do not match");
      return;
    }

    setPasswordSaving(true);
    try {
      const { data, error } = await supabase.auth.updateUser({
        password: newPassword
      });
      
      if (error) throw error;
      
      setTimeout(() => {
        alert("✅ Password successfully updated!\n\nYou can now sign in with your email and password.");
      }, 100);
      
      setNewPassword("");
      setConfirmPassword("");
      setShowPasswordSection(false);
    } catch (e) {
      setTimeout(() => {
        alert("❌ Error setting password:\n\n" + e.message);
      }, 100);
    } finally {
      setPasswordSaving(false);
    }
  }

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-black">Your profile</h1>
      
      {/* Profile Picture Section */}
      <div className="grid grid-cols-3 gap-3 items-center">
        <div className="col-span-1">
          <Avatar img={imageUrl} size={64} label={firstName || user.email} />
        </div>
        <div className="col-span-2 text-xs opacity-70">
          <div>Square images work best (1:1 ratio)</div>
          <div>Max size: 5MB</div>
          <div>Formats: JPG, PNG, GIF, WebP</div>
          {uploading && <div className="font-bold mt-1">Uploading...</div>}
        </div>
      </div>
      
      {/* Profile Information */}
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
          disabled={uploading}
        />
        <button 
          className="w-full p-3 border-4 border-black font-bold disabled:opacity-60 hover:opacity-90 transition-opacity" 
          style={{ backgroundColor: '#d8e1fc' }}
          onClick={handleSave}
          disabled={saving || uploading}
        >
          {saving ? "Saving..." : uploading ? "Uploading image..." : "Save Profile"}
        </button>
      </div>

      {/* Password Section */}
      <div className="border-t-4 border-black pt-4">
        <button
          className="w-full p-3 border-4 border-black font-bold"
          onClick={() => setShowPasswordSection(!showPasswordSection)}
        >
          {showPasswordSection ? "Cancel Password Setup" : "Set Password (for Email Login)"}
        </button>
        
        {showPasswordSection && (
          <div className="mt-4 space-y-2 p-3 border-4 border-black bg-yellow-50">
            <div className="text-sm opacity-70 mb-2">
              Set a password to enable email/password login in addition to magic links.
            </div>
            
            <label className="block text-sm font-bold">New Password</label>
            <input 
              className="w-full p-3 border-4 border-black" 
              type="password"
              placeholder="At least 6 characters"
              value={newPassword} 
              onChange={(e) => setNewPassword(e.target.value)} 
            />
            <label className="block text-sm font-bold">Confirm Password</label>
            <input 
              className="w-full p-3 border-4 border-black" 
              type="password"
              placeholder="Repeat password"
              value={confirmPassword} 
              onChange={(e) => setConfirmPassword(e.target.value)} 
            />
            <button 
              className="w-full p-3 border-4 border-black font-bold bg-black text-white disabled:opacity-60 hover:opacity-90 transition-opacity" 
              onClick={handlePasswordSet}
              disabled={passwordSaving}
            >
              {passwordSaving ? "Setting Password..." : "Set Password"}
            </button>
          </div>
        )}
      </div>

      {/* Account Info */}
      <div className="text-xs opacity-70 border-t-4 border-black pt-4">
        <div>Email: <b>{user.email}</b></div>
        <div>User ID: <code>{user.id}</code></div>
        <div>Last Sign In: {user.last_sign_in_at ? new Date(user.last_sign_in_at).toLocaleString() : "Never"}</div>
      </div>
    </section>
  );
}

function GroupsView({ user, setView, setActiveGroupId }) {
  const [groups, setGroups] = useState([]);
  const [editions, setEditions] = useState([]);
  const [name, setName] = useState("");
  const [selectedEditionId, setSelectedEditionId] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [groupVotingStatus, setGroupVotingStatus] = useState({});

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      const [grps, eds] = await Promise.all([listGroups(), listEditions()]);
      setGroups(grps);
      const activeEditions = eds.filter(e => e.active);
      setEditions(activeEditions);
      // Auto-select first active edition
      if (activeEditions.length > 0 && !selectedEditionId) {
        setSelectedEditionId(activeEditions[0].id);
      }
      
      // Check voting status for each group
      const votingStatus = {};
      for (const group of grps) {
        try {
          const activeRound = await getActiveRound(group.id);
          if (activeRound) {
            const userVote = activeRound.votes?.find(v => v.voter === user.id);
            votingStatus[group.id] = {
              hasActiveVoting: true,
              hasVoted: !!userVote
            };
          } else {
            votingStatus[group.id] = {
              hasActiveVoting: false,
              hasVoted: false
            };
          }
        } catch (e) {
          console.error("Error checking voting for group:", e);
        }
      }
      setGroupVotingStatus(votingStatus);
    } catch (e) {
      console.error("Error loading data:", e);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateGroup() {
    if (!name.trim()) return alert("Name required");
    
    if (name.trim().length > 18) {
      return alert("Group name must be max. 18 characters");
    }
    
    if (!selectedEditionId) {
      return alert("Please select an edition for your group");
    }

    setCreating(true);
    try {
      await createGroup({ name: name.trim(), editionId: selectedEditionId });
      setName("");
      alert("✅ Group created successfully!");
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

      {/* Groups List */}
      <div className="grid gap-3">
        {groups.map(g => {
          const memberCount = g.group_members?.length || 0;
          const status = groupVotingStatus[g.id] || {};
          const needsVote = status.hasActiveVoting && !status.hasVoted;
          
          return (
            <div key={g.id} className="p-3 border-4 border-black">
              <div className="flex items-center gap-2">
                <div className="font-extrabold text-lg">{g.name}</div>
                {needsVote && (
                  <span className="px-2 py-0.5 border-2 border-black text-xs font-bold animate-pulse" 
                        style={{ backgroundColor: '#ffcccc' }}>
                    VOTE NOW!
                  </span>
                )}
                <span className="ml-auto text-xs px-2 py-0.5 border-2 border-black">
                  {memberCount} member{memberCount !== 1 ? 's' : ''}
                </span>
              </div>
              <div className="text-xs mt-1 opacity-70">
                Edition: {g.editions?.name || "—"}
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button 
                  className="p-2 border-2 border-black hover:opacity-90 transition-opacity" 
                  style={{ backgroundColor: '#d8e1fc' }}
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
          );
        })}
        {groups.length === 0 && (
          <p className="text-sm opacity-70">
            No groups yet. Create one and invite your friends.
          </p>
        )}
      </div>

      {/* Separator */}
      <div className="border-t-4 border-black pt-3">
        {/* Create Group Form */}
        <div className="space-y-2">
          <label className="block text-sm font-bold">
            Create a new group 
            <span className={`ml-2 text-xs ${name.length > 18 ? 'text-red-600' : 'opacity-70'}`}>
              ({name.length}/18)
            </span>
          </label>
          <input 
            className={`w-full p-3 border-4 ${name.length > 18 ? 'border-red-600' : 'border-black'}`}
            placeholder="Group name" 
            value={name} 
            onChange={(e) => setName(e.target.value)} 
          />
          {name.length > 18 && (
            <div className="text-xs text-red-600">Name is too long! Max 18 characters.</div>
          )}
          
          {editions.length > 0 && (
            <>
              <label className="block text-sm font-bold">Select Edition</label>
              <select
                className="w-full p-3 border-4 border-black"
                value={selectedEditionId}
                onChange={(e) => setSelectedEditionId(e.target.value)}
              >
                {editions.map(ed => (
                  <option key={ed.id} value={ed.id}>
                    {ed.name} {ed.slug ? `(${ed.slug})` : ''}
                  </option>
                ))}
              </select>
              <div className="text-xs opacity-70">
                The edition determines which statements your group will use. This cannot be changed later.
              </div>
            </>
          )}
          
          <button
            className="w-full p-3 border-4 border-black font-bold disabled:opacity-60 hover:opacity-90 transition-opacity"
            style={{ backgroundColor: '#dce7d0' }}
            onClick={handleCreateGroup}
            disabled={creating || editions.length === 0 || name.length > 18}
          >
            {creating ? "Creating..." : editions.length === 0 ? "No editions available" : "Create group"}
          </button>
          
          {editions.length === 0 && (
            <div className="p-3 border-4 border-black bg-yellow-100 text-sm">
              No active editions available. Please contact the admin to create editions.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function InviteButton({ groupId }) {
  const [copied, setCopied] = useState(false);
  
  const inviteURL = `${location.origin}?invite=${groupId}`;

  return (
    <button 
      className="p-2 border-2 border-black hover:opacity-90 transition-opacity" 
      style={{ backgroundColor: '#fed89e' }}
      onClick={() => {
        navigator.clipboard.writeText(inviteURL);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? "Link copied" : "Invite member"}
    </button>
  );
}

function GroupDetail({ groupId, user, setView }) {
  const [group, setGroup] = useState(null);
  const [rounds, setRounds] = useState([]);
  const [activeRound, setActiveRound] = useState(null);
  const [activeRoundId, setActiveRoundId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  
  // States für Gruppenverwaltung
  const [showManagement, setShowManagement] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useTicker(1000); // For countdown timer

  useEffect(() => {
    loadGroupData();
  }, [groupId, refresh]);

  async function loadGroupData() {
    setLoading(true);
    try {
      const [grp, rnds, active] = await Promise.all([
        getGroup(groupId),
        listRounds(groupId),
        getActiveRound(groupId)
      ]);
      
      setGroup(grp);
      setRounds(rnds);
      setActiveRound(active);
      setNewGroupName(grp.name);
    } catch (e) {
      console.error("Error loading group:", e);
    } finally {
      setLoading(false);
    }
  }

  async function handleStartNewRound() {
    try {
      const editionId = group.edition_id;
      if (!editionId) {
        alert("Group has no edition assigned!");
        return;
      }
      
      const { data: allStatements, error: stmtError } = await supabase
        .from("statements")
        .select("*")
        .eq("edition_id", editionId);
      
      if (stmtError) throw stmtError;
      
      const { data: usedStatements, error: usedError } = await supabase
        .from("group_used_statements")
        .select("statement_id")
        .eq("group_id", groupId);
      
      if (usedError) throw usedError;
      
      const usedIds = usedStatements?.map(u => u.statement_id) || [];
      const unusedStatements = allStatements.filter(s => !usedIds.includes(s.id));
      
      if (unusedStatements.length === 0) {
        alert("No unused statements left in this edition!");
        return;
      }
      
      const randomIndex = Math.floor(Math.random() * unusedStatements.length);
      const stmt = unusedStatements[randomIndex];
      
      const round = await createRound({
        groupId,
        statementId: stmt.id,
        expiresIn: DAY
      });
      
      await markStatementUsed(groupId, stmt.id);
      setRefresh(r => r + 1);
    } catch (e) {
      console.error("Error starting round:", e);
      alert("Error starting round: " + e.message);
    }
  }

  async function checkAndCloseRound() {
  if (!activeRound) return;
  
  const now = new Date();
  const expires = new Date(activeRound.expires_at);
  
  // Prüfe ob Round schon geschlossen wurde
  if (activeRound.round_results && activeRound.round_results.length > 0) {
    return; // Already closed
  }
  
  if (now > expires || activeRound.votes?.length >= group.group_members?.length) {
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
      // Nur EINMAL refreshen nach dem Schließen
      setTimeout(() => setRefresh(r => r + 1), 1000);
    } catch (e) {
      console.error("Error closing round:", e);
      // Bei Fehler nicht endlos wiederholen
    }
  }
}

useEffect(() => {
  if (activeRound && (!activeRound.round_results || activeRound.round_results.length === 0)) {
    checkAndCloseRound();
  }
}, [activeRound?.votes?.length]);

  async function handleRenameGroup() {
    if (!newGroupName.trim()) {
      alert("Group name cannot be empty");
      return;
    }
    
    if (newGroupName.trim().length > 18) {
      alert("Group name must be max 18 characters");
      return;
    }
    
    setSaving(true);
    try {
      await renameGroup(groupId, newGroupName);
      setGroup({...group, name: newGroupName});
      setEditingName(false);
      alert("Group renamed!");
    } catch (e) {
      alert("Error renaming: " + e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteGroup() {
    if (!confirm(`Do you really want to delete the group "${group.name}"? This action cannot be undone.`)) {
      return;
    }
    
    setDeleting(true);
    try {
      await deleteGroup(groupId);
      alert("Group deleted!");
      setView("groups");
    } catch (e) {
      alert("Error deleting: " + e.message);
      setDeleting(false);
    }
  }

  function getVotingResults() {
    if (!activeRound || !activeRound.votes) return null;
    
    const now = new Date();
    const expires = new Date(activeRound.expires_at);
    const isExpired = now > expires;
    const allVoted = activeRound.votes?.length >= group.group_members?.length;
    const roundClosed = isExpired || allVoted;
    
    if (!roundClosed) return null;
    
    const voteCounts = {};
    group.group_members?.forEach(member => {
      voteCounts[member.profiles.id] = 0;
    });
    
    activeRound.votes?.forEach(v => {
      if (v.target && voteCounts[v.target] !== undefined) {
        voteCounts[v.target]++;
      }
    });
    
    const results = Object.entries(voteCounts).map(([userId, votes]) => {
      const member = group.group_members.find(m => m.profiles.id === userId);
      return {
        userId,
        votes,
        profile: member?.profiles
      };
    }).sort((a, b) => b.votes - a.votes);
    
    const maxVotes = Math.max(...results.map(r => r.votes));
    
    return { results, maxVotes };
  }

  // Calculate next statement date (48 hours from last round)
function getNextStatementDate() {
  const lastRound = rounds[0]; // Most recent round
  if (!lastRound) {
    // Keine vorherige Round, nächster Drop in 48h
    return new Date(Date.now() + (48 * 60 * 60 * 1000));
  }
  
  const baseDate = new Date(lastRound.issued_at);
  const nextDate = new Date(baseDate.getTime() + (48 * 60 * 60 * 1000)); // 48 Stunden
  return nextDate;
}

  const nextStatementTime = getNextStatementDate().getTime() - Date.now();
  const timeLeft = activeRound ? 
    Math.max(0, new Date(activeRound.expires_at).getTime() - Date.now()) : 0;

  if (loading) return <div className="text-center py-8">Loading group...</div>;
  if (!group) return <div className="text-center py-8">Group not found</div>;

  const isOwner = group.owner === user.id;
  const votingResults = getVotingResults();

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
          {group.group_members?.length || 0} member{group.group_members?.length !== 1 ? 's' : ''}
        </span>
      </div>

{/* Next Statement Countdown - zeigen wenn Voting beendet ist */}
{activeRound && votingResults && (
  <div className="p-3 border-4 border-black" style={{ backgroundColor: '#ffe4cc' }}>
    <div className="text-sm">
      Next statement drops in: <b>{humanTime(nextStatementTime)}</b>
    </div>
  </div>
)}

    {/* Active Round or Start Button */}
{!activeRound ? (
  <>
    {/* Next Statement Countdown - nur zeigen wenn kein Voting läuft */}
    <div className="p-3 border-4 border-black" style={{ backgroundColor: '#ffe4cc' }}>
      <div className="text-sm">
        Next statement drops in: <b>{humanTime(nextStatementTime)}</b>
      </div>
    </div>
    
    <div className="p-3 border-4 border-black bg-yellow-200">
      <div className="font-bold">No active voting right now.</div>
      {isOwner && (
        <button
          className="mt-2 w-full p-3 border-4 border-black font-bold"
          onClick={handleStartNewRound}
        >
          Start new round
        </button>
      )}
      {!isOwner && (
        <div className="mt-2 text-sm opacity-70">
          Only the group owner can start new rounds.
        </div>
      )}
    </div>
  </>
) : (
  <div className="p-3 border-4 border-black">
    {/* Voting countdown wenn Voting läuft und noch nicht beendet */}
    {!votingResults && (
      <div className="text-xs mb-1">
        Voting ends in <b>{humanTime(timeLeft)}</b>
      </div>
    )}
    
    <div className="font-extrabold text-lg">
      {activeRound.statements?.text ? `"${activeRound.statements.text}"` : "Loading statement..."}
    </div>
    
    {votingResults ? (
      <div className="mt-3">
        <div className="font-bold mb-2">🏆 Voting Results</div>
        <div className="space-y-1">
          {votingResults.results.map((result, idx) => (
            <div 
              key={result.userId}
              className={`p-2 border-2 border-black flex items-center justify-between ${
                result.votes === votingResults.maxVotes && result.votes > 0 ? 'font-bold' : ''
              }`}
              style={{ 
                backgroundColor: result.votes === votingResults.maxVotes && result.votes > 0 ? '#fed89e' : 'white' 
              }}
            >
              <div className="flex items-center gap-2">
                <span className="text-sm">{idx + 1}.</span>
                <span>
                  {result.profile?.first_name || result.profile?.last_name ? 
                    `${result.profile.first_name || ""} ${result.profile.last_name || ""}`.trim() : 
                    result.profile?.email}
                </span>
                {result.votes === votingResults.maxVotes && result.votes > 0 && (
                  <span className="text-sm">👑</span>
                )}
              </div>
              <span className="px-2 py-0.5 border border-black text-sm">
                {result.votes} vote{result.votes !== 1 ? 's' : ''}
              </span>
            </div>
          ))}
        </div>
      </div>
    ) : (
      <VotePanel 
        round={activeRound} 
        group={group}
        user={user} 
        onVoted={() => setRefresh(r => r + 1)}
      />
    )}
  </div>
)}

{/* Previous Rounds */}
<div className="p-3 border-4 border-black">
  <div className="font-extrabold mb-2">Previous Rounds</div>
  <div className="grid gap-3">
    {rounds.map(r => {
      const isClosed = !!r.round_results?.[0]?.closed_at;
      
      console.log("Round:", r.id, "Closed:", isClosed, "Active:", activeRound?.id);
      
      if (!isClosed) return null;
      if (activeRound && r.id === activeRound.id) return null;
      
      const winner = r.round_results?.[0]?.winner;
      const winnerProfile = group.group_members?.find(m => m.profiles.id === winner)?.profiles;
      
      return (
        <div key={r.id} className="p-2 border-2 border-black">
          <div className="text-xs opacity-70">
            {new Date(r.issued_at).toLocaleDateString()}
          </div>
          <div className="font-bold">
            {r.statements?.text ? `"${r.statements.text}"` : <i>No statement</i>}
          </div>
          {winner && winnerProfile ? (
            <div className="text-sm mt-1">
              Winner: <b>{winnerProfile.first_name || winnerProfile.last_name ? 
                `${winnerProfile.first_name || ""} ${winnerProfile.last_name || ""}`.trim() : 
                winnerProfile.email}</b> 👑
            </div>
          ) : (
            <div className="text-sm mt-1 opacity-70">
              {winner ? "Winner data not found" : "No winner (tie)"}
            </div>
          )}
          <button
            className="mt-2 text-xs underline"
            onClick={() => {
              setView("round-detail");
              setActiveRoundId(r.id);
            }}
          >
            View details →
          </button>
        </div>
      );
    })}
    {rounds.filter(r => {
      const isClosed = !!r.round_results?.[0]?.closed_at;
      return isClosed && (!activeRound || r.id !== activeRound.id);
    }).length === 0 && (
      <div className="opacity-70 text-sm">No completed rounds yet.</div>
    )}
  </div>
  
  <div className="mt-2 p-2 bg-gray-100 text-xs">
    <div>Total rounds: {rounds.length}</div>
    <div>Closed rounds: {rounds.filter(r => r.round_results?.[0]?.closed_at).length}</div>
    <div>Active round ID: {activeRound?.id || "none"}</div>
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
              <span className="ml-auto text-xs opacity-70">
                {profiles.email}
                {profiles.id === group.owner && (
                  <span className="ml-2 px-1 border border-black">Owner</span>
                )}
              </span>
            </div>
          ))}
        </div>
        <div className="mt-3">
          <InviteButton groupId={groupId} />
        </div>
      </div>

      {/* Group Management Section - nur für Owner */}
      {isOwner && (
        <>
          <div className="border-t-4 border-black"></div>
          <div className="p-3 border-4 border-black bg-gray-50">
            <div className="flex items-center justify-between mb-2">
              <div className="font-bold">Group Management</div>
              <button
                className="text-sm underline"
                onClick={() => setShowManagement(!showManagement)}
              >
                {showManagement ? "Hide" : "Show"}
              </button>
            </div>
            
            {showManagement && (
              <div className="space-y-3 mt-3">
                <div>
                  <div className="text-sm font-bold mb-1">
                    Rename group
                    <span className={`ml-2 text-xs ${newGroupName.length > 18 ? 'text-red-600' : 'opacity-70'}`}>
                      ({newGroupName.length}/18)
                    </span>
                  </div>
                  {editingName ? (
                    <div className="space-y-2">
                      <input
                        className={`w-full p-2 border-2 ${newGroupName.length > 18 ? 'border-red-600' : 'border-black'}`}
                        value={newGroupName}
                        onChange={(e) => setNewGroupName(e.target.value)}
                        placeholder="New group name"
                      />
                      {newGroupName.length > 18 && (
                        <div className="text-xs text-red-600">Name too long! Max 18 characters.</div>
                      )}
                      <div className="flex gap-2">
                        <button
                          className="flex-1 p-2 border-2 border-black font-bold hover:opacity-90 transition-opacity disabled:opacity-60"
                          style={{ backgroundColor: '#d8e1fc' }}
                          onClick={handleRenameGroup}
                          disabled={saving || newGroupName.length > 18}
                        >
                          {saving ? "Saving..." : "Save"}
                        </button>
                        <button
                          className="flex-1 p-2 border-2 border-black hover:opacity-90 transition-opacity"
                          onClick={() => {
                            setEditingName(false);
                            setNewGroupName(group.name);
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      className="w-full p-2 border-2 border-black hover:opacity-90 transition-opacity"
                      style={{ backgroundColor: '#d8e1fc' }}
                      onClick={() => setEditingName(true)}
                    >
                      Rename
                    </button>
                  )}
                </div>
                
                <div>
                  <div className="text-sm font-bold mb-1 text-red-600">Danger Zone</div>
                  <button
                    className="w-full p-2 border-2 border-black font-bold hover:opacity-90 transition-opacity disabled:opacity-60"
                    style={{ backgroundColor: '#ffcccc' }}
                    onClick={handleDeleteGroup}
                    disabled={deleting}
                  >
                    {deleting ? "Deleting..." : "Delete group"}
                  </button>
                  <div className="text-xs opacity-70 mt-1">
                    This will permanently delete all rounds, votes, comments and points.
                  </div>
                </div>
              </div>
            )}
          </div>
        </>
      )}
      
      {/* Leave Group Section - nur für Nicht-Owner */}
      {!isOwner && (
        <>
          <div className="border-t-4 border-black"></div>
          <div className="p-3 border-4 border-black">
            <button
              className="w-full p-3 border-4 border-black font-bold hover:opacity-90 transition-opacity"
              style={{ backgroundColor: '#ffcccc' }}
              onClick={async () => {
                if (!confirm(`Do you really want to leave the group "${group.name}"?`)) {
                  return;
                }
                
                try {
                  await leaveGroup(groupId);
                  alert("You left the group.");
                  setView("groups");
                } catch (e) {
                  alert("Error leaving group: " + e.message);
                }
              }}
            >
              Leave group
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function RoundDetail({ roundId, groupId, user, setView }) {
  const [round, setRound] = useState(null);
  const [group, setGroup] = useState(null);
  const [votes, setVotes] = useState([]);
  const [comments, setComments] = useState([]);
  const [newComment, setNewComment] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    loadRoundData();
  }, [roundId]);

  async function loadRoundData() {
    setLoading(true);
    try {
      // Hole Round mit allen Details
      const { data: roundData } = await supabase
        .from("rounds")
        .select(`
          *,
          statements(text),
          round_results(winner, votes_count, closed_at)
        `)
        .eq("id", roundId)
        .single();
      
      setRound(roundData);
      
      // Hole Gruppe
      const grp = await getGroup(groupId);
      setGroup(grp);
      
      // Hole alle Votes mit Voter und Target Namen
      const votesData = await getVotes(roundId);
      setVotes(votesData);
      
      // Hole Kommentare
      const cmts = await listComments(roundId);
      setComments(cmts);
      
    } catch (e) {
      console.error("Error loading round:", e);
    } finally {
      setLoading(false);
    }
  }

  async function handleComment() {
    if (!newComment.trim()) return;
    
    setSubmitting(true);
    try {
      await createComment({
        roundId: roundId,
        text: newComment.trim()
      });
      setNewComment("");
      await loadRoundData();
    } catch (e) {
      alert("Error posting comment: " + e.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <div className="text-center py-8">Loading round details...</div>;
  if (!round) return <div className="text-center py-8">Round not found</div>;

  // Berechne Voting-Statistiken
  const voteCounts = {};
  group?.group_members?.forEach(member => {
    voteCounts[member.profiles.id] = {
      profile: member.profiles,
      receivedVotes: [],
      givenVote: null
    };
  });
  
  votes?.forEach(v => {
    if (v.target && voteCounts[v.target]) {
      voteCounts[v.target].receivedVotes.push(v.voter);
    }
    if (voteCounts[v.voter]) {
      voteCounts[v.voter].givenVote = v.target;
    }
  });

  const sortedResults = Object.values(voteCounts)
    .sort((a, b) => b.receivedVotes.length - a.receivedVotes.length);
  
  const winner = round.round_results?.[0]?.winner;
  const winnerProfile = group?.group_members?.find(m => m.profiles.id === winner)?.profiles;

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <button 
          className="px-2 py-1 border-2 border-black"
          onClick={() => setView("group")}
        >
          ← Back to group
        </button>
        <h1 className="text-2xl font-black">Round Details</h1>
      </div>

      {/* Statement */}
      <div className="p-3 border-4 border-black">
        <div className="text-xs opacity-70 mb-1">
          {new Date(round.issued_at).toLocaleString()}
        </div>
        <div className="font-extrabold text-lg">
          "{round.statements?.text}"
        </div>
        <div className="text-sm mt-2 opacity-70">
          Round ended: {new Date(round.round_results?.[0]?.closed_at).toLocaleString()}
        </div>
      </div>

      {/* Winner */}
      {winnerProfile && (
        <div className="p-3 border-4 border-black" style={{ backgroundColor: '#fed89e' }}>
          <div className="font-bold mb-1">🏆 Winner</div>
          <div className="text-lg font-bold">
            {winnerProfile.first_name || winnerProfile.last_name ? 
              `${winnerProfile.first_name || ""} ${winnerProfile.last_name || ""}`.trim() : 
              winnerProfile.email}
          </div>
          <div className="text-sm opacity-70">
            With {round.round_results?.[0]?.votes_count || 0} votes
          </div>
        </div>
      )}

      {/* Detailed Voting Results */}
      <div className="p-3 border-4 border-black">
        <div className="font-bold mb-2">Voting Breakdown</div>
        <div className="space-y-2">
          {sortedResults.map((result, idx) => (
            <div key={result.profile.id} className="p-2 border-2 border-black">
              <div className="flex items-center justify-between">
                <div className="font-bold">
                  {idx + 1}. {result.profile.first_name || result.profile.email}
                </div>
                <div className="text-sm">
                  {result.receivedVotes.length} vote{result.receivedVotes.length !== 1 ? 's' : ''}
                </div>
              </div>
              {result.receivedVotes.length > 0 && (
                <div className="text-xs opacity-70 mt-1">
                  Voted by: {result.receivedVotes.map(voterId => {
                    const voter = group.group_members.find(m => m.profiles.id === voterId);
                    return voter?.profiles.first_name || voter?.profiles.email;
                  }).join(", ")}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Who voted for whom */}
      <div className="p-3 border-4 border-black">
        <div className="font-bold mb-2">Who voted for whom</div>
        <div className="space-y-1 text-sm">
          {Object.values(voteCounts).map(voter => {
            const targetProfile = voter.givenVote ? 
              group.group_members.find(m => m.profiles.id === voter.givenVote)?.profiles : null;
            
            return (
              <div key={voter.profile.id}>
                <b>{voter.profile.first_name || voter.profile.email}</b> → {
                  targetProfile ? 
                    (targetProfile.first_name || targetProfile.email) : 
                    "Abstained"
                }
              </div>
            );
          })}
        </div>
      </div>

      {/* Comments */}
      <div className="p-3 border-4 border-black">
        <div className="font-bold mb-2">Discussion ({comments.length})</div>
        <div className="space-y-2">
          {comments.map(c => (
            <div key={c.id} className="p-2 border border-gray-300">
              <div className="text-xs opacity-70">
                {new Date(c.created_at).toLocaleString()}
              </div>
              <div className="font-bold text-sm">
                {c.profiles.first_name || c.profiles.email}:
              </div>
              <div>{c.text}</div>
            </div>
          ))}
          {comments.length === 0 && (
            <div className="text-sm opacity-70">No comments yet. Be the first!</div>
          )}
        </div>
        
        <div className="mt-3 flex gap-2">
          <input 
            className="flex-1 p-2 border-2 border-black" 
            placeholder="Add a comment..." 
            value={newComment} 
            onChange={(e) => setNewComment(e.target.value)} 
          />
          <button 
            className="px-3 py-2 border-2 border-black font-bold disabled:opacity-60"
            style={{ backgroundColor: '#d8e1fc' }}
            onClick={handleComment}
            disabled={submitting}
          >
            {submitting ? "..." : "Post"}
          </button>
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
        {group.group_members?.map(m => (
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
              {m.profiles.id === user.id && " (You)"}
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
          className="p-2 border-2 border-black font-bold hover:opacity-90 transition-opacity"
          style={{ backgroundColor: '#d8e1fc' }}
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

function RoundHistoryItem({ round, user, group, onComment }) {
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
  const winner = round.round_results?.[0]?.winner;
  const winnerProfile = group?.group_members?.find(m => m.profiles.id === winner)?.profiles;

  return (
    <div className={`p-2 border-2 border-black ${isClosed ? "bg-gray-100" : ""}`}>
      <div className="text-xs opacity-70">
        {new Date(round.issued_at).toLocaleString()}
      </div>
      <div className="font-bold">
        "{round.statements?.text}"
      </div>
      <div className="text-sm mt-1">
        {isClosed ? (
          <div>
            <i>Finished</i>
            {winner && winnerProfile && (
              <span className="ml-2">
                Winner: <b>{winnerProfile.first_name || winnerProfile.last_name ? 
                  `${winnerProfile.first_name || ""} ${winnerProfile.last_name || ""}`.trim() : 
                  winnerProfile.email}</b> 👑
              </span>
            )}
          </div>
        ) : (
          <i>Voting in progress…</i>
        )}
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

// Homepage for non-logged in users
function HomeView({ onGetStarted }) {
  return (
    <section className="space-y-6">
      <div className="text-center py-4">
        <h1 className="text-4xl font-black">
          A game that shows who you are.
        </h1>
        <p className="text-lg mt-4">
          Mirrio brings people closer while you grow as a friend and partner—thanks to a{' '}
          <strong style={{ backgroundColor: '#d8e1fc', padding: '2px 4px' }}>playful</strong>,{' '}
          <strong style={{ backgroundColor: '#dce7d0', padding: '2px 4px' }}>honest</strong>{' '}
          feedback loop, one round at a time.
        </p>
      </div>

      <div className="space-y-4">
        <div className="p-4 border-4 border-black">
          <div className="flex items-start gap-3">
            <span className="font-black text-xl">1.</span>
            <div>
              <strong>Join a group</strong> with <span style={{ backgroundColor: '#d8e1fc', padding: '2px 4px' }}>friends</span>, <span style={{ backgroundColor: '#dce7d0', padding: '2px 4px' }}>family</span>, or your <span style={{ backgroundColor: '#ffd4e5', padding: '2px 4px' }}>partner</span>.
            </div>
          </div>
        </div>

        <div className="p-4 border-4 border-black">
          <div className="flex items-start gap-3">
            <span className="font-black text-xl">2.</span>
            <div>
              <strong>Read a </strong><strong style={{ backgroundColor: '#fed89e', padding: '2px 4px' }}>statement</strong> like <em>"Who loves hugs the most?"</em>
            </div>
          </div>
        </div>

        <div className="p-4 border-4 border-black">
          <div className="flex items-start gap-3">
            <span className="font-black text-xl">3.</span>
            <div>
              <strong>Vote <span style={{ backgroundColor: '#d8e1fc', padding: '2px 4px' }}>anonymously</span></strong> on who it fits best.
            </div>
          </div>
        </div>

        <div className="p-4 border-4 border-black">
          <div className="flex items-start gap-3">
            <span className="font-black text-xl">4.</span>
            <div>
              <strong>See the <span style={{ backgroundColor: '#fed89e', padding: '2px 4px' }}>results</span></strong>, laugh, and talk about them.
            </div>
          </div>
        </div>
      </div>

      <div className="text-center space-y-4 py-3">
        <p className="text-lg">
          Every <strong style={{ backgroundColor: '#fed89e', padding: '2px 4px' }}>7 days</strong>, a new statement drops — and everyone gets notified.{' '}
          Each round is quick. Each answer is a{' '}
          <strong style={{ backgroundColor: '#ffd4e5', padding: '2px 4px' }}>surprise</strong>.{' '}
          Each point brings you closer.
        </p>
        
        <p className="text-lg font-bold">
          With Mirrio, you hold up a mirror —{' '}
          <span style={{ backgroundColor: '#d8e1fc', padding: '2px 4px' }}>playfully</span>,{' '}
          <span style={{ backgroundColor: '#dce7d0', padding: '2px 4px' }}>lovingly</span>,{' '}
          <span style={{ backgroundColor: '#ffe4cc', padding: '2px 4px' }}>together</span>.
        </p>
      </div>

      <button
        className="w-full p-4 border-4 border-black font-bold text-lg hover:opacity-90 transition-opacity"
        style={{ backgroundColor: '#fed89e' }}
        onClick={onGetStarted}
      >
        Let's open a group →
      </button>
    </section>
  );
}

// Support/Donation Page
function SupportView({ onBack }) {
  return (
    <section className="space-y-6">
      <div className="flex items-center gap-2">
        <button 
          className="px-2 py-1 border-2 border-black"
          onClick={onBack}
        >
          ← Back
        </button>
        <h1 className="text-2xl font-black">Make a donation</h1>
      </div>

      <div className="space-y-6">
        <div>
          <h2 className="text-3xl font-black mb-4">Why I built Mirrio.</h2>
        </div>

        <div className="p-4 border-4 border-black">
          <h3 className="font-bold text-lg mb-2">Purpose</h3>
          <p>
            Mirrio exists to bring people <strong>closer <span style={{ backgroundColor: '#ffe4cc', padding: '2px 4px' }}>together</span></strong>. 
            I wanted deeper relationships and to understand <strong>how the world sees me</strong>—so I built a game 
            that turns honest <strong style={{ backgroundColor: '#d8e1fc', padding: '2px 4px' }}>reflection</strong> into 
            gentle conversations and personal <strong style={{ backgroundColor: '#dce7d0', padding: '2px 4px' }}>growth</strong>.
          </p>
        </div>

        <div className="p-4 border-4 border-black">
          <h3 className="font-bold text-lg mb-2">How Mirrio is funded</h3>
          <p className="mb-3">
            I'm an independent builder. Mirrio runs on <strong>community contributions</strong>.
          </p>
          <div className="flex gap-4 justify-center p-3 bg-gray-50 border-2 border-black">
            <div className="text-center">
              <div className="text-2xl font-black" style={{ backgroundColor: '#fed89e', padding: '4px 8px' }}>15</div>
              <div className="text-sm mt-1">supporters</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-black" style={{ backgroundColor: '#fed89e', padding: '4px 8px' }}>120 €</div>
              <div className="text-sm mt-1">average</div>
            </div>
          </div>
          <p className="mt-3 text-sm">
            Your support keeps the lights on: hosting, maintenance, and ongoing improvements.
          </p>
        </div>

        <div className="p-4 border-4 border-black">
          <h3 className="font-bold text-lg mb-4">Choose your contribution</h3>
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <span className="font-black text-xl whitespace-nowrap" style={{ backgroundColor: '#d8e1fc', padding: '2px 8px' }}>5 €</span>
              <span>— like <strong>two beers</strong> with friends.</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="font-black text-xl whitespace-nowrap" style={{ backgroundColor: '#dce7d0', padding: '2px 8px' }}>10 €</span>
              <span>— a simple <strong>lunch</strong> that fuels a day of work.</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="font-black text-xl whitespace-nowrap" style={{ backgroundColor: '#ffd4e5', padding: '2px 8px' }}>50 €</span>
              <span>— about <strong>one month of software licenses</strong>.</span>
            </div>
          </div>
          <p className="mt-4 text-sm italic">
            Give what feels right. Any amount helps.
          </p>
        </div>

        <div className="space-y-3">
          <a 
            href="https://www.paypal.me/janansink"
            target="_blank"
            rel="noopener noreferrer"
            className="block w-full p-4 border-4 border-black font-bold text-center hover:opacity-90 transition-opacity"
            style={{ backgroundColor: '#fed89e' }}
          >
            Donate via PayPal →
          </a>
          
          <div className="flex gap-2 justify-center">
            <a 
              href="https://www.paypal.me/janansink/5"
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1 border-2 border-black text-sm hover:opacity-90 transition-opacity whitespace-nowrap"
              style={{ backgroundColor: '#d8e1fc' }}
            >
              5 €
            </a>
            <span className="py-1">·</span>
            <a 
              href="https://www.paypal.me/janansink/10"
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1 border-2 border-black text-sm hover:opacity-90 transition-opacity whitespace-nowrap"
              style={{ backgroundColor: '#dce7d0' }}
            >
              10 €
            </a>
            <span className="py-1">·</span>
            <a 
              href="https://www.paypal.me/janansink/25"
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1 border-2 border-black text-sm hover:opacity-90 transition-opacity whitespace-nowrap"
              style={{ backgroundColor: '#ffd4e5' }}
            >
              25 €
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

// Imprint/Contact Page
function ImprintView({ onBack }) {
  return (
    <section className="space-y-6">
      <div className="flex items-center gap-2">
        <button 
          className="px-2 py-1 border-2 border-black"
          onClick={onBack}
        >
          ← Back
        </button>
        <h1 className="text-2xl font-black">Contact & Imprint</h1>
      </div>

      <div className="space-y-4">
        {/* English Version */}
        <div className="p-4 border-4 border-black">
          <h2 className="font-bold text-lg mb-2">Contact (English)</h2>
          <p className="mb-2">We'd love to hear from you.</p>
          <p className="mb-2">Got feedback, questions, or just want to say hi? Drop us a line anytime.</p>
          <div className="text-sm space-y-1">
            <div><strong>Email:</strong> hello@mirrio.app</div>
            <div><strong>Name:</strong> Jan Hendrik Ansink</div>
            <div><strong>Location:</strong> Berlin, Germany</div>
          </div>
        </div>

        <div className="p-4 border-4 border-black">
          <h2 className="font-bold text-lg mb-2">Imprint (English)</h2>
          <p className="mb-2">Responsible for the content according to § 5 TMG</p>
          <div className="text-sm space-y-1">
            <div>Jan Hendrik Ansink</div>
            <div>Berlin, Germany</div>
            <div><strong>Email:</strong> hello@mirrio.app</div>
          </div>
        </div>

        {/* German Version */}
        <div className="p-4 border-4 border-black bg-gray-50">
          <h2 className="font-bold text-lg mb-2">Kontakt (Deutsch)</h2>
          <p className="mb-2">Wir freuen uns auf deine Nachricht.</p>
          <p className="mb-2">Hast du Feedback, Fragen oder einfach Lust auf ein Hallo? Schreib uns jederzeit.</p>
          <div className="text-sm space-y-1">
            <div><strong>E-Mail:</strong> hello@mirrio.app</div>
            <div><strong>Name:</strong> Jan Hendrik Ansink</div>
            <div><strong>Ort:</strong> Berlin, Deutschland</div>
          </div>
        </div>

        <div className="p-4 border-4 border-black bg-gray-50">
          <h2 className="font-bold text-lg mb-2">Impressum (Deutsch)</h2>
          <p className="mb-2">Verantwortlich für den Inhalt gemäß § 5 TMG</p>
          <div className="text-sm space-y-1">
            <div>Jan Hendrik Ansink</div>
            <div>Berlin, Deutschland</div>
            <div><strong>E-Mail:</strong> hello@mirrio.app</div>
          </div>
        </div>
      </div>
    </section>
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
  const [password, setPassword] = useState("");
  const [usePassword, setUsePassword] = useState(true);
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
      
      {usePassword && (
        <>
          <label className="block text-sm font-bold">Password</label>
          <input 
            className="w-full p-3 border-4 border-black" 
            type="password"
            placeholder="••••••••" 
            value={password} 
            onChange={(e) => setPassword(e.target.value)} 
          />
        </>
      )}
      
      <button
        className="w-full p-3 border-4 border-black font-bold disabled:opacity-60"
        disabled={sending}
        onClick={async () => {
          if (!email.includes("@")) return alert("Enter a valid email");
          setSending(true);
          
          try {
            if (usePassword) {
              if (!password) return alert("Enter password");
              const { error } = await supabase.auth.signInWithPassword({
                email: email.trim(),
                password
              });
              if (error) throw error;
              location.reload();
            } else {
              const { error } = await supabase.auth.signInWithOtp({
                email: email.trim(),
                options: { emailRedirectTo: redirectBase + "/admin" },
              });
              if (error) throw error;
              alert("Magic link sent. Please open it and return to /admin.");
            }
          } catch (error) {
            alert(error.message);
          } finally {
            setSending(false);
          }
        }}
      >
        {sending ? "Loading..." : (usePassword ? "Sign in" : "Send Magic Link")}
      </button>
      
      <button
        className="w-full p-2 text-sm underline"
        onClick={() => setUsePassword(!usePassword)}
      >
        {usePassword ? "Use Magic Link instead" : "Use Password instead"}
      </button>
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