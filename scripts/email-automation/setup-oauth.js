'use strict';

/**
 * One-time script to obtain and save a Gmail OAuth2 refresh token.
 * Run this once from the adamrit/ project root:
 *   node scripts/email-automation/setup-oauth.js
 */

const { google } = require('googleapis');
const readline = require('readline');
const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const SCOPES = ['https://mail.google.com/'];
const ENV_FILE = path.resolve(__dirname, '../../.env');

function getOAuth2Client() {
  if (!process.env.GMAIL_CLIENT_ID || !process.env.GMAIL_CLIENT_SECRET) {
    console.error('❌ GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET must be set in adamrit/.env first.');
    console.error('   See scripts/email-automation/.env.example for reference.');
    process.exit(1);
  }
  return new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
    'urn:ietf:wg:oauth:2.0:oob'
  );
}

function updateEnvFile(refreshToken) {
  let content = '';
  try {
    content = fs.readFileSync(ENV_FILE, 'utf-8');
  } catch {
    console.warn('⚠️  Could not read .env file — printing token instead (paste it manually).');
    console.log(`\nGMAIL_REFRESH_TOKEN=${refreshToken}\n`);
    return false;
  }

  if (content.includes('GMAIL_REFRESH_TOKEN=')) {
    content = content.replace(/GMAIL_REFRESH_TOKEN=.*/,  `GMAIL_REFRESH_TOKEN=${refreshToken}`);
  } else {
    content += `\nGMAIL_REFRESH_TOKEN=${refreshToken}\n`;
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
  console.log('\n1. Open this URL in your browser:\n');
  console.log(`   ${authUrl}\n`);
  console.log('2. Log in as: info@hopehospital.com');
  console.log('3. Grant access when prompted');
  console.log('4. Copy the authorization code shown on screen\n');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  rl.question('Paste the authorization code here: ', async (code) => {
    rl.close();

    try {
      const { tokens } = await oauth2Client.getToken(code.trim());

      if (!tokens.refresh_token) {
        console.error('\n❌ No refresh token returned.');
        console.error('   This usually means the account already authorized this app.');
        console.error('   Go to https://myaccount.google.com/permissions, revoke access, then re-run.');
        process.exit(1);
      }

      const saved = updateEnvFile(tokens.refresh_token);

      console.log('\n✅ Success!');
      if (saved) {
        console.log('   GMAIL_REFRESH_TOKEN has been saved to adamrit/.env');
      }
      console.log('\nYou can now run:');
      console.log('   node scripts/email-automation/run.js\n');
    } catch (err) {
      console.error('\n❌ Failed to exchange code for token:', err.message);
      process.exit(1);
    }
  });
}

main();
