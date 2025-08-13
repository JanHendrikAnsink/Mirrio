// src/lib/supaApi.js
import { supabase } from "../supabaseClient";

export async function getUser() {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  return data.user ?? null;
}
export async function getUserId() {
  const u = await getUser();
  return u?.id ?? null;
}

/** Editions & Statements (reads) **/
export async function listEditions() {
  const { data, error } = await supabase
    .from("editions")
    .select("*")
    .order("active", { ascending: false })
    .order("name", { ascending: true });
  if (error) throw error;
  return data;
}
export async function listStatements({ editionId } = {}) {
  let q = supabase.from("statements").select("*").order("created_at", { ascending: false });
  if (editionId) q = q.eq("edition_id", editionId);
  const { data, error } = await q;
  if (error) throw error;
  return data;
}

/** Statement selection + mark used (server) **/
export async function rpcNextStatementForGroup(groupId) {
  const { data, error } = await supabase.rpc("next_statement_for_group", { g: groupId });
  if (error) throw error;
  return data ?? null; // { id, text, edition_id } | null
}
export async function markStatementUsed(groupId, statementId) {
  const { error } = await supabase
    .from("group_used_statements")
    .insert({ group_id: groupId, statement_id: statementId });
  if (error) throw error;
  return true;
}
