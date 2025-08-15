import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

serve(async (req) => {
  try {
    console.log('========================================');
    console.log('Auto-process rounds cron job started at', new Date().toISOString());
    console.log('========================================');
    
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    
    let roundsClosed = 0;
    let roundsCreated = 0;
    let emailsSent = 0;
    
    // ========================================
    // TEIL 1: Schließe abgelaufene Rounds & sende Result-Emails
    // ========================================
    console.log('\n📊 STEP 1: Checking for expired rounds to close...');
    
    // Hole alle abgelaufenen Rounds ohne round_results
    const { data: expiredRounds, error: expiredError } = await supabase
      .from('rounds')
      .select(`
        id, 
        group_id,
        statement_id,
        expires_at,
        groups!inner(name),
        statements!inner(text)
      `)
      .lt('expires_at', new Date().toISOString());
    
    if (expiredError) {
      console.error('Error fetching expired rounds:', expiredError);
    } else {
      console.log(`Found ${expiredRounds?.length || 0} potentially expired rounds`);
      
      for (const round of expiredRounds || []) {
        // Prüfe ob bereits ein round_result existiert
        const { data: existingResult } = await supabase
          .from('round_results')
          .select('id')
          .eq('round_id', round.id)
          .single();
        
        if (existingResult) {
          console.log(`Round ${round.id} already closed, skipping`);
          continue;
        }
        
        // Hole alle Votes für diese Round
        const { data: votes } = await supabase
          .from('votes')
          .select('voter, target')
          .eq('round_id', round.id);
        
        // Zähle Votes
        const voteCounts: Record<string, number> = {};
        votes?.forEach((v) => {
          if (v.target) {
            voteCounts[v.target] = (voteCounts[v.target] || 0) + 1;
          }
        });
        
        // Bestimme Gewinner
        const maxVotes = Math.max(0, ...Object.values(voteCounts));
        const winners = Object.entries(voteCounts)
          .filter(([, count]) => count === maxVotes)
          .map(([userId]) => userId);
        
        const winner = winners.length === 1 ? winners[0] : null;
        
        console.log(`Closing round ${round.id} for group "${round.groups.name}"`);
        console.log(`Statement: "${round.statements.text}"`);
        console.log(`Winner: ${winner || 'None'} with ${maxVotes} votes`);
        
        // Schließe Round
        const { data: newResult, error: closeError } = await supabase
          .from('round_results')
          .insert({
            round_id: round.id,
            winner: winner,
            votes_count: maxVotes,
            closed_at: new Date().toISOString()
          })
          .select()
          .single();
        
        if (closeError) {
          console.error(`Error closing round ${round.id}:`, closeError);
          continue;
        }
        
        roundsClosed++;
        
        // Update points wenn es einen Gewinner gibt
        if (winner) {
          // Prüfe ob points record existiert
          const { data: existingPoints } = await supabase
            .from('points')
            .select('points')
            .eq('user_id', winner)
            .eq('group_id', round.group_id)
            .single();
          
          if (existingPoints) {
            await supabase
              .from('points')
              .update({ points: existingPoints.points + 1 })
              .eq('user_id', winner)
              .eq('group_id', round.group_id);
          } else {
            await supabase
              .from('points')
              .insert({ 
                user_id: winner, 
                group_id: round.group_id, 
                points: 1 
              });
          }
        }
        
        // Sende Result-Email
        try {
          console.log('Sending result email...');
          const { data: emailResult, error: emailError } = await supabase.functions.invoke(
            'send-result-email',
            {
              body: { record: newResult }
            }
          );
          
          if (emailError) {
            console.error('Error sending result email:', emailError);
          } else {
            console.log('Result email sent successfully');
            emailsSent++;
          }
        } catch (e) {
          console.error('Exception sending result email:', e);
        }
      }
    }
    
    // ========================================
    // TEIL 2: Prüfe ob alle gevoted haben (vorzeitiges Schließen)
    // ========================================
    console.log('\n🗳️ STEP 2: Checking for rounds where everyone voted...');
    
    const { data: activeRounds } = await supabase
      .from('rounds')
      .select(`
        id,
        group_id,
        groups!inner(name),
        statements!inner(text)
      `)
      .gt('expires_at', new Date().toISOString());
    
    for (const round of activeRounds || []) {
      // Prüfe ob bereits geschlossen
      const { data: existingResult } = await supabase
        .from('round_results')
        .select('id')
        .eq('round_id', round.id)
        .single();
      
      if (existingResult) continue;
      
      // Hole Anzahl Mitglieder
      const { count: memberCount } = await supabase
        .from('group_members')
        .select('*', { count: 'exact', head: true })
        .eq('group_id', round.group_id);
      
      // Hole Anzahl Votes
      const { count: voteCount } = await supabase
        .from('votes')
        .select('*', { count: 'exact', head: true })
        .eq('round_id', round.id);
      
      if (memberCount && voteCount && voteCount >= memberCount) {
        console.log(`All ${memberCount} members voted for round ${round.id}, closing early`);
        
        // Hole Votes und schließe Round
        const { data: votes } = await supabase
          .from('votes')
          .select('voter, target')
          .eq('round_id', round.id);
        
        const voteCounts: Record<string, number> = {};
        votes?.forEach((v) => {
          if (v.target) {
            voteCounts[v.target] = (voteCounts[v.target] || 0) + 1;
          }
        });
        
        const maxVotes = Math.max(0, ...Object.values(voteCounts));
        const winners = Object.entries(voteCounts)
          .filter(([, count]) => count === maxVotes)
          .map(([userId]) => userId);
        const winner = winners.length === 1 ? winners[0] : null;
        
        const { data: newResult, error: closeError } = await supabase
          .from('round_results')
          .insert({
            round_id: round.id,
            winner: winner,
            votes_count: maxVotes,
            closed_at: new Date().toISOString()
          })
          .select()
          .single();
        
        if (!closeError && newResult) {
          roundsClosed++;
          
          // Update points
          if (winner) {
            const { data: existingPoints } = await supabase
              .from('points')
              .select('points')
              .eq('user_id', winner)
              .eq('group_id', round.group_id)
              .single();
            
            if (existingPoints) {
              await supabase
                .from('points')
                .update({ points: existingPoints.points + 1 })
                .eq('user_id', winner)
                .eq('group_id', round.group_id);
            } else {
              await supabase
                .from('points')
                .insert({ 
                  user_id: winner, 
                  group_id: round.group_id, 
                  points: 1 
                });
            }
          }
          
          // Sende Result-Email
          try {
            const { error: emailError } = await supabase.functions.invoke(
              'send-result-email',
              { body: { record: newResult } }
            );
            if (!emailError) emailsSent++;
          } catch (e) {
            console.error('Exception sending result email:', e);
          }
        }
      }
    }
    
    // ========================================
    // TEIL 3: Erstelle neue Rounds & sende New-Round-Emails
    // ========================================
    console.log('\n🎯 STEP 3: Creating new rounds for groups...');
    
    const { data: groups, error: groupsError } = await supabase
      .from('groups')
      .select('id, name, edition_id')
    
    if (groupsError) {
      console.error('Error fetching groups:', groupsError);
    } else {
      console.log(`Processing ${groups?.length || 0} groups for new rounds`);
      
      for (const group of groups || []) {
        // Prüfe ob Gruppe eine aktive Round hat
        const { data: activeRounds } = await supabase
          .from('rounds')
          .select('id')
          .eq('group_id', group.id)
          .gt('expires_at', new Date().toISOString());
        
        if (activeRounds && activeRounds.length > 0) {
          console.log(`Group "${group.name}" has active round, skipping`);
          continue;
        }
        
        // Prüfe ob round_results ohne aktive round existiert (noch nicht neue Round erstellt)
        const { data: unprocessedResults } = await supabase
          .from('rounds')
          .select(`
            id,
            issued_at,
            round_results!inner(closed_at)
          `)
          .eq('group_id', group.id)
          .order('issued_at', { ascending: false })
          .limit(1);
        
        if (unprocessedResults && unprocessedResults.length > 0) {
          const lastRound = unprocessedResults[0];
          const hoursSinceClose = (Date.now() - new Date(lastRound.round_results[0].closed_at).getTime()) / (1000 * 60 * 60);
          
          // Warte 48h nach dem Schließen der letzten Round
          if (hoursSinceClose < 48) {
            console.log(`Group "${group.name}": Only ${hoursSinceClose.toFixed(1)}h since last round closed, skipping`);
            continue;
          }
        }
        
        // Hole nächstes Statement (direkt ohne RPC um Fehler zu vermeiden)
        const { data: allStatements } = await supabase
          .from('statements')
          .select('*')
          .eq('edition_id', group.edition_id)
          .eq('deleted', false);
        
        const { data: usedStatements } = await supabase
          .from('group_used_statements')
          .select('statement_id')
          .eq('group_id', group.id);
        
        const usedIds = usedStatements?.map(u => u.statement_id) || [];
        const unusedStatements = allStatements?.filter(s => !usedIds.includes(s.id)) || [];
        
        if (unusedStatements.length === 0) {
          console.log(`Group "${group.name}": No unused statements available`);
          continue;
        }
        
        // Wähle zufälliges Statement
        const randomIndex = Math.floor(Math.random() * unusedStatements.length);
        const nextStatement = unusedStatements[randomIndex];
        
        // Erstelle neue Round (24h Laufzeit)
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
        
        if (roundError) {
          console.error(`Error creating round for "${group.name}":`, roundError);
          continue;
        }
        
        console.log(`Created round for group "${group.name}"`);
        console.log(`Statement: "${nextStatement.text}"`);
        roundsCreated++;
        
        // Markiere Statement als verwendet
        await supabase
          .from('group_used_statements')
          .insert({
            group_id: group.id,
            statement_id: nextStatement.id
          });
        
        // Sende New-Round-Email
        try {
          console.log('Sending new round email...');
          const { data: emailResult, error: emailError } = await supabase.functions.invoke(
            'send-round-email',
            {
              body: { record: newRound }
            }
          );
          
          if (emailError) {
            console.error('Error sending new round email:', emailError);
          } else {
            console.log('New round email sent successfully');
            emailsSent++;
          }
        } catch (e) {
          console.error('Exception sending new round email:', e);
        }
      }
    }
    
    // ========================================
    // Zusammenfassung
    // ========================================
    console.log('\n========================================');
    console.log('✅ CRON JOB COMPLETED');
    console.log('========================================');
    console.log(`Rounds closed: ${roundsClosed}`);
    console.log(`Rounds created: ${roundsCreated}`);
    console.log(`Emails sent: ${emailsSent}`);
    console.log('========================================\n');
    
    return new Response(
      JSON.stringify({ 
        success: true, 
        roundsClosed,
        roundsCreated,
        emailsSent,
        timestamp: new Date().toISOString()
      }),
      { headers: { 'Content-Type': 'application/json' } }
    )
    
  } catch (error) {
    console.error('❌ CRON JOB ERROR:', error);
    return new Response(
      JSON.stringify({ 
        error: error.message,
        timestamp: new Date().toISOString()
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
})