// "Google Slides" button for the deck editor.
// Builds the deck as a PPTX, uploads it to the user's Google Drive converted to Google Slides, and
// returns the link. No dependencies: plain https.
//
// One-time setup (the editor shows these steps the first time you click the button):
//   1. console.cloud.google.com: create a project and enable the Google Drive API.
//   2. OAuth consent screen: user type External, add your own Google account as a test user.
//   3. Credentials: create an OAuth client ID of type Desktop app.
//   4. Save {"client_id": "...", "client_secret": "..."} to ~/.config/deck-kit/google-oauth.json
// Then the first click opens Google's sign-in page. The refresh token is saved next to that file
// (mode 0600). The only scope requested is drive.file, so the app can see only files it created.
'use strict';
const https = require('https');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const PPTX_TYPE = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const SLIDES_TYPE = 'application/vnd.google-apps.presentation';
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const DEFAULT_ENDPOINTS = {
  auth: 'https://accounts.google.com/o/oauth2/v2/auth',
  token: 'https://oauth2.googleapis.com/token',
  upload: 'https://www.googleapis.com/upload/drive/v3/files',
};
const SETUP_HELP = [
  'One-time Google setup:',
  '1. Go to console.cloud.google.com, create a project, and enable the Google Drive API.',
  '2. Open the OAuth consent screen, choose External, and add your own Google account as a test user.',
  '3. Under Credentials, create an OAuth client ID of type Desktop app.',
  '4. Save {"client_id": "...", "client_secret": "..."} to ~/.config/deck-kit/google-oauth.json',
  'Then click the button again.',
].join('\n');

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; } };

function request(urlStr, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const lib = u.protocol === 'http:' ? http : https;
    const req = lib.request(u, { method, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}
const form = (o) => new URLSearchParams(o).toString();

exports.SETUP_HELP = SETUP_HELP;
exports.create = function create({ port, configDir, endpoints } = {}) {
  const dir = configDir || process.env.DECK_KIT_CONFIG || path.join(os.homedir(), '.config', 'deck-kit');
  const OAUTH_FILE = path.join(dir, 'google-oauth.json');
  const TOKEN_FILE = path.join(dir, 'google-token.json');
  const ep = Object.assign({}, DEFAULT_ENDPOINTS, endpoints || {});
  const redirectUri = 'http://127.0.0.1:' + port + '/oauth/google/callback';
  let pending = null; // { state, verifier } for the sign-in in progress

  const creds = () => { const c = readJson(OAUTH_FILE); return c && c.client_id && c.client_secret ? c : null; };
  const refreshToken = () => { const t = readJson(TOKEN_FILE); return t && t.refresh_token ? t.refresh_token : null; };

  function authUrl(c) {
    const verifier = b64url(crypto.randomBytes(32));
    pending = { state: b64url(crypto.randomBytes(16)), verifier };
    return ep.auth + '?' + form({
      client_id: c.client_id, redirect_uri: redirectUri, response_type: 'code', scope: SCOPE,
      access_type: 'offline', prompt: 'consent', state: pending.state,
      code_challenge: b64url(crypto.createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256',
    });
  }

  async function accessToken(c) {
    const rt = refreshToken();
    if (!rt) return null;
    const r = await request(ep.token, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form({ client_id: c.client_id, client_secret: c.client_secret, refresh_token: rt, grant_type: 'refresh_token' }) });
    if (r.status !== 200) return null; // revoked or expired: sign in again
    return JSON.parse(r.body.toString()).access_token || null;
  }

  // Resumable upload (handles big decks), converted to Google Slides by the mimeType in the metadata.
  async function upload(token, pptx, name) {
    const meta = Buffer.from(JSON.stringify({ name, mimeType: SLIDES_TYPE }));
    const start = await request(ep.upload + '?uploadType=resumable&fields=id,webViewLink', { method: 'POST', body: meta, headers: {
      Authorization: 'Bearer ' + token, 'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': PPTX_TYPE, 'X-Upload-Content-Length': String(pptx.length), 'Content-Length': String(meta.length) } });
    if (start.status !== 200 || !start.headers.location) throw new Error('Google refused the upload (' + start.status + '): ' + start.body.toString().slice(0, 300));
    const put = await request(start.headers.location, { method: 'PUT', body: pptx, headers: { 'Content-Type': PPTX_TYPE, 'Content-Length': String(pptx.length) } });
    if (put.status !== 200 && put.status !== 201) throw new Error('Upload failed (' + put.status + '): ' + put.body.toString().slice(0, 300));
    const j = JSON.parse(put.body.toString());
    return 'https://docs.google.com/presentation/d/' + j.id + '/edit';
  }

  const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); };

  // handle(req, res, pathname, buildPptx, deckName) -> true when the request was ours
  function handle(req, res, p, buildPptx, deckName) {
    if (req.method === 'GET' && p === '/api/gslides/status') {
      json(res, 200, { configured: !!creds(), authed: !!refreshToken() });
      return true;
    }
    if (req.method === 'POST' && p === '/api/gslides/upload') {
      (async () => {
        const c = creds();
        if (!c) return json(res, 200, { needsSetup: true, help: SETUP_HELP });
        let token = await accessToken(c);
        if (!token) return json(res, 200, { needsAuth: true, authUrl: authUrl(c) });
        const pptx = await buildPptx();
        json(res, 200, { url: await upload(token, pptx, deckName || 'Deck') });
      })().catch((e) => json(res, 500, { error: e.message }));
      return true;
    }
    if (req.method === 'GET' && p === '/oauth/google/callback') {
      const u = new URL(req.url, 'http://127.0.0.1');
      const done = (code, msg) => { res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8' }); res.end('<!doctype html><meta charset="utf-8"><body style="font:18px system-ui;padding:40px">' + msg + '</body>'); };
      const c = creds();
      if (!c || !pending || u.searchParams.get('state') !== pending.state || !u.searchParams.get('code')) { done(400, 'Sign-in could not be verified. Go back to the editor and click Google Slides again.'); return true; }
      const verifier = pending.verifier; pending = null;
      request(ep.token, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form({ client_id: c.client_id, client_secret: c.client_secret, code: u.searchParams.get('code'), code_verifier: verifier, grant_type: 'authorization_code', redirect_uri: redirectUri }) })
        .then((r) => {
          const t = JSON.parse(r.body.toString());
          if (r.status !== 200 || !t.refresh_token) return done(400, 'Google did not return a sign-in token. Go back and try again.');
          fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
          fs.writeFileSync(TOKEN_FILE, JSON.stringify({ refresh_token: t.refresh_token }), { mode: 0o600 });
          done(200, 'Connected to Google. This tab will open your slides in a moment.');
        })
        .catch((e) => done(500, 'Sign-in failed: ' + e.message));
      return true;
    }
    return false;
  }
  return { handle, authUrl: () => { const c = creds(); return c ? authUrl(c) : null; } };
};
