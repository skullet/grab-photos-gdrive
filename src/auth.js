import { google } from 'googleapis';
import { createServer } from 'http';
import { URL } from 'url';
import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, '..');

const CREDENTIALS_PATH = join(ROOT_DIR, 'credentials.json');
const TOKEN_PATH = join(ROOT_DIR, 'token.json');
const SCOPES = ['https://www.googleapis.com/auth/drive.readonly'];
const REDIRECT_PORT = 3000;

/**
 * Load OAuth credentials from credentials.json
 */
async function loadCredentials() {
  if (!existsSync(CREDENTIALS_PATH)) {
    throw new Error(
      'credentials.json not found.\n\n' +
      'To set up Google Drive API access:\n' +
      '1. Go to https://console.cloud.google.com\n' +
      '2. Create a new project (or select existing)\n' +
      '3. Enable the Google Drive API\n' +
      '4. Go to Credentials > Create Credentials > OAuth client ID\n' +
      '5. Select "Desktop app" as application type\n' +
      '6. Download the credentials and save as credentials.json in the project root'
    );
  }

  const content = await readFile(CREDENTIALS_PATH, 'utf-8');
  const credentials = JSON.parse(content);

  // Handle both web and installed app credential formats
  const { client_secret, client_id, redirect_uris } =
    credentials.installed || credentials.web;

  return { client_id, client_secret, redirect_uris };
}

/**
 * Load saved token from disk
 */
async function loadSavedToken() {
  if (!existsSync(TOKEN_PATH)) {
    return null;
  }

  const content = await readFile(TOKEN_PATH, 'utf-8');
  return JSON.parse(content);
}

/**
 * Save token to disk
 */
async function saveToken(token) {
  await writeFile(TOKEN_PATH, JSON.stringify(token, null, 2));
  console.log('Token saved to', TOKEN_PATH);
}

/**
 * Run OAuth flow with local server callback
 */
function getAuthCodeFromBrowser(authUrl) {
  return new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => {
      try {
        const url = new URL(req.url, `http://localhost:${REDIRECT_PORT}`);

        if (url.pathname === '/oauth2callback') {
          const code = url.searchParams.get('code');
          const error = url.searchParams.get('error');

          if (error) {
            res.writeHead(400, { 'Content-Type': 'text/html' });
            res.end(`<h1>Authentication failed</h1><p>${error}</p>`);
            reject(new Error(`OAuth error: ${error}`));
          } else if (code) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end('<h1>Authentication successful!</h1><p>You can close this window.</p>');
            resolve(code);
          }

          server.close();
        }
      } catch (err) {
        reject(err);
      }
    });

    server.listen(REDIRECT_PORT, () => {
      console.log(`\nOpening browser for authentication...`);
      console.log(`If the browser doesn't open, visit:\n${authUrl}\n`);

      // Open browser (cross-platform)
      const open = process.platform === 'darwin' ? 'open' :
                   process.platform === 'win32' ? 'start' : 'xdg-open';
      import('child_process').then(({ exec }) => {
        exec(`${open} "${authUrl}"`);
      });
    });

    // Timeout after 2 minutes
    setTimeout(() => {
      server.close();
      reject(new Error('Authentication timeout'));
    }, 120000);
  });
}

/**
 * Get authenticated Google Drive client
 */
export async function authorize() {
  const { client_id, client_secret } = await loadCredentials();

  const oauth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    `http://localhost:${REDIRECT_PORT}/oauth2callback`
  );

  // Check for existing token
  const savedToken = await loadSavedToken();

  if (savedToken) {
    oauth2Client.setCredentials(savedToken);

    // Check if token is expired
    if (savedToken.expiry_date && savedToken.expiry_date < Date.now()) {
      console.log('Token expired, refreshing...');
      try {
        const { credentials } = await oauth2Client.refreshAccessToken();
        await saveToken(credentials);
        oauth2Client.setCredentials(credentials);
      } catch (err) {
        console.log('Failed to refresh token, re-authenticating...');
        return await performOAuthFlow(oauth2Client);
      }
    }

    console.log('Using saved credentials');
    return oauth2Client;
  }

  return await performOAuthFlow(oauth2Client);
}

/**
 * Perform OAuth flow
 */
async function performOAuthFlow(oauth2Client) {
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent'
  });

  const code = await getAuthCodeFromBrowser(authUrl);
  const { tokens } = await oauth2Client.getToken(code);

  oauth2Client.setCredentials(tokens);
  await saveToken(tokens);

  return oauth2Client;
}
