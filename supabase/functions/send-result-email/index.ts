import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { SmtpClient } from 'https://deno.land/x/smtp@v0.7.0/mod.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const SMTP_HOSTNAME = Deno.env.get('SMTP_HOSTNAME')!
const SMTP_PORT = parseInt(Deno.env.get('SMTP_PORT') || '587')
const SMTP_USERNAME = Deno.env.get('SMTP_USERNAME')!
const SMTP_PASSWORD = Deno.env.get('SMTP_PASSWORD')!
const SMTP_FROM = Deno.env.get('SMTP_FROM') || 'noreply@mirrio.app'

serve(async (req) => {
  try {
    const { record } = await req.json()
    console.log('Round closed:', record)
    
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    
    // Hole Round-Details
    const { data: round } = await supabase
      .from('rounds')
      .select(`
        *,
        groups(name),
        statements(text)
      `)
      .eq('id', record.round_id)
      .single()
    
    // Hole Voting-Ergebnisse
    const { data: votes } = await supabase
      .from('votes')
      .select('target')
      .eq('round_id', record.round_id)
    
    // Zähle Stimmen
    const voteCounts: Record<string, number> = {}
    votes?.forEach(v => {
      if (v.target) {
        voteCounts[v.target] = (voteCounts[v.target] || 0) + 1
      }
    })
    
    // Sortiere nach Stimmen
    const results = Object.entries(voteCounts)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 3) // Top 3
    
    // Hole Gewinner-Info
    let winnerName = 'Nobody'
    if (record.winner) {
      const { data: winner } = await supabase
        .from('profiles')
        .select('first_name, last_name, email')
        .eq('id', record.winner)
        .single()
      
      winnerName = winner?.first_name || winner?.email || 'Unknown'
    }
    
    // Hole alle Mitglieder
    const { data: members } = await supabase
      .from('group_members')
      .select('profiles(id, email, first_name)')
      .eq('group_id', round.group_id)
    
    // Hole Top 3 mit Namen
    const leaderboard = await Promise.all(
      results.map(async ([userId, voteCount]) => {
        const { data: profile } = await supabase
          .from('profiles')
          .select('first_name, last_name')
          .eq('id', userId)
          .single()
        
        return {
          name: profile?.first_name || 'Anonymous',
          votes: voteCount
        }
      })
    )
    
    console.log(`Sending result emails to ${members?.length} members`)
    
    // SMTP Client erstellen
    const client = new SmtpClient()
    
    try {
      // Verbinde zu SMTP Server
      await client.connectTLS({
        hostname: SMTP_HOSTNAME,
        port: SMTP_PORT,
        username: SMTP_USERNAME,
        password: SMTP_PASSWORD,
      })
      
      // Sende Emails an alle Mitglieder
      for (const member of members || []) {
        if (!member.profiles?.email) continue
        
        const emailHtml = `
          <html>
          <body style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
            <h2>🏆 Voting Results - ${round.groups.name}</h2>
            
            <div style="background: #f0f0f0; border: 4px solid black; padding: 20px; margin: 20px 0;">
              <p style="margin: 0 0 10px 0;"><strong>Statement:</strong></p>
              <h3 style="margin: 0;">"${round.statements.text}"</h3>
            </div>
            
            <div style="background: #fed89e; border: 4px solid black; padding: 20px; margin: 20px 0;">
              <h3 style="margin: 0 0 10px 0;">👑 Winner: ${winnerName}</h3>
              <p style="margin: 0;">With ${record.votes_count || 0} votes!</p>
            </div>
            
            ${leaderboard.length > 0 ? `
              <div style="border: 4px solid black; padding: 20px; margin: 20px 0;">
                <h4 style="margin: 0 0 10px 0;">Top Votes:</h4>
                <ol style="margin: 0; padding-left: 20px;">
                  ${leaderboard.map(l => `
                    <li>${l.name} - ${l.votes} vote${l.votes !== 1 ? 's' : ''}</li>
                  `).join('')}
                </ol>
              </div>
            ` : ''}
            
            <p>Join the discussion and see all comments in the app!</p>
            
            <table cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="background: #d8e1fc; border: 4px solid black; padding: 12px 24px;">
                  <a href="https://mirrio.app" 
                     style="text-decoration: none; color: black; font-weight: bold;">
                    View Details →
                  </a>
                </td>
              </tr>
            </table>
            
            <hr style="margin: 30px 0; border: 1px solid #eee;">
            
            <p style="color: #666; font-size: 12px;">
              Next statement drops in 48 hours!<br>
              You're receiving this because you're a member of ${round.groups.name} on Mirrio.
            </p>
          </body>
          </html>
        `
        
        try {
          await client.send({
            from: SMTP_FROM,
            to: member.profiles.email,
            subject: `🏆 Results: "${round.statements.text}" - ${round.groups.name}`,
            content: emailHtml,
            html: emailHtml,
          })
          
          console.log(`Result email sent to ${member.profiles.email}`)
        } catch (emailError) {
          console.error(`Failed to send to ${member.profiles.email}:`, emailError)
        }
      }
      
      // Schließe SMTP Verbindung
      await client.close()
      
    } catch (smtpError) {
      console.error('SMTP Error:', smtpError)
      // Fallback ohne Email
    }
    
    return new Response(JSON.stringify({ 
      success: true, 
      winner: winnerName,
      members: members?.length 
    }), {
      headers: { 'Content-Type': 'application/json' },
      status: 200
    })
    
  } catch (error) {
    console.error('Error:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }
})