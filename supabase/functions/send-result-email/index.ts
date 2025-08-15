import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const SENDGRID_API_KEY = Deno.env.get('SMTP_PASSWORD')! // Dein SendGrid API Key
const SENDER_EMAIL = Deno.env.get('SMTP_FROM') || 'noreply@mirrio.app'

serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      },
    });
  }

  try {
    // Parse request body
    const bodyText = await req.text();
    const { record } = JSON.parse(bodyText);
    
    console.log('Round closed:', record.round_id);
    
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    
    // Hole Round-Details mit allen Relationen
    const { data: round, error: roundError } = await supabase
      .from('rounds')
      .select(`
        *,
        groups(id, name),
        statements(text)
      `)
      .eq('id', record.round_id)
      .single()
    
    if (roundError) {
      console.error('Error fetching round:', roundError);
      throw roundError;
    }
    
    // Hole alle Votes für die Abstimmung
    const { data: votes } = await supabase
      .from('votes')
      .select('target')
      .eq('round_id', record.round_id)
    
    // Zähle Stimmen pro Person
    const voteCounts: Record<string, number> = {}
    votes?.forEach(v => {
      if (v.target) {
        voteCounts[v.target] = (voteCounts[v.target] || 0) + 1
      }
    })
    
    // Sortiere nach Stimmen und hole Top 3
    const results = Object.entries(voteCounts)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 3)
    
    // Hole Gewinner-Info
    let winnerName = 'Nobody'
    let winnerEmail = ''
    if (record.winner) {
      const { data: winner } = await supabase
        .from('profiles')
        .select('first_name, last_name, email')
        .eq('id', record.winner)
        .single()
      
      if (winner) {
        winnerName = winner.first_name || winner.last_name ? 
          `${winner.first_name || ''} ${winner.last_name || ''}`.trim() : 
          winner.email
        winnerEmail = winner.email
      }
    }
    
    // Hole alle Gruppenmitglieder
    const { data: members } = await supabase
      .from('group_members')
      .select('profiles(id, email, first_name, last_name)')
      .eq('group_id', round.groups.id)
    
    // Erstelle Leaderboard mit Namen
    const leaderboard = await Promise.all(
      results.map(async ([userId, voteCount]) => {
        const { data: profile } = await supabase
          .from('profiles')
          .select('first_name, last_name, email')
          .eq('id', userId)
          .single()
        
        const name = profile?.first_name || profile?.last_name ?
          `${profile.first_name || ''} ${profile.last_name || ''}`.trim() :
          profile?.email || 'Anonymous'
        
        return {
          name,
          votes: voteCount
        }
      })
    )
    
    console.log(`Sending result emails to ${members?.length} members in group "${round.groups.name}"`);
    console.log(`Winner: ${winnerName} with ${record.votes_count || 0} votes`);
    
    let emailsSent = 0;
    let emailErrors = [];
    
    // Sende Emails via SendGrid API
    for (const member of members || []) {
      if (!member.profiles?.email) {
        console.log('Skipping member without email');
        continue;
      }
      
      const memberName = member.profiles?.first_name || 'there';
      const memberEmail = member.profiles.email;
      const isWinner = member.profiles.id === record.winner;
      
      const emailHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #ffffff;">
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #000; font-size: 32px; font-weight: 900; margin: 0;">MIRRIO</h1>
          </div>
          
          <h2 style="color: #000; font-size: 24px; margin-bottom: 20px;">
            🏆 Voting Results ${isWinner ? '- Congratulations! 🎉' : ''}
          </h2>
          
          <p style="color: #333; font-size: 16px; line-height: 1.5;">
            Hi ${memberName}! The voting for <strong>${round.groups.name}</strong> has ended.
          </p>
          
          <div style="background: #f0f0f0; border: 4px solid black; padding: 20px; margin: 20px 0;">
            <p style="margin: 0 0 10px 0; font-size: 14px; color: #666;">The statement was:</p>
            <h3 style="margin: 0; color: #000; font-size: 18px;">
              "${round.statements.text}"
            </h3>
          </div>
          
          ${isWinner ? `
          <div style="background: #fed89e; border: 4px solid black; padding: 20px; margin: 20px 0; text-align: center;">
            <h3 style="margin: 0 0 10px 0; color: #000; font-size: 24px;">🎉 YOU WON! 🎉</h3>
            <p style="margin: 0; font-size: 16px;">
              With ${record.votes_count || 0} vote${record.votes_count !== 1 ? 's' : ''}!
            </p>
          </div>
          ` : `
          <div style="background: #fed89e; border: 4px solid black; padding: 20px; margin: 20px 0;">
            <h3 style="margin: 0 0 10px 0; color: #000; font-size: 20px;">
              👑 Winner: ${winnerName}
            </h3>
            <p style="margin: 0; font-size: 14px;">
              With ${record.votes_count || 0} vote${record.votes_count !== 1 ? 's' : ''}!
            </p>
          </div>
          `}
          
          ${leaderboard.length > 0 ? `
          <div style="border: 4px solid black; padding: 20px; margin: 20px 0;">
            <h4 style="margin: 0 0 15px 0; font-size: 16px;">Top Votes:</h4>
            <ol style="margin: 0; padding-left: 20px;">
              ${leaderboard.map((l, idx) => `
                <li style="margin: 5px 0; font-size: 14px;">
                  <strong>${l.name}</strong> - ${l.votes} vote${l.votes !== 1 ? 's' : ''}
                  ${idx === 0 && l.votes > 0 ? ' 👑' : ''}
                </li>
              `).join('')}
            </ol>
          </div>
          ` : ''}
          
          <p style="color: #333; font-size: 16px; line-height: 1.5; margin: 20px 0;">
            Join the discussion in the app and see all the details!
          </p>
          
          <div style="text-align: center; margin: 40px 0;">
            <a href="https://mirrio.app" 
               style="display: inline-block; background: #d8e1fc; border: 4px solid black; padding: 15px 30px; text-decoration: none; color: black; font-weight: bold; font-size: 16px;">
              View Details →
            </a>
          </div>
          
          <hr style="margin: 40px 0; border: none; border-top: 1px solid #eee;">
          
          <p style="color: #999; font-size: 12px; text-align: center;">
            The next statement will drop in 48 hours!<br>
            You're receiving this because you're a member of ${round.groups.name} on Mirrio.
          </p>
        </body>
        </html>
      `;
      
      // Plain text version
      const emailText = `
Hi ${memberName}!

The voting for ${round.groups.name} has ended.

The statement was:
"${round.statements.text}"

${isWinner ? 
  `🎉 CONGRATULATIONS - YOU WON! 🎉\nWith ${record.votes_count || 0} vote${record.votes_count !== 1 ? 's' : ''}!` :
  `Winner: ${winnerName}\nWith ${record.votes_count || 0} vote${record.votes_count !== 1 ? 's' : ''}!`
}

${leaderboard.length > 0 ? `
Top Votes:
${leaderboard.map((l, idx) => `${idx + 1}. ${l.name} - ${l.votes} vote${l.votes !== 1 ? 's' : ''}`).join('\n')}
` : ''}

Join the discussion at: https://mirrio.app

The next statement will drop in 48 hours!

---
You're receiving this because you're a member of ${round.groups.name} on Mirrio.
      `.trim();
      
      try {
        // SendGrid API Request
        const sendgridResponse = await fetch('https://api.sendgrid.com/v3/mail/send', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${SENDGRID_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            personalizations: [{
              to: [{ email: memberEmail }]
            }],
            from: { 
              email: SENDER_EMAIL,
              name: 'Mirrio'
            },
            subject: `🏆 Results: "${round.statements.text}" - ${round.groups.name}`,
            content: [
              {
                type: 'text/plain',
                value: emailText
              },
              {
                type: 'text/html',
                value: emailHtml
              }
            ]
          })
        });
        
        if (sendgridResponse.ok) {
          console.log(`✅ Result email sent to ${memberEmail}${isWinner ? ' (WINNER)' : ''}`);
          emailsSent++;
        } else {
          const errorText = await sendgridResponse.text();
          console.error(`❌ SendGrid error for ${memberEmail}:`, sendgridResponse.status, errorText);
          emailErrors.push({ 
            email: memberEmail, 
            error: `SendGrid ${sendgridResponse.status}: ${errorText}` 
          });
        }
        
      } catch (emailError) {
        console.error(`❌ Failed to send to ${memberEmail}:`, emailError);
        emailErrors.push({ 
          email: memberEmail, 
          error: emailError.message 
        });
      }
      
      // Small delay between emails to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // Success response
    return new Response(JSON.stringify({ 
      success: true,
      message: 'Result emails processed',
      stats: {
        group: round.groups.name,
        statement: round.statements.text,
        winner: winnerName,
        totalMembers: members?.length || 0,
        emailsSent,
        emailErrors: emailErrors.length
      },
      errors: emailErrors
    }), {
      status: 200,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    })
    
  } catch (error) {
    console.error('Error:', error);
    
    return new Response(JSON.stringify({ 
      success: false,
      error: error.message,
      stack: error.stack
    }), {
      status: 500,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    })
  }
})