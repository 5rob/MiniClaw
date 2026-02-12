// auth-server.js — Run this ONCE to get your Google refresh token
import 'dotenv/config';
import http from 'http';
import { google } from 'googleapis';
import fs from 'fs';

// Validate environment variables
if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
  console.error('\n❌ ERROR: Missing Google OAuth2 credentials in .env file');
  console.error('Please add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to your .env file\n');
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/oauth2callback'
);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  scope: ['https://www.googleapis.com/auth/calendar'],
  prompt: 'consent'
});

console.log('\n=== Google Calendar Authorization ===\n');
console.log('Open this URL in your browser:\n');
console.log(authUrl);
console.log('\nWaiting for callback...\n');

const server = http.createServer(async (req, res) => {
  if (req.url?.startsWith('/oauth2callback')) {
    try {
      const url = new URL(req.url, 'http://localhost:3000');
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');

      if (error) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end(`<h1>Authorization Failed</h1><p>Error: ${error}</p>`);
        console.error(`Authorization failed: ${error}`);
        server.close();
        process.exit(1);
        return;
      }

      if (code) {
        const { tokens } = await oauth2Client.getToken(code);
        fs.writeFileSync('google-tokens.json', JSON.stringify(tokens, null, 2));

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <h1>✅ Success!</h1>
          <p>Authorization complete. You can close this tab.</p>
          <p>Tokens saved to <code>google-tokens.json</code></p>
          <p>You can now run <code>npm start</code> to launch MiniClaw.</p>
        `);

        console.log('\n✅ Success! Tokens saved to google-tokens.json');
        console.log('You can now start MiniClaw with: npm start');
        console.log('This script is no longer needed.\n');

        server.close();
        process.exit(0);
      } else {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end('<h1>Error</h1><p>No authorization code received</p>');
        server.close();
        process.exit(1);
      }
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/html' });
      res.end(`<h1>Error</h1><p>${err.message}</p>`);
      console.error('Error exchanging code:', err);
      server.close();
      process.exit(1);
    }
  }
});

server.listen(3000, () => {
  console.log('Auth server listening on http://localhost:3000');
  console.log('Press Ctrl+C to cancel\n');
});

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\nAuthorization cancelled by user');
  server.close();
  process.exit(0);
});
