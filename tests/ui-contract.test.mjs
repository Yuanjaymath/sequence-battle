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
