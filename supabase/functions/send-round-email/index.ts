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
    console.log('New round created:', record)
    
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    
    // Hole alle Daten
    const { data: group } = await supabase
      .from('groups')
      .select('name')
      .eq('id', record.group_id)
      .single()
    
    const { data: statement } = await supabase
      .from('statements')
      .select('text')
      .eq('id', record.statement_id)
      .single()
    
    const { data: members } = await supabase
      .from('group_members')
      .select('profiles(email, first_name)')
      .eq('group_id', record.group_id)
    
    console.log(`Sending emails to ${members?.length} members`)
    
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
            <h2 style="color: #000;">Hi ${member.profiles?.first_name || 'there'}!</h2>
            
            <p>A new statement just dropped in <strong>${group.name}</strong>:</p>
            
            <div style="background: #fed89e; border: 4px solid black; padding: 20px; margin: 20px 0;">
              <h3 style="margin: 0; color: #000;">"${statement.text}"</h3>
            </div>
            
            <p><strong>⏰ You have 24 hours to vote!</strong></p>
            
            <p>Think about who in your group this statement fits best, then cast your anonymous vote.</p>
            
            <table cellpadding="0" cellspacing="0" border="0" style="margin: 20px 0;">
              <tr>
                <td style="background: #d8e1fc; border: 4px solid black; padding: 12px 24px;">
                  <a href="https://mirrio.app" 
                     style="text-decoration: none; color: black; font-weight: bold;">
                    Vote Now →
                  </a>
                </td>
              </tr>
            </table>
            
            <p>Remember: All votes are anonymous and revealed after everyone has voted or after 24 hours.</p>
            
            <hr style="margin: 30px 0; border: 1px solid #eee;">
            
            <p style="color: #666; font-size: 12px;">
              You're receiving this because you're a member of ${group.name} on Mirrio.<br>
              To stop receiving these emails, leave the group in the app.
            </p>
          </body>
          </html>
        `
        
        try {
          await client.send({
            from: SMTP_FROM,
            to: member.profiles.email,
            subject: `🎯 New Mirrio Statement - ${group.name}`,
            content: emailHtml,
            html: emailHtml,
          })
          
          console.log(`Email sent to ${member.profiles.email}`)
        } catch (emailError) {
          console.error(`Failed to send to ${member.profiles.email}:`, emailError)
        }
      }
      
      // Schließe SMTP Verbindung
      await client.close()
      
    } catch (smtpError) {
      console.error('SMTP Error:', smtpError)
      // Fallback ohne Email - Function läuft trotzdem weiter
    }
    
    return new Response(JSON.stringify({ 
      success: true, 
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