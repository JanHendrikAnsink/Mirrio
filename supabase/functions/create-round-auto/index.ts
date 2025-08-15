import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

serve(async (req) => {
  try {
    console.log('Auto-create/close rounds cron job started');
    
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    
    // ========================================
    // TEIL 1: Schließe abgelaufene Rounds
    // ========================================
    const { data: expiredRounds } = await supabase
      .from('rounds')
      .select(`
        id, 
        group_id,
        expires_at,
        votes(voter, target)
      `)
      .lt('expires_at', new Date().toISOString())
      .is('round_results.closed_at', null);
    
    console.log(`Found ${expiredRounds?.length || 0} expired rounds to close`);
    
    for (const round of expiredRounds || []) {
      // Zähle Votes
      const voteCounts: Record<string, number> = {};
      round.votes?.forEach((v: any) => {
        if (v.target) {
          voteCounts[v.target] = (voteCounts[v.target] || 0) + 1;
        }
      });
      
      const maxVotes = Math.max(0, ...Object.values(voteCounts));
      const winners = Object.entries(voteCounts)
        .filter(([, count]) => count === maxVotes)
        .map(([userId]) => userId);
      
      const winner = winners.length === 1 ? winners[0] : null;
      
      // Schließe Round
      const { error: closeError } = await supabase
        .from('round_results')
        .insert({
          round_id: round.id,
          winner,
          votes_count: maxVotes,
          closed_at: new Date().toISOString()
        });
      
      if (!closeError) {
        console.log(`Closed round ${round.id} with winner ${winner}`);
        
        // Sende Result-Email via Edge Function
        await supabase.functions.invoke('send-result-email', {
          body: { 
            record: {
              round_id: round.id,
              winner,
              votes_count: maxVotes,
              closed_at: new Date().toISOString()
            }
          }
        });
      }
    }
    
    // ========================================
    // TEIL 2: Erstelle neue Rounds (wie bisher)
    // ========================================
    const { data: groups } = await supabase
      .from('groups')
      .select('id, name, edition_id');
    
    console.log(`Processing ${groups?.length || 0} groups for new rounds`);
    
    let roundsCreated = 0;
    
    for (const group of groups || []) {
      // Prüfe ob Gruppe eine aktive Round hat
      const { data: activeRounds } = await supabase
        .from('rounds')
        .select('id')
        .eq('group_id', group.id)
        .gt('expires_at', new Date().toISOString());
      
      if (activeRounds && activeRounds.length > 0) {
        continue;
      }
      
      // Prüfe ob 48h seit letzter Round
      const { data: lastRound } = await supabase
        .from('rounds')
        .select('issued_at')
        .eq('group_id', group.id)
        .order('issued_at', { ascending: false })
        .limit(1)
        .single();
      
      if (lastRound) {
        const hoursSinceLastRound = (Date.now() - new Date(lastRound.issued_at).getTime()) / (1000 * 60 * 60);
        if (hoursSinceLastRound < 48) {
          continue;
        }
      }
      
      // Hole nächstes Statement
      const { data: nextStatement } = await supabase
        .rpc('next_statement_for_group', { g: group.id })
        .single();
      
      if (!nextStatement) continue;
      
      // Erstelle neue Round
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + 24);
      
      const { data: newRound, error: roundError } = await supabase
        .from('rounds')
        .insert({
          group_id: group.id,
          statement_id: nextStatement.id,
          issued_at: new Date().toISOString(),
          expires_at: expiresAt.toISOString()
        })
        .select()
        .single();
      
      if (!roundError && newRound) {
        // Markiere Statement als verwendet
        await supabase
          .from('group_used_statements')
          .insert({
            group_id: group.id,
            statement_id: nextStatement.id
          });
        
        // Sende New-Round-Email
        await supabase.functions.invoke('send-round-email', {
          body: { record: newRound }
        });
        
        console.log(`Created round for ${group.name}`);
        roundsCreated++;
      }
    }
    
    return new Response(
      JSON.stringify({ 
        success: true,
        roundsClosed: expiredRounds?.length || 0,
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