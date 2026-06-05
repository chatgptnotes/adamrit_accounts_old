'use strict';

const { google } = require('googleapis');
const http = require('http');
const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const SCOPES = ['https://mail.google.com/'];
const PORT = 3000;
const REDIRECT_URI = `http://localhost:${PORT}`;
const ENV_FILE = path.resolve(__dirname, '../../.env');

function getOAuth2Client() {
  if (!process.env.GMAIL_CLIENT_ID || !process.env.GMAIL_CLIENT_SECRET) {
    console.error('❌ GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET must be set in adamrit/.env first.');
    process.exit(1);
  }
  return new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
    REDIRECT_URI
  );
}

function updateEnvFile(refreshToken) {
  let content = '';
  try {
    content = fs.readFileSync(ENV_FILE, 'utf-8');
  } catch {
    console.log(`\nGMAIL_REFRESH_TOKEN=${refreshToken}\n`);
    return false;
  }

  if (content.includes('GMAIL_REFRESH_TOKEN=')) {
    content = content.replace(/^GMAIL_REFRESH_TOKEN=.*/m, `GMAIL_REFRESH_TOKEN=${refreshToken}`);
  } else {
    content += `\nGMAIL_REFRESH_TOKEN=${refreshToken}\n`;
  }
  if (content.includes('VITE_GMAIL_REFRESH_TOKEN=')) {
    content = content.replace(/^VITE_GMAIL_REFRESH_TOKEN=.*/m, `VITE_GMAIL_REFRESH_TOKEN=${refreshToken}`);
  } else {
    content += `VITE_GMAIL_REFRESH_TOKEN=${refreshToken}\n`;
  }

  fs.writeFileSync(ENV_FILE, content, 'utf-8');
  return true;
}

async function main() {
  const oauth2Client = getOAuth2Client();

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent'
  });

  console.log('\n══════════════════════════════════════════════════════');
  console.log('  HOPE HOSPITAL — Gmail OAuth2 Setup');
  console.log('══════════════════════════════════════════════════════');
  console.log(`\n   Log in as: ${process.env.GMAIL_USER_EMAIL}`);
  console.log('   Click Allow when prompted.');
  console.log('\n⏳ Opening browser and waiting for Google to redirect back...\n');

  // Auto-open the browser (Windows)
  const { exec } = require('child_process');
  exec(`start "" "${authUrl}"`);

  await new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url, `http://localhost:${PORT}`);
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');

      if (error) {
        res.end('<h2>❌ Access denied. You can close this tab.</h2>');
        server.close();
        reject(new Error(`Access denied: ${error}`));
        return;
      }

      if (!code) {
        res.end('<h2>Waiting...</h2>');
        return;
      }

      res.end('<h2>✅ Authorised! You can close this tab and return to the terminal.</h2>');
      server.close();

      try {
        const { tokens } = await oauth2Client.getToken(code);

        if (!tokens.refresh_token) {
          console.error('\n❌ No refresh token returned.');
          console.error('   Go to https://myaccount.google.com/permissions, revoke "Email Bot", then re-run.');
          process.exit(1);
        }

        const saved = updateEnvFile(tokens.refresh_token);
        console.log('\n✅ Success! Gmail is connected.');
        if (saved) console.log('   GMAIL_REFRESH_TOKEN saved to adamrit/.env');
        console.log('\nYou can now run:');
        console.log('   node scripts/email-automation/run.js\n');
        resolve();
      } catch (err) {
        reject(err);
      }
    });

    server.listen(PORT, () => {});
    server.on('error', reject);
  });
}

main().catch((err) => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
