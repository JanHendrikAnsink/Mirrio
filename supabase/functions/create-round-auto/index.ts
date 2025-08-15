import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

serve(async (req) => {
  try {
    console.log('Auto-create rounds cron job started');
    
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    
    // Hole alle Gruppen
    const { data: groups, error: groupsError } = await supabase
      .from('groups')
      .select('id, name, edition_id')
    
    if (groupsError) throw groupsError;
    
    console.log(`Processing ${groups?.length || 0} groups`);
    
    let roundsCreated = 0;
    
    for (const group of groups || []) {
      // Prüfe ob Gruppe eine aktive Round hat
      const { data: activeRounds } = await supabase
        .from('rounds')
        .select('id')
        .eq('group_id', group.id)
        .gt('expires_at', new Date().toISOString())
        .is('round_results.closed_at', null)
      
      if (activeRounds && activeRounds.length > 0) {
        console.log(`Group ${group.name} has active round, skipping`);
        continue;
      }
      
      // Hole letzte Round um zu prüfen ob 48h vergangen sind
      const { data: lastRound } = await supabase
        .from('rounds')
        .select('issued_at')
        .eq('group_id', group.id)
        .order('issued_at', { ascending: false })
        .limit(1)
        .single()
      
      if (lastRound) {
        const hoursSinceLastRound = (Date.now() - new Date(lastRound.issued_at).getTime()) / (1000 * 60 * 60);
        if (hoursSinceLastRound < 48) {
          console.log(`Group ${group.name}: Only ${hoursSinceLastRound.toFixed(1)}h since last round, skipping`);
          continue;
        }
      }
      
      // Hole nächstes Statement über RPC function
      const { data: nextStatement, error: stmtError } = await supabase
        .rpc('next_statement_for_group', { g: group.id })
        .single()
      
      if (stmtError || !nextStatement) {
        console.log(`Group ${group.name}: No unused statements available`);
        continue;
      }
      
      // Erstelle neue Round (24h Laufzeit)
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + 24);
      
      const { error: roundError } = await supabase
        .from('rounds')
        .insert({
          group_id: group.id,
          statement_id: nextStatement.id,
          issued_at: new Date().toISOString(),
          expires_at: expiresAt.toISOString()
        })
      
      if (roundError) {
        console.error(`Error creating round for ${group.name}:`, roundError);
        continue;
      }
      
      // Markiere Statement als verwendet
      await supabase
        .from('group_used_statements')
        .insert({
          group_id: group.id,
          statement_id: nextStatement.id
        })
      
      console.log(`Created round for group ${group.name} with statement: ${nextStatement.text}`);
      roundsCreated++;
    }
    
    return new Response(
      JSON.stringify({ 
        success: true, 
        groupsProcessed: groups?.length || 0,
        roundsCreated 
      }),
      { headers: { 'Content-Type': 'application/json' } }
    )
    
  } catch (error) {
    console.error('Cron job error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
})