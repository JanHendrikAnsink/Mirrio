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
    
    console.log('New round created:', record.id);
    
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    
    // Hole alle Daten für die Email
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
    
    console.log(`Sending emails to ${members?.length} members in group "${group.name}"`);
    console.log(`Statement: "${statement.text}"`);
    
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
          
          <h2 style="color: #000; font-size: 24px; margin-bottom: 20px;">Hi ${memberName}! 👋</h2>
          
          <p style="color: #333; font-size: 16px; line-height: 1.5;">
            A new statement just dropped in <strong>${group.name}</strong>:
          </p>
          
          <div style="background: #fed89e; border: 4px solid black; padding: 20px; margin: 30px 0; text-align: center;">
            <h3 style="margin: 0; color: #000; font-size: 20px; font-weight: bold;">
              "${statement.text}"
            </h3>
          </div>
          
          <p style="color: #333; font-size: 16px; line-height: 1.5;">
            <strong>⏰ You have 24 hours to vote!</strong>
          </p>
          
          <p style="color: #333; font-size: 16px; line-height: 1.5;">
            Think about who in your group this statement fits best, then cast your anonymous vote.
          </p>
          
          <div style="text-align: center; margin: 40px 0;">
            <a href="https://mirrio.app" 
               style="display: inline-block; background: #d8e1fc; border: 4px solid black; padding: 15px 30px; text-decoration: none; color: black; font-weight: bold; font-size: 16px;">
              Vote Now →
            </a>
          </div>
          
          <p style="color: #666; font-size: 14px; line-height: 1.5;">
            Remember: All votes are anonymous and will be revealed after everyone has voted or after 24 hours.
          </p>
          
          <hr style="margin: 40px 0; border: none; border-top: 1px solid #eee;">
          
          <p style="color: #999; font-size: 12px; text-align: center;">
            You're receiving this because you're a member of ${group.name} on Mirrio.<br>
            To stop receiving these emails, leave the group in the app.
          </p>
        </body>
        </html>
      `;
      
      // Plain text version
      const emailText = `
Hi ${memberName}!

A new statement just dropped in ${group.name}:

"${statement.text}"

You have 24 hours to vote!

Think about who in your group this statement fits best, then cast your anonymous vote.

Vote now at: https://mirrio.app

Remember: All votes are anonymous and will be revealed after everyone has voted or after 24 hours.

---
You're receiving this because you're a member of ${group.name} on Mirrio.
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
            subject: `🎯 New Mirrio Statement - ${group.name}`,
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
          console.log(`✅ Email sent to ${memberEmail}`);
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
      message: 'Round emails processed',
      stats: {
        group: group.name,
        statement: statement.text,
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