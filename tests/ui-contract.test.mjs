import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const source = `${html}\n${app}`;

test('start screen uses database-connected copy and welcome animal UI', () => {
  assert.match(source, /資料庫已連接/);
  assert.doesNotMatch(html, /不用輸入房號/);
  assert.match(html, /id="welcome-animal"/);
  assert.match(html, /id="welcome-phrase"/);
  assert.match(source, /pickWelcomeContent/);
});

test('waiting screen exposes host cancel button wired to cancel_room RPC', () => {
  assert.match(html, /id="cancel-room-btn"/);
  assert.match(source, /rpc\('cancel_room'/);
  assert.match(source, /p_room_id\s*:\s*currentRoomId/);
  assert.match(source, /p_client_token\s*:\s*getClientToken\(\)/);
  assert.match(source, /currentSeat\s*!==\s*1/);
  assert.match(source, /await enterLobby\(\)/);
});

test('battle mode is viewport-bound in landscape', () => {
  assert.match(html, /body\.battle-mode\s*\{[^}]*height\s*:\s*100dvh[^}]*overflow\s*:\s*hidden/s);
  assert.match(html, /#battle-screen\.active\s*\{[^}]*height\s*:\s*100dvh/s);
  assert.match(html, /\.tech-arena\s*\{[^}]*height\s*:\s*100dvh/s);
  assert.match(html, /orientation:\s*portrait/);
  assert.match(html, /rotate-hint/);
});

test('battle HUD preserves approved same-row order', () => {
  const start = html.indexOf('<div class="battle-status-row"');
  const end = html.indexOf('<div class="character-stage">', start);
  const row = html.slice(start, end);
  const ids = ['self-name', 'self-hp', 'battle-title', 'opponent-hp', 'opponent-name'];
  let last = -1;
  for (const id of ids) {
    const index = row.indexOf(`id="${id}"`);
    assert.ok(index > last, `${id} should follow the approved HUD order`);
    last = index;
  }
});

test('result presentation includes petal layer and distinct victory/defeat copy pools', () => {
  assert.match(html, /id="petal-layer"/);
  assert.match(source, /VICTORY_MESSAGES/);
  assert.match(source, /DEFEAT_MESSAGES/);
  assert.match(source, /launchPetalRain/);
  assert.match(source, /clearPetalRain/);
  assert.match(html, /prefers-reduced-motion/);
  assert.match(html, /battle-result[^}]*position\s*:\s*absolute/s);
});

test('correct-hit animation includes directional oversized sword layers', () => {
  assert.match(html, /id="sword-left"/);
  assert.match(html, /id="sword-right"/);
  assert.match(html, /\.sword-slash/);
  assert.match(html, /sword-left-slash/);
  assert.match(html, /sword-right-slash/);
  assert.match(source, /const sword=eventFromSelf\?swordLeft:swordRight/);
  assert.match(source, /if\(isHit\)\{[\s\S]*sword\.classList\.add\('slash'\)/);
});

test('portrait rotate prompt is fixed to the viewport', () => {
  assert.match(html, /\.rotate-hint\s*\{[^}]*position\s*:\s*fixed[^}]*inset\s*:\s*0/s);
});

test('index loads the application module from app.js', () => {
  assert.match(html, /<script type="module" src="\.\/app\.js"><\/script>/);
});

test('lobby uses live-room RPC and schedules TTL refresh', () => {
  assert.match(app, /rpc\('list_live_rooms'\)/);
  assert.match(app, /expires_in_ms/);
  assert.match(app, /scheduleLobbyExpiryRefresh/);
  assert.doesNotMatch(app, /from\('rooms'\)\.select\('id,host_nickname,status,player_count,created_at'\)\.eq\('status','waiting'\)/);
});

test('host waiting screen sends heartbeat every three seconds', () => {
  assert.match(app, /HOST_HEARTBEAT_INTERVAL_MS\s*=\s*3000/);
  assert.match(app, /rpc\('heartbeat_room'/);
  assert.match(app, /startHostHeartbeat/);
  assert.match(app, /stopHostHeartbeat/);
  assert.match(app, /setInterval\([\s\S]*HOST_HEARTBEAT_INTERVAL_MS/);
});

test('join waits for a two-second host acknowledgement before join_room', () => {
  assert.match(app, /JOIN_PROBE_TIMEOUT_MS\s*=\s*2000/);
  assert.match(app, /confirmHostOnline/);
  assert.match(app, /event:'join_probe'/);
  assert.match(app, /event:'host_ack'/);
  const joinStart=app.indexOf('async function joinRoom');
  const joinEnd=app.indexOf('async function cancelCurrentRoom',joinStart);
  const joinBody=app.slice(joinStart,joinEnd);
  assert.ok(joinBody.indexOf('confirmHostOnline') < joinBody.indexOf("rpc('join_room'"));
});

test('persistent game Presence uses one shared topic per room', () => {
  assert.match(app, /channel\(`game-\$\{roomId\}`/);
  assert.doesNotMatch(app, /game-\$\{roomId\}-\$\{getClientToken\(\)\}/);
  assert.match(app, /presence:\{key:getClientToken\(\)\}/);
});

test('waiting host pagehide sends best-effort keepalive cancel request', () => {
  assert.match(app, /addEventListener\('pagehide'/);
  assert.match(app, /rest\/v1\/rpc\/cancel_room/);
  assert.match(app, /keepalive:true/);
  assert.match(app, /apikey:SUPABASE_PUBLISHABLE_KEY/);
  assert.doesNotMatch(app, /Authorization:\s*`Bearer \$\{SUPABASE_PUBLISHABLE_KEY\}`/);
  assert.match(app, /currentSeat!==1\|\|currentScreen!=='waiting'\|\|!currentRoomId/);
});

test('sword glyph is inverted inside its motion container so the blade leads the target', () => {
  assert.match(html, /\.sword-glyph\s*\{[^}]*transform\s*:\s*rotate\(180deg\)/s);
  assert.match(html, /id="sword-left"[^>]*><span class="sword-glyph">🗡️<\/span><\/div>/);
  assert.match(html, /id="sword-right"[^>]*><span class="sword-glyph">🗡️<\/span><\/div>/);
});
