// src/lib/supaApi.js
import { supabase } from "../supabaseClient";

/** ===================== Auth helpers ===================== **/
export async function getUser() {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  return data.user ?? null;
}

export async function getUserId() {
  const u = await getUser();
  return u?.id ?? null;
}

/** ===================== Profiles ===================== **/
export async function getProfile(userId) {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .single();
  if (error && error.code !== 'PGRST116') throw error; // Ignore not found
  return data;
}

export async function upsertProfile({ id, email, firstName, lastName, imageUrl }) {
  const { data, error } = await supabase
    .from("profiles")
    .upsert({
      id,
      email,
      first_name: firstName,
      last_name: lastName,
      image_url: imageUrl
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** ===================== Editions CRUD ===================== **/
export async function listEditions() {
  const { data, error } = await supabase
    .from("editions")
    .select("*")
    .order("active", { ascending: false })
    .order("name", { ascending: true });
  if (error) throw error;
  return data;
}

export async function createEdition({ name, slug, active = true }) {
  const { data, error } = await supabase
    .from("editions")
    .insert({ name, slug, active })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function renameEdition(id, name) {
  const { data, error } = await supabase
    .from("editions")
    .update({ name })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function changeEditionSlug(id, slug) {
  const { data, error } = await supabase
    .from("editions")
    .update({ slug })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function toggleEditionActive(id, active) {
  const { data, error } = await supabase
    .from("editions")
    .update({ active })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteEdition(id) {
  const { error } = await supabase.from("editions").delete().eq("id", id);
  if (error) throw error;
  return true;
}

/** ===================== Statements CRUD ===================== **/
export async function listStatements({ editionId } = {}) {
  let q = supabase.from("statements").select("*").order("created_at", { ascending: false });
  if (editionId) q = q.eq("edition_id", editionId);
  const { data, error } = await q;
  if (error) throw error;
  return data;
}

export async function createStatement({ text, editionId }) {
  const { data, error } = await supabase
    .from("statements")
    .insert({ text: text.trim(), edition_id: editionId })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateStatementText(id, text) {
  const { data, error } = await supabase
    .from("statements")
    .update({ text })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteStatement(id) {
  const { error } = await supabase.from("statements").delete().eq("id", id);
  if (error) throw error;
  return true;
}

/** ===================== Groups ===================== **/
export async function listGroups() {
  const userId = await getUserId();
  if (!userId) throw new Error("Not authenticated");
  
  // Hole ALLE Gruppen und filtere dann
  const { data: allGroups, error } = await supabase
    .from("groups")
    .select(`
      *,
      editions(name, slug)
    `)
    .order("created_at", { ascending: false });
  
  if (error) throw error;
  
  // Hole alle Mitgliedschaften des Users
  const { data: memberships, error: memberError } = await supabase
    .from("group_members")
    .select("group_id")
    .eq("user_id", userId);
  
  if (memberError) {
    console.error("Error fetching memberships:", memberError);
  }
  
  const memberGroupIds = memberships?.map(m => m.group_id) || [];
  
  // Debug-Ausgabe
  console.log("User ID:", userId);
  console.log("Member of groups:", memberGroupIds);
  console.log("All groups:", allGroups?.map(g => ({ id: g.id, name: g.name, owner: g.owner })));
  
  // Return groups where user is owner OR member
  const userGroups = allGroups.filter(g => 
    g.owner === userId || memberGroupIds.includes(g.id)
  );
  
  console.log("Filtered groups for user:", userGroups);
  
  // Hole die Anzahl der Mitglieder für jede Gruppe
for (const group of userGroups) {
  const { data: members, error: membersError } = await supabase
    .rpc('get_group_members', { group_id_param: group.id });
  
  group.group_members = members || [];
}
  
  return userGroups;
}

export async function getGroup(groupId) {
  const { data: group, error } = await supabase
    .from("groups")
    .select(`
      *,
      editions(name, slug)
    `)
    .eq("id", groupId)
    .single();
  
  if (error) throw error;
  
  // Get members using RPC function to avoid recursion
  const { data: members, error: membersError } = await supabase
    .rpc('get_group_members', { group_id_param: groupId });
  
  if (membersError && membersError.message !== 'Not a member of this group') {
    console.error('Error fetching members:', membersError);
  }
  
  // Format to match expected structure
  group.group_members = members?.map(m => ({
    user_id: m.user_id,
    profiles: {
      id: m.user_id,
      email: m.email,
      first_name: m.first_name,
      last_name: m.last_name,
      image_url: m.image_url
    }
  })) || [];
  
  return group;
}

export async function createGroup({ name, editionId }) {
  const userId = await getUserId();
  if (!userId) throw new Error("Not authenticated");
  
  // Create group
  const { data: group, error: groupError } = await supabase
    .from("groups")
    .insert({ 
      name: name.trim(), 
      owner: userId, 
      edition_id: editionId 
    })
    .select()
    .single();
  
  if (groupError) throw groupError;
  
  // Add creator as member
  const { error: memberError } = await supabase
    .from("group_members")
    .insert({ 
      group_id: group.id, 
      user_id: userId 
    });
  
  if (memberError) throw memberError;
  
  return group;
}

// Use RPC function to avoid recursion
export async function addGroupMember(groupId, userId) {
  const { error } = await supabase
    .rpc('add_group_member', { 
      group_id_param: groupId, 
      user_id_param: userId 
    });
  
  if (error && error.code !== '23505') throw error; // Ignore duplicate
  return true;
}

export async function removeGroupMember(groupId, userId) {
  const { error } = await supabase
    .from("group_members")
    .delete()
    .eq("group_id", groupId)
    .eq("user_id", userId);
  
  if (error) throw error;
  return true;
}

// Get group members using RPC to avoid recursion
export async function getGroupMembers(groupId) {
  const { data, error } = await supabase
    .rpc('get_group_members', { group_id_param: groupId });
  
  if (error) throw error;
  return data;
}

/** ===================== Group Management ===================== **/
export async function leaveGroup(groupId) {
  const userId = await getUserId();
  if (!userId) throw new Error("Not authenticated");
  
  // Nutze removeGroupMember, um sich selbst zu entfernen
  return removeGroupMember(groupId, userId);
}

export async function renameGroup(groupId, newName) {
  const { data, error } = await supabase
    .from("groups")
    .update({ name: newName.trim() })
    .eq("id", groupId)
    .select()
    .single();
  
  if (error) throw error;
  return data;
}

export async function deleteGroup(groupId) {
  // Lösche zuerst alle abhängigen Daten in der richtigen Reihenfolge
  // (Alternativ: CASCADE DELETE in der Datenbank einrichten)
  
  try {
    // 1. Lösche Comments von Rounds dieser Gruppe
    const { data: rounds } = await supabase
      .from("rounds")
      .select("id")
      .eq("group_id", groupId);
    
    if (rounds && rounds.length > 0) {
      const roundIds = rounds.map(r => r.id);
      
      // Lösche Comments
      await supabase
        .from("comments")
        .delete()
        .in("round_id", roundIds);
      
      // Lösche Votes
      await supabase
        .from("votes")
        .delete()
        .in("round_id", roundIds);
      
      // Lösche Round Results
      await supabase
        .from("round_results")
        .delete()
        .in("round_id", roundIds);
      
      // Lösche Rounds
      await supabase
        .from("rounds")
        .delete()
        .eq("group_id", groupId);
    }
    
    // 2. Lösche Points
    await supabase
      .from("points")
      .delete()
      .eq("group_id", groupId);
    
    // 3. Lösche Group Members
    await supabase
      .from("group_members")
      .delete()
      .eq("group_id", groupId);
    
    // 4. Lösche Used Statements
    await supabase
      .from("group_used_statements")
      .delete()
      .eq("group_id", groupId);
    
    // 5. Lösche die Gruppe selbst
    const { error } = await supabase
      .from("groups")
      .delete()
      .eq("id", groupId);
    
    if (error) throw error;
    return true;
  } catch (error) {
    console.error("Error deleting group:", error);
    throw error;
  }
}

/** ===================== Rounds ===================== **/
export async function listRounds(groupId) {
  const { data, error } = await supabase
    .from("rounds")
    .select(`
      *,
      statements(id, text),
      round_results(winner, votes_count, closed_at)
    `)
    .eq("group_id", groupId)
    .order("issued_at", { ascending: false });
  
  if (error) throw error;
  return data;
}

export async function getActiveRound(groupId) {
  // Zuerst alle aktiven Rounds holen
  const { data: rounds, error } = await supabase
    .from("rounds")
    .select(`
      *,
      statements(id, text),
      votes(voter, target)
    `)
    .eq("group_id", groupId)
    .gt("expires_at", new Date().toISOString())
    .order("issued_at", { ascending: false });
  
  if (error) throw error;
  
  // Dann filtern wir die ohne round_results
  if (!rounds || rounds.length === 0) return null;
  
  // Check welche Rounds noch nicht geschlossen sind
  for (const round of rounds) {
    const { data: results } = await supabase
      .from("round_results")
      .select("*")
      .eq("round_id", round.id)
      .single();
    
    if (!results) {
      // Diese Round ist noch aktiv
      return round;
    }
  }
  
  return null; // Keine aktive Round gefunden
}

export async function createRound({ groupId, statementId, expiresIn = 24 * 60 * 60 * 1000 }) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + expiresIn);
  
  const { data, error } = await supabase
    .from("rounds")
    .insert({
      group_id: groupId,
      statement_id: statementId,
      issued_at: now.toISOString(),
      expires_at: expiresAt.toISOString()
    })
    .select()
    .single();
  
  if (error) throw error;
  return data;
}

export async function closeRound(roundId, winner, votesCount) {
  const { data, error } = await supabase
    .from("round_results")
    .insert({
      round_id: roundId,
      winner,
      votes_count: votesCount,
      closed_at: new Date().toISOString()
    })
    .select()
    .single();
  
  if (error) throw error;
  
  // Update points if there's a winner
  if (winner) {
    const { data: round } = await supabase
      .from("rounds")
      .select("group_id")
      .eq("id", roundId)
      .single();
    
    if (round) {
      await incrementPoints(winner, round.group_id, 1);
    }
  }
  
  return data;
}

/** ===================== Votes ===================== **/
export async function submitVote({ roundId, target }) {
  const userId = await getUserId();
  if (!userId) throw new Error("Not authenticated");
  
  const { data, error } = await supabase
    .from("votes")
    .upsert({
      round_id: roundId,
      voter: userId,
      target // can be null for abstain
    })
    .select()
    .single();
  
  if (error) throw error;
  return data;
}

export async function getVotes(roundId) {
  const { data, error } = await supabase
    .from("votes")
    .select(`
      *,
      voter_profile:profiles!voter(id, email, first_name, last_name),
      target_profile:profiles!target(id, email, first_name, last_name)
    `)
    .eq("round_id", roundId);
  
  if (error) throw error;
  return data;
}

/** ===================== Comments ===================== **/
export async function listComments(roundId) {
  const { data, error } = await supabase
    .from("comments")
    .select(`
      *,
      profiles!author(id, email, first_name, last_name, image_url)
    `)
    .eq("round_id", roundId)
    .order("created_at", { ascending: true });
  
  if (error) throw error;
  return data;
}

export async function createComment({ roundId, text }) {
  const userId = await getUserId();
  if (!userId) throw new Error("Not authenticated");
  
  const { data, error } = await supabase
    .from("comments")
    .insert({
      round_id: roundId,
      author: userId,
      text: text.trim()
    })
    .select(`
      *,
      profiles!author(id, email, first_name, last_name, image_url)
    `)
    .single();
  
  if (error) throw error;
  return data;
}

/** ===================== Points (Leaderboard) ===================== **/
export async function getLeaderboard(groupId) {
  const { data, error } = await supabase
    .from("points")
    .select(`
      *,
      profiles!user_id(id, email, first_name, last_name, image_url)
    `)
    .eq("group_id", groupId)
    .order("points", { ascending: false });
  
  if (error) throw error;
  return data;
}

export async function incrementPoints(userId, groupId, points = 1) {
  // First try to update existing record
  const { data: existing } = await supabase
    .from("points")
    .select("points")
    .eq("user_id", userId)
    .eq("group_id", groupId)
    .single();
  
  if (existing) {
    const { error } = await supabase
      .from("points")
      .update({ points: existing.points + points })
      .eq("user_id", userId)
      .eq("group_id", groupId);
    
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from("points")
      .insert({ user_id: userId, group_id: groupId, points });
    
    if (error) throw error;
  }
  
  return true;
}

/** ===================== Statement selection ===================== **/
export async function rpcNextStatementForGroup(groupId) {
  const { data, error } = await supabase.rpc("next_statement_for_group", { g: groupId });
  if (error) throw error;
  return data ?? null;
}

export async function markStatementUsed(groupId, statementId) {
  const { error } = await supabase
    .from("group_used_statements")
    .insert({ group_id: groupId, statement_id: statementId });
  if (error) throw error;
  return true;
}

/** ===================== Invitations ===================== **/
export async function joinGroupByInvite(inviteCode) {
  const userId = await getUserId();
  if (!userId) throw new Error("Not authenticated");
  
  // inviteCode is the group_id for now
  // Use RPC function to avoid recursion issues
  return addGroupMember(inviteCode, userId);
}