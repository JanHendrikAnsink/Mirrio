// src/lib/supaApi.js
import { supabase } from "../supabaseClient";

/** Auth helpers **/
export async function getUser() {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  return data.user ?? null;
}
export async function getUserId() {
  const u = await getUser();
  return u?.id ?? null;
}

/** -------------------- EDITIONS (CRUD) -------------------- **/
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
  const { error } = await supabase
    .from("editions")
    .delete()
    .eq("id", id);
  if (error) throw error;
  return true;
}

/** -------------------- STATEMENTS (CRUD) -------------------- **/
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
  const { error } = await supabase
    .from("statements")
    .delete()
    .eq("id", id);
  if (error) throw error;
  return true;
}

/** -------------------- Statement selection (server) -------------------- **/
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
