# Sequence Battle V4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved V4 upgrade for the arithmetic-sequence battle game: safer room cancellation, friendlier start screen, one-screen landscape play, richer win/lose presentation, Unicode subscripts, and laser-plus-sword attack effects.

**Architecture:** Keep the existing GitHub Pages + Supabase Realtime architecture. Add one new `cancel_room` RPC for room lifecycle safety, keep all other changes client-side, and preserve the existing `resolve_answer` RPC contract. Pure logic remains in `game-logic.js`; DOM/CSS/realtime orchestration remains in `index.html` to match the current codebase pattern.

**Tech Stack:** HTML5, CSS, JavaScript ES modules, Supabase JS v2, PostgreSQL PL/pgSQL, Node.js built-in test runner (`node:test`) for pure logic/contract tests.

**Spec:** `docs/superpowers/specs/2026-08-31-sequence-battle-v4-design.md`

## Global Constraints

- Successful database status copy must read exactly `資料庫已連接`.
- Remove the start-screen text `不用輸入房號`; replace it with one random cute animal plus one random welcome phrase.
- Cancel-room behavior must preserve the current nickname and return to the lobby, not the initial nickname screen.
- `cancel_room` is allowed only for seat 1 and only while the room is still `waiting`.
- Cancellation is soft: mark `rooms.status` and `game_state.status` as `finished`; do not hard-delete history.
- On computers, tablets, and phones in landscape orientation, the complete battle UI must fit in one viewport without horizontal or vertical scrolling.
- Phones in portrait orientation must show a rotate-to-landscape prompt instead of squeezing in the full battle UI.
- Victory presentation remains visible until the player presses `回到遊戲大廳`.
- Victory gets celebratory copy and petal rain; defeat gets encouraging copy and no petal rain.
- Mathematical term indexes must use Unicode subscripts from `₀₁₂₃₄₅₆₇₈₉`, e.g. `a₂`, `a₁₀`.
- Correct-answer attack sequence: lunge/scale -> laser -> oversized sword slash -> target hit reaction.
- Wrong-answer self-damage must not show laser or sword attack.
- Do not change the existing `resolve_answer(p_room_id, p_client_token, p_is_correct)` contract.
- Do not add student accounts, rankings, or persistent score systems.

---

## File Map

- `game-logic.js` — pure question generation, Unicode subscript formatting, welcome-content selection, existing battle view helpers.
- `index.html` — UI markup/styles, random start welcome rendering, room-cancel button flow, landscape viewport fitting, victory/defeat overlay, petal rain, sword animation, Supabase calls and realtime behavior.
- `supabase-phase3.sql` — new `public.cancel_room(uuid, uuid)` RPC only.
- `tests/game-logic.test.mjs` — pure logic regression tests using Node's built-in test runner.
- `tests/ui-contract.test.mjs` — static DOM/CSS/JS contract checks for required copy, IDs, callbacks, and responsive rules.
- `tests/sql-contract.test.mjs` — static contract checks for the phase-3 SQL safety rules.

---

### Task 1: Add Unicode subscript and welcome-content pure logic

**Files:**
- Modify: `game-logic.js`
- Create: `tests/game-logic.test.mjs`

**Interfaces:**
- Produces: `toSubscript(value: number|string): string`
- Produces: `formatTerm(index: number|string): string`
- Produces: `WELCOME_PHRASES: string[]`
- Produces: `pickWelcomeContent(rng = Math.random): { animal: BattleAnimal, phrase: string }`
- Preserves: `generateQuestion()`, `generateChoices()`, `pickBattleAnimals()`, `makeBattleViewModel()`, `presenceHasOpponent()`

- [ ] **Step 1: Write failing tests for subscript conversion**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  toSubscript,
  formatTerm,
  generateNthTermQuestion,
  generateDifferenceQuestion,
  generateMissingTermQuestion,
} from '../game-logic.js';

test('toSubscript converts multi-digit indexes', () => {
  assert.equal(toSubscript(0), '₀');
  assert.equal(toSubscript(2), '₂');
  assert.equal(toSubscript(10), '₁₀');
  assert.equal(toSubscript(18), '₁₈');
});

test('formatTerm produces a with Unicode subscript', () => {
  assert.equal(formatTerm(2), 'a₂');
  assert.equal(formatTerm(10), 'a₁₀');
});

test('generated prompts never use ASCII a followed by a digit', () => {
  const generators = [
    generateNthTermQuestion,
    generateDifferenceQuestion,
    generateMissingTermQuestion,
  ];
  for (const generate of generators) {
    for (let i = 0; i < 100; i += 1) {
      assert.doesNotMatch(generate().prompt, /a\d/);
    }
  }
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run:

```bash
node --test tests/game-logic.test.mjs
```

Expected: FAIL because `toSubscript`, `formatTerm`, and/or Unicode prompt formatting do not yet exist.

- [ ] **Step 3: Implement the minimal subscript helpers and update prompts**

Add to `game-logic.js`:

```js
const SUBSCRIPT_DIGITS = Object.freeze({
  '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄',
  '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉',
});

export function toSubscript(value) {
  return String(value)
    .split('')
    .map((digit) => SUBSCRIPT_DIGITS[digit] ?? digit)
    .join('');
}

export function formatTerm(index) {
  return `a${toSubscript(index)}`;
}
```

Replace every generated mathematical term such as `a${n}` with `formatTerm(n)`. Keep prose like `第 ${n} 項` as normal digits.

- [ ] **Step 4: Add failing tests for deterministic welcome-content selection**

Append:

```js
import {
  BATTLE_ANIMALS,
  WELCOME_PHRASES,
  pickWelcomeContent,
} from '../game-logic.js';

test('pickWelcomeContent returns a known animal and phrase', () => {
  const result = pickWelcomeContent(() => 0);
  assert.deepEqual(result.animal, BATTLE_ANIMALS[0]);
  assert.equal(result.phrase, WELCOME_PHRASES[0]);
});

test('welcome phrase pool contains several distinct messages', () => {
  assert.ok(WELCOME_PHRASES.length >= 6);
  assert.equal(new Set(WELCOME_PHRASES).size, WELCOME_PHRASES.length);
});
```

- [ ] **Step 5: Run the tests and verify RED**

```bash
node --test tests/game-logic.test.mjs
```

Expected: FAIL because `WELCOME_PHRASES` and `pickWelcomeContent` are missing.

- [ ] **Step 6: Implement the welcome-content API**

```js
export const WELCOME_PHRASES = Object.freeze([
  '準備開戰了嗎？',
  '今天也來挑戰一下吧！',
  '數列高手登場！',
  '進大廳找個對手吧！',
  '今天誰才是等差數列王者？',
  '選好名字，準備出招！',
]);

export function pickWelcomeContent(rng = Math.random) {
  const animalIndex = Math.floor(rng() * BATTLE_ANIMALS.length);
  const phraseIndex = Math.floor(rng() * WELCOME_PHRASES.length);
  return {
    animal: BATTLE_ANIMALS[Math.min(animalIndex, BATTLE_ANIMALS.length - 1)],
    phrase: WELCOME_PHRASES[Math.min(phraseIndex, WELCOME_PHRASES.length - 1)],
  };
}
```

- [ ] **Step 7: Run all pure-logic tests and verify GREEN**

```bash
node --test tests/game-logic.test.mjs
```

Expected: PASS, zero failures.

- [ ] **Step 8: Commit Task 1**

```bash
git add game-logic.js tests/game-logic.test.mjs
git commit -m "feat: add Unicode term formatting and welcome content"
```

---

### Task 2: Add secure soft-cancel room RPC

**Files:**
- Create: `supabase-phase3.sql`
- Create: `tests/sql-contract.test.mjs`

**Interfaces:**
- Produces: `public.cancel_room(p_room_id uuid, p_client_token uuid) returns jsonb`
- Client success response: `{ success: true, room_id: <uuid> }`
- Error tokens: `INVALID_REQUEST`, `PLAYER_NOT_IN_ROOM`, `NOT_ROOM_HOST`, `ROOM_NOT_FOUND`, `ROOM_ALREADY_STARTED`

- [ ] **Step 1: Write a failing SQL contract test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const sql = await readFile(new URL('../supabase-phase3.sql', import.meta.url), 'utf8');

test('cancel_room is security definer and locks waiting room state', () => {
  assert.match(sql, /create or replace function public\.cancel_room/i);
  assert.match(sql, /security definer/i);
  assert.match(sql, /set search_path = ''/i);
  assert.match(sql, /for update/i);
  assert.match(sql, /ROOM_ALREADY_STARTED/);
  assert.match(sql, /status\s*=\s*'finished'/i);
  assert.match(sql, /grant execute on function public\.cancel_room\(uuid, uuid\)/i);
});
```

- [ ] **Step 2: Run and verify RED**

```bash
node --test tests/sql-contract.test.mjs
```

Expected: FAIL with missing `supabase-phase3.sql`.

- [ ] **Step 3: Implement `supabase-phase3.sql`**

Use this structure:

```sql
create or replace function public.cancel_room(
  p_room_id uuid,
  p_client_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seat smallint;
  v_room_status text;
begin
  if p_room_id is null or p_client_token is null then
    raise exception 'INVALID_REQUEST';
  end if;

  select seat into v_seat
  from public.players
  where room_id = p_room_id
    and client_token = p_client_token
  limit 1;

  if not found then raise exception 'PLAYER_NOT_IN_ROOM'; end if;
  if v_seat <> 1 then raise exception 'NOT_ROOM_HOST'; end if;

  select status into v_room_status
  from public.rooms
  where id = p_room_id
  for update;

  if not found then raise exception 'ROOM_NOT_FOUND'; end if;
  if v_room_status <> 'waiting' then raise exception 'ROOM_ALREADY_STARTED'; end if;

  perform 1
  from public.game_state
  where room_id = p_room_id
  for update;

  update public.rooms
  set status = 'finished', updated_at = now(), last_activity_at = now()
  where id = p_room_id;

  update public.game_state
  set status = 'finished', finished_at = now(), updated_at = now()
  where room_id = p_room_id;

  return jsonb_build_object('success', true, 'room_id', p_room_id);
end;
$$;

revoke execute on function public.cancel_room(uuid, uuid)
from public, anon, authenticated;

grant execute on function public.cancel_room(uuid, uuid)
to anon, authenticated;
```

- [ ] **Step 4: Run SQL contract test and verify GREEN**

```bash
node --test tests/sql-contract.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add supabase-phase3.sql tests/sql-contract.test.mjs
git commit -m "feat: add secure waiting-room cancellation RPC"
```

---

### Task 3: Wire cancel-room UI and random start welcome

**Files:**
- Modify: `index.html`
- Create: `tests/ui-contract.test.mjs`

**Interfaces:**
- Consumes: `pickWelcomeContent()` from Task 1
- Consumes: Supabase RPC `cancel_room(p_room_id, p_client_token)` from Task 2
- Produces DOM IDs: `welcome-animal`, `welcome-phrase`, `cancel-room-btn`
- Produces function: `renderStartWelcome()`
- Produces async function: `cancelCurrentRoom()`

- [ ] **Step 1: Write failing UI contract tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');

test('start screen uses database-connected copy and welcome animal UI', () => {
  assert.match(html, /資料庫已連接/);
  assert.doesNotMatch(html, /不用輸入房號/);
  assert.match(html, /id="welcome-animal"/);
  assert.match(html, /id="welcome-phrase"/);
});

test('waiting screen exposes cancel button wired to cancel_room RPC', () => {
  assert.match(html, /id="cancel-room-btn"/);
  assert.match(html, /rpc\('cancel_room'/);
  assert.match(html, /p_room_id\s*:\s*currentRoomId/);
  assert.match(html, /p_client_token\s*:\s*getClientToken\(\)/);
});
```

- [ ] **Step 2: Run and verify RED**

```bash
node --test tests/ui-contract.test.mjs
```

Expected: FAIL because the new IDs/copy/RPC call are missing.

- [ ] **Step 3: Update imports and start-screen markup**

Change module import to include `pickWelcomeContent`. Replace the old eyebrow with:

```html
<div class="welcome-buddy" aria-live="polite">
  <span class="welcome-animal" id="welcome-animal" aria-hidden="true">🐱</span>
  <span class="welcome-phrase" id="welcome-phrase">準備開戰了嗎？</span>
</div>
```

Keep the existing `輸名字進遊戲大廳` title.

- [ ] **Step 4: Implement `renderStartWelcome()` and successful DB copy**

```js
function renderStartWelcome() {
  const { animal, phrase } = pickWelcomeContent();
  welcomeAnimal.textContent = animal.emoji;
  welcomePhrase.textContent = phrase;
}
```

Call it once during initialization and again whenever `returnToInitial()` reaches the nickname screen. Replace the successful connection text with exactly:

```js
setConnectionStatus('資料庫已連接', 'good');
```

- [ ] **Step 5: Add cancel button to waiting screen**

Inside the waiting stage actions:

```html
<button class="secondary-btn danger-outline" id="cancel-room-btn" type="button">
  取消房間
</button>
```

Only seat 1 should be able to see/use it. Seat 2 waiting during a join transition should not receive a host-cancel control.

- [ ] **Step 6: Implement `cancelCurrentRoom()`**

```js
async function cancelCurrentRoom() {
  if (!supabaseClient || !currentRoomId || currentSeat !== 1) return;
  cancelRoomBtn.disabled = true;
  showMessage('正在取消房間…');
  try {
    const { data, error } = await supabaseClient.rpc('cancel_room', {
      p_room_id: currentRoomId,
      p_client_token: getClientToken(),
    });
    if (error) throw error;
    const result = normalizeRpcData(data);
    if (!result?.success) throw new Error('取消房間失敗');
    await enterLobby();
    showMessage('房間已取消。', 'good');
  } catch (error) {
    if (String(error?.message || error).includes('ROOM_ALREADY_STARTED')) {
      showMessage('對手已加入，對戰即將開始。', 'good');
      await fetchGameState(currentRoomId);
    } else {
      showMessage(friendlyError(error, '取消房間失敗。'), 'bad');
    }
  } finally {
    cancelRoomBtn.disabled = false;
  }
}
```

Bind `cancelRoomBtn.addEventListener('click', cancelCurrentRoom)`.

- [ ] **Step 7: Run UI contract tests and verify GREEN**

```bash
node --test tests/ui-contract.test.mjs
```

Expected: PASS.

- [ ] **Step 8: Run all tests**

```bash
node --test tests/*.test.mjs
```

Expected: all PASS.

- [ ] **Step 9: Commit Task 3**

```bash
git add index.html tests/ui-contract.test.mjs
git commit -m "feat: add start welcome and cancel-room controls"
```

---

### Task 4: Enforce one-screen landscape battle layout

**Files:**
- Modify: `index.html`
- Modify: `tests/ui-contract.test.mjs`

**Interfaces:**
- Preserves DOM order: self name | self HP | VS | opponent HP | opponent name
- Preserves existing `rotate-hint`
- Produces CSS using `100dvh` and `overflow:hidden` in battle mode

- [ ] **Step 1: Add failing responsive contract tests**

Append:

```js
test('battle mode is viewport-bound in landscape', () => {
  assert.match(html, /body\.battle-mode[^}]*overflow\s*:\s*hidden/s);
  assert.match(html, /100dvh/);
  assert.match(html, /orientation:\s*portrait/);
  assert.match(html, /rotate-hint/);
});

test('battle HUD preserves approved same-row order', () => {
  const row = html.match(/<div class="battle-status-row"[\s\S]*?<\/div><div class="character-stage">/)?.[0] || '';
  const ids = ['self-name', 'self-hp', 'battle-title', 'opponent-hp', 'opponent-name'];
  let last = -1;
  for (const id of ids) {
    const index = row.indexOf(`id="${id}"`);
    assert.ok(index > last, `${id} should follow the approved HUD order`);
    last = index;
  }
});
```

- [ ] **Step 2: Run and verify RED**

```bash
node --test tests/ui-contract.test.mjs
```

Expected: at least one responsive contract fails against the current layout rules.

- [ ] **Step 3: Refactor battle sizing around viewport height**

Set battle mode to fixed viewport behavior:

```css
body.battle-mode {
  height: 100dvh;
  overflow: hidden;
}
body.battle-mode .app-shell {
  width: 100%;
  height: 100dvh;
  padding: 0;
}
body.battle-mode .brand,
body.battle-mode .message-bar {
  display: none;
}
#battle-screen.active {
  height: 100dvh;
  border-radius: 0;
}
.tech-arena {
  height: 100dvh;
  min-height: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
}
```

- [ ] **Step 4: Add landscape height compression tiers**

Use height-aware media queries, for example:

```css
@media (orientation: landscape) and (max-height: 700px) {
  .tech-arena { padding: 10px 12px; }
  .battle-status-row { margin-bottom: 6px; }
  .character-stage { min-height: 0; }
  .animal-avatar { width: clamp(76px, 15vh, 120px); height: clamp(76px, 15vh, 120px); font-size: clamp(46px, 10vh, 76px); }
  .question-panel { padding: 8px 12px 10px; }
  .battle-question { margin: 5px 0 8px; font-size: clamp(.86rem, 3vh, 1.25rem); }
  .choice-btn { min-height: clamp(36px, 7vh, 48px); padding: 6px 10px; }
}

@media (orientation: landscape) and (max-height: 480px) {
  .animal-name, .score-line { font-size: .68rem; }
  .question-type, .battle-status-text { font-size: .7rem; }
  .choice-grid { gap: 6px; }
}
```

- [ ] **Step 5: Make portrait phone rotate hint authoritative**

Ensure the portrait rule overlays the full battle surface:

```css
@media (orientation: portrait) and (max-width: 700px) {
  body.battle-mode .rotate-hint { display: grid; }
  body.battle-mode .battle-status-row,
  body.battle-mode .character-stage,
  body.battle-mode .question-panel { visibility: hidden; }
}
```

- [ ] **Step 6: Run responsive/UI tests and verify GREEN**

```bash
node --test tests/ui-contract.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit Task 4**

```bash
git add index.html tests/ui-contract.test.mjs
git commit -m "feat: fit battle UI into landscape viewport"
```

---

### Task 5: Add victory/defeat overlays and petal rain

**Files:**
- Modify: `index.html`
- Modify: `tests/ui-contract.test.mjs`

**Interfaces:**
- Produces: `VICTORY_MESSAGES: string[]`
- Produces: `DEFEAT_MESSAGES: string[]`
- Produces: `launchPetalRain(durationMs = 5000)`
- Produces: `clearPetalRain()`
- Reuses: `battle-return-btn`

- [ ] **Step 1: Add failing victory/defeat contract tests**

```js
test('result presentation includes petal layer and distinct victory/defeat copy pools', () => {
  assert.match(html, /id="petal-layer"/);
  assert.match(html, /VICTORY_MESSAGES/);
  assert.match(html, /DEFEAT_MESSAGES/);
  assert.match(html, /launchPetalRain/);
  assert.match(html, /prefers-reduced-motion/);
});
```

- [ ] **Step 2: Run and verify RED**

```bash
node --test tests/ui-contract.test.mjs
```

Expected: FAIL because petal/result APIs are missing.

- [ ] **Step 3: Add result overlay markup and petal layer**

Inside `tech-arena`, add a top-level visual layer:

```html
<div class="petal-layer" id="petal-layer" aria-hidden="true"></div>
```

Keep result controls accessible and above attack layers.

- [ ] **Step 4: Add distinct copy pools**

```js
const VICTORY_MESSAGES = [
  '🏆 王者誕生！等差數列霸主就是你！',
  '⚡ 完美制霸！這局完全被你掌控！',
  '👑 冠軍登場！你的數列火力無人能擋！',
];

const DEFEAT_MESSAGES = [
  '差一點就反殺了！下一局再來！',
  '這局只是熱身，下局一定扳回來！',
  '已經很接近了，再挑戰一次！',
];
```

- [ ] **Step 5: Implement self-cleaning petal rain**

```js
function clearPetalRain() {
  petalLayer.textContent = '';
}

function launchPetalRain(durationMs = 5000) {
  clearPetalRain();
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const count = 70;
  for (let i = 0; i < count; i += 1) {
    const petal = document.createElement('span');
    petal.className = 'petal';
    petal.textContent = ['🌸', '🌺', '✨'][i % 3];
    petal.style.left = `${Math.random() * 100}%`;
    petal.style.animationDelay = `${Math.random() * 1.2}s`;
    petal.style.animationDuration = `${2.8 + Math.random() * 2}s`;
    petalLayer.appendChild(petal);
  }
  setTimeout(clearPetalRain, durationMs + 1500);
}
```

- [ ] **Step 6: Update `finishBattle(state)`**

When `won` is true:

```js
battleResultTitle.textContent = randomFrom(VICTORY_MESSAGES);
battleResultText.textContent = '太強了！按下按鈕回到大廳，再接受下一位挑戰者。';
battleResult.classList.add('show', 'victory');
launchPetalRain(5000);
```

When false:

```js
battleResultTitle.textContent = '💪 再戰一局！';
battleResultText.textContent = randomFrom(DEFEAT_MESSAGES);
battleResult.classList.add('show', 'defeat');
clearPetalRain();
```

Do not schedule any automatic navigation.

- [ ] **Step 7: Run UI tests and verify GREEN**

```bash
node --test tests/ui-contract.test.mjs
```

Expected: PASS.

- [ ] **Step 8: Commit Task 5**

```bash
git add index.html tests/ui-contract.test.mjs
git commit -m "feat: add win celebration and defeat encouragement"
```

---

### Task 6: Add oversized sword slash to correct-answer attack sequence

**Files:**
- Modify: `index.html`
- Modify: `tests/ui-contract.test.mjs`

**Interfaces:**
- Produces DOM IDs: `sword-left`, `sword-right`
- Extends `animateEvent(state)` only for `last_event_type === 'hit'`
- Preserves wrong-answer `self_hit` without laser or sword

- [ ] **Step 1: Add failing sword-animation contract test**

```js
test('correct-hit animation includes directional sword layers', () => {
  assert.match(html, /id="sword-left"/);
  assert.match(html, /id="sword-right"/);
  assert.match(html, /sword-slash/);
  assert.match(html, /last_event_type\s*===\s*['"]hit['"]/);
});
```

- [ ] **Step 2: Run and verify RED**

```bash
node --test tests/ui-contract.test.mjs
```

Expected: FAIL because sword layers/animation are missing.

- [ ] **Step 3: Add directional sword DOM layers**

Inside `character-stage`:

```html
<div class="sword-slash sword-left" id="sword-left" aria-hidden="true">⚔️</div>
<div class="sword-slash sword-right" id="sword-right" aria-hidden="true">⚔️</div>
```

- [ ] **Step 4: Add slash CSS and mirror directions**

```css
.sword-slash {
  position: absolute;
  z-index: 7;
  top: 18%;
  font-size: clamp(88px, 20vw, 190px);
  opacity: 0;
  filter: drop-shadow(0 0 12px #fff) drop-shadow(0 0 28px #53ddff);
  pointer-events: none;
}
.sword-left { left: 26%; transform: translate(-30%, -40%) rotate(-55deg) scale(.4); }
.sword-right { right: 26%; transform: translate(30%, -40%) rotate(55deg) scale(.4) scaleX(-1); }
.sword-left.slash { animation: sword-left-slash .42s cubic-bezier(.1,.9,.2,1); }
.sword-right.slash { animation: sword-right-slash .42s cubic-bezier(.1,.9,.2,1); }
```

Define keyframes that sweep across the center toward the target and fade out.

- [ ] **Step 5: Extend `animateEvent(state)` timing**

For `hit` only:

```js
const sword = eventFromSelf ? swordLeft : swordRight;
setTimeout(() => {
  sword.classList.remove('slash');
  void sword.offsetWidth;
  sword.classList.add('slash');
}, 300);
```

Keep the existing lunge first and laser second. Apply target shake/flash after the slash begins. For `self_hit`, do not touch laser or sword layers.

- [ ] **Step 6: Run UI tests and verify GREEN**

```bash
node --test tests/ui-contract.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit Task 6**

```bash
git add index.html tests/ui-contract.test.mjs
git commit -m "feat: add sword slash to successful attacks"
```

---

### Task 7: Integrated regression verification and deployment handoff

**Files:**
- Verify: `index.html`
- Verify: `game-logic.js`
- Verify: `supabase-phase3.sql`
- Verify: `tests/*.test.mjs`

**Interfaces:**
- No new interfaces. This task verifies the assembled V4 release.

- [ ] **Step 1: Run the full automated test suite**

```bash
node --test tests/*.test.mjs
```

Expected: zero failures.

- [ ] **Step 2: Run JavaScript syntax checks**

```bash
node --check game-logic.js
```

Extract the inline module script from `index.html` to a temporary `.mjs` file and run:

```bash
node --check /tmp/sequence-battle-inline.mjs
```

Expected: exit code 0 for both.

- [ ] **Step 3: Check HTML ID uniqueness**

Use a small script that extracts all `id="..."` attributes from `index.html` and asserts no duplicates. Expected: no duplicate IDs.

- [ ] **Step 4: Manual browser matrix — layout**

Verify at minimum these viewport classes using browser responsive tools or real devices:

```text
Desktop landscape: 1366x768
Tablet landscape: 1024x768
Small tablet landscape: 960x600
Phone landscape: 844x390
Phone portrait: 390x844
```

Acceptance:

```text
Landscape: no vertical scroll, no horizontal scroll, full HUD + both animals + question + 4 choices visible.
Portrait phone: rotate prompt covers battle UI.
```

- [ ] **Step 5: Manual two-device multiplayer matrix**

Run one complete match using two separate devices or browser profiles:

```text
1. Player A enters nickname and creates room.
2. Confirm A can cancel while waiting and returns to lobby with nickname preserved.
3. Create again; Player B joins.
4. Confirm both views show self on left and opponent on right.
5. Confirm correct answer triggers lunge -> laser -> sword -> hit on both clients.
6. Confirm wrong answer self-damages without laser/sword.
7. Confirm Unicode terms such as a₂ / a₁₀ appear in generated questions.
8. Finish a match.
9. Winner sees celebratory copy + petal rain and remains until button press.
10. Loser sees encouragement, no petal rain, and remains until button press.
11. Confirm return-to-lobby works for both.
```

- [ ] **Step 6: Supabase phase-3 manual verification**

After the user executes `supabase-phase3.sql` in Supabase SQL Editor, verify:

```text
- Host cancel while waiting returns success.
- Cancelled room disappears from lobby.
- Non-host cannot cancel.
- Attempt to cancel after room status becomes playing returns ROOM_ALREADY_STARTED.
```

- [ ] **Step 7: Create pull request**

```bash
git push -u origin feature/sequence-battle-v4
gh pr create --base main --head feature/sequence-battle-v4 \
  --title "Upgrade battle UX and room lifecycle" \
  --body "Implements approved V4 spec: cancel-room RPC, random welcome animal, landscape one-screen layout, Unicode subscripts, victory petals, defeat encouragement, and laser+sword attacks."
```

- [ ] **Step 8: Review PR diff before merge**

Confirm only the intended files changed and that `supabase-phase3.sql` is additive. Do not merge until tests are green and the user has the SQL execution instructions.

- [ ] **Step 9: Merge and re-fetch `main`**

After merge, fetch `main/index.html`, `main/game-logic.js`, and `main/supabase-phase3.sql` and confirm the expected markers are present.

---

## Self-Review Results

### Spec coverage

- Requirement 1 (`資料庫已連接`) -> Task 3.
- Requirement 2 (random animal + random welcome phrase) -> Tasks 1 and 3.
- Requirement 3 (cancel waiting room, preserve nickname, return lobby) -> Tasks 2 and 3.
- Requirement 4 (landscape one-screen on desktop/tablet/phone; portrait rotate prompt) -> Task 4 and Task 7 manual matrix.
- Requirement 5 (victory celebration + petals; defeat encouragement; manual return) -> Task 5.
- Requirement 6 (Unicode subscripts) -> Task 1.
- Requirement 7 (lunge + laser + sword) -> Task 6.
- Existing disconnect behavior remains covered by Task 7 multiplayer regression.

### Placeholder scan

No `TBD`, `TODO`, “implement later”, or unspecified error-handling placeholders remain. Every implementation task includes exact function names, DOM IDs, or SQL signatures plus a concrete verification command.

### Interface consistency

- `pickWelcomeContent()` is produced in Task 1 and consumed in Task 3.
- `cancel_room(uuid, uuid)` is produced in Task 2 and called with `p_room_id` / `p_client_token` in Task 3.
- `battle-return-btn` remains the single explicit result exit control.
- `resolve_answer()` is unchanged.
- `sword-left` / `sword-right` are produced and consumed within Task 6.
