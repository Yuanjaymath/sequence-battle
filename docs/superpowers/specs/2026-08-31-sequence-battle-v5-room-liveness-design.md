# 等差數列即時對戰 V5：等待房在線生命週期設計規格

日期：2026-08-31
狀態：待使用者最終確認

## 目標

解決「房主建立等待房後直接關閉瀏覽器，房間仍長期留在大廳，其他玩家甚至能加入無房主對戰」的問題。

V5 採使用者確認的方案 C：

- 等待中的房主持續 heartbeat。
- 10 秒未收到 heartbeat 即視為房主離線。
- 正常關頁時使用 `pagehide + fetch(..., { keepalive: true })` 最佳努力立即取消。
- 加入前做 2 秒 Realtime `join_probe / host_ack` 即時握手。
- 資料庫仍做最後一道 liveness 防線，過期房不可加入。
- A、B 的 Realtime Presence 改為同一個房間 topic，讓真正的對手離線偵測可以運作。

---

## 1. 問題根因

目前大廳只依 `rooms.status = 'waiting'` 顯示房間。房主按「取消房間」時，V4 的 `cancel_room()` 會把房間改為 `finished`；但直接關閉瀏覽器時，JavaScript 不一定有機會呼叫 RPC，因此資料庫會永久保留 `waiting`。

另外，目前遊戲 Presence topic 為：

`game-${roomId}-${clientToken}`

由於 A、B 的 `clientToken` 不同，兩人實際上可能訂閱不同 Presence topic，無法可靠看到彼此的 presence。V5 必須改為共同 topic：

`game-${roomId}`

Presence 個人 key 仍使用各自的 `clientToken`，所以同一房間內仍可辨識不同玩家。

---

## 2. Heartbeat 儲存設計

### 2.1 使用獨立表而不是直接更新 `rooms`

新增：

`public.room_heartbeats`

欄位：

- `room_id uuid primary key references public.rooms(id) on delete cascade`
- `host_last_seen_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

理由：房主每 3 秒 heartbeat 一次。如果直接更新 `rooms`，目前 lobby 對 `rooms` 的 Realtime 訂閱會把每次 heartbeat 都當成房間變動，造成所有大廳客戶端頻繁 reload。獨立 heartbeat 表不加入公開 Realtime publication，也不提供匿名直接 SELECT/INSERT/UPDATE，可避免不必要的事件風暴。

### 2.2 新房初始化

新增資料庫 trigger：當 `rooms` 插入新房時，自動在 `room_heartbeats` 建立該房間的 heartbeat row，時間為 `now()`。

這樣不用修改既有 `create_room()`，也不會出現「房間已進大廳，但第一個 heartbeat 還沒寫入」的競態。

---

## 3. 房主 Heartbeat

新增 RPC：

`public.heartbeat_room(p_room_id uuid, p_client_token uuid) returns jsonb`

規則：

1. 參數不可為 null。
2. 必須在 `players` 找到相同 `room_id + client_token`。
3. seat 必須為 1，只有房主可以 heartbeat。
4. `rooms.status` 必須仍為 `waiting`。
5. 驗證成功後更新 `room_heartbeats.host_last_seen_at = now()`。
6. 使用 `security definer`、固定 `search_path`，撤銷 public 預設 execute，只 grant `anon, authenticated`。

前端：

- 房主成功建立房間並進入 waiting 後，立刻 heartbeat 一次。
- 接著每 3000ms heartbeat 一次。
- 只在 `currentSeat === 1 && currentScreen === 'waiting'` 時執行。
- 進入 playing、取消房間、回大廳、回初始畫面時立即停止 heartbeat timer。

過期門檻固定為：

`10 seconds`

---

## 4. 大廳只顯示真正在線的等待房

新增 RPC：

`public.list_live_rooms() returns table (...)`

### 4.1 清理

呼叫時先找：

- `rooms.status = 'waiting'`
- heartbeat 不存在，或 `host_last_seen_at < now() - interval '10 seconds'`

這些 stale room 會被軟結束：

- `rooms.status = 'finished'`
- `game_state.status = 'finished'`
- 更新相關 `updated_at / finished_at / last_activity_at`

不硬刪歷史資料。

### 4.2 回傳

只回傳仍為 waiting 且 heartbeat 尚未過期的房間，欄位至少包含：

- `id`
- `host_nickname`
- `status`
- `player_count`
- `created_at`
- `host_last_seen_at`
- `expires_in_ms`

`expires_in_ms` 由 PostgreSQL 使用伺服器時間計算，避免依賴手機／平板本機時鐘是否準確。

### 4.3 前端刷新策略

V5 的 `loadLobby()` 改呼叫 `list_live_rooms()`，不再直接 `SELECT rooms WHERE status='waiting'`。

每次 render 後，只設定一個「最早即將過期房間」timer：

- timer 延遲使用所有房間中最小的 `expires_in_ms`。
- timer 到時重新呼叫 `loadLobby()`。
- 若房主仍在線，新的 heartbeat 會讓 RPC 回傳新的 TTL，再重新排 timer。
- 若房主已離線，過期房會在這次 RPC 被標 finished 並從 UI 消失。

因此不需要每 1～3 秒不停輪詢大廳，也能讓房間在約 10 秒門檻附近消失。

既有 `rooms` Realtime 訂閱保留，用於新房建立、正常取消、成功配對等真正的 room 狀態變更；heartbeat 不會觸發該 subscription。

---

## 5. 加入前 2 秒即時握手

### 5.1 共用房間 topic

所有房間 Realtime topic 改成：

`game-${roomId}`

Host waiting 時已經訂閱此 topic。

### 5.2 B 的加入流程

玩家 B 點「加入對戰」後，不立刻呼叫 `join_room()`：

1. UI 顯示「正在確認房主在線…」。
2. 建立暫時的 Realtime channel，topic 同為 `game-${roomId}`。
3. 產生一次性 `probe_id`。
4. B broadcast：`join_probe`，payload 至少包含 `probe_id`。
5. A 若仍在線、seat=1、目前仍為 waiting，立即 broadcast：`host_ack`，帶回同一個 `probe_id`。
6. B 只接受 probe_id 完全相同的 ack。
7. 2 秒內收到 ack：移除暫時 probe channel，再呼叫既有 `join_room()`。
8. 2 秒未收到 ack：移除 probe channel，不呼叫 `join_room()`，顯示「房主已離開，請選其他房間」，留在大廳並重新整理 live rooms。

同時多名玩家 probe 時，每個 probe_id 獨立；即使多人都收到 ack，資料庫既有 `join_room()` 鎖仍只允許一人成功取得 seat 2。

---

## 6. 資料庫加入防線

### 6.1 最終保護

即時握手是 UX 與快速判斷，不是唯一安全判斷。資料庫必須保證 stale host 的 waiting room 絕對不能轉為兩人對戰。

### 6.2 V5 設計 refinement：使用 DB guard trigger，不直接覆寫既有 `join_room()`

原設計討論曾說「phase4 更新既有 `join_room()` 加 heartbeat 檢查」。正式規格改採更保守的做法：**保留現有 `join_room()` 不動，在 `rooms` 上新增 BEFORE UPDATE guard trigger**。

理由：目前 repo 沒有保存 phase-1 的完整 `join_room()` SQL 原始檔，直接重新定義容易意外破壞已驗證的 join 行為。Trigger 能在資料庫最終狀態轉換點強制同一規則，而且任何呼叫路徑都無法繞過。

Guard 條件：

- OLD room 為 `waiting`。
- NEW 嘗試進入 `playing`，或 player_count 嘗試變成 2。

此時必須存在 `room_heartbeats` 且：

`host_last_seen_at >= now() - interval '10 seconds'`

否則 raise：

`HOST_OFFLINE`

若 `join_room()` 已先 INSERT seat 2 再 UPDATE rooms，trigger 的 exception 會使整個 RPC transaction rollback，因此不會留下半加入 player。

前端 `friendlyError()` 對 `HOST_OFFLINE` 顯示：

「房主已離開，請選其他房間。」

並回到／留在 lobby 後刷新。

---

## 7. 正常關閉瀏覽器：最佳努力立即取消

新增 `pagehide` listener。

只在以下條件成立時觸發：

- `currentSeat === 1`
- `currentScreen === 'waiting'`
- 有 `currentRoomId`

使用直接 REST RPC request：

`POST /rest/v1/rpc/cancel_room`

並設定：

- `keepalive: true`
- publishable/anon key headers
- body：`p_room_id + p_client_token`

這只是加速方案，不把它當可靠保證。瀏覽器被強制殺掉、裝置斷電、網路突然中斷時可能完全送不出去；真正的可靠兜底仍是 10 秒 heartbeat expiry。

切換分頁／瀏覽器進背景不使用 `visibilitychange` 取消，避免學生只是切去另一個分頁就誤刪房間。

---

## 8. Playing 階段的 Presence 修正

`watchGameState(roomId)` 的 channel topic 從：

`game-${roomId}-${getClientToken()}`

改為：

`game-${roomId}`

presence key 保持：

`getClientToken()`

track payload 保持 seat、nickname、online_at。

原有 playing 階段斷線邏輯仍使用約 5 秒 grace：

- 對手曾經 present。
- battle 已開始。
- state 仍 playing。
- 對手 presence 消失約 5 秒後顯示「對手已斷線」，再結束本局。

V5 不改這個 5 秒 playing grace，只修正雙方必須真正位於相同 topic。

---

## 9. 競態處理

### 情境 A：A 正常在線，B 加入

heartbeat fresh → probe 收到 host_ack → `join_room()` → DB trigger heartbeat fresh → 正常 playing。

### 情境 B：A 剛關閉，heartbeat 還在 10 秒內

B 看得到 room → probe 2 秒收不到 host_ack → 不呼叫 join → 回 lobby。

### 情境 C：A 關閉超過 10 秒

`list_live_rooms()` 清理 stale room → B 大廳看不到。

### 情境 D：A ack 後立刻關閉

B 可能成功 join，但共用 Presence topic 隨後偵測 seat1 消失 → 使用既有 5 秒 playing grace 結束本局。

### 情境 E：B 跳過前端 probe 直接呼叫 join RPC

DB guard trigger 檢查 heartbeat。若 stale，raise `HOST_OFFLINE`，transaction rollback。

---

## 10. Phase 4 SQL 範圍

新增：

`supabase-phase4.sql`

內容包含：

- 建立 `room_heartbeats`。
- RLS + revoke direct access。
- 新房 heartbeat 初始化 trigger。
- `heartbeat_room()` RPC。
- `list_live_rooms()` RPC。
- stale room 軟清理邏輯。
- waiting→playing liveness guard trigger。
- grant execute 給 `anon, authenticated`。
- migration 時為目前仍為 waiting 的既有房建立 heartbeat seed；若實際房主已離線，約 10 秒後自然過期。

不修改 phase1～phase3 檔案；phase4 為 additive migration。

---

## 11. 前端檔案範圍

主要修改：

`app.js`

- heartbeat timer 啟停。
- `loadLobby()` 改用 `list_live_rooms()`。
- lobby expiry timer。
- shared room channel topic。
- `join_probe / host_ack`。
- 2 秒 join timeout。
- `HOST_OFFLINE` friendly error。
- `pagehide + keepalive` best-effort cancel。

`index.html`

- 原則上不需要重大 UI 重排。
- 只在有需要時調整「正在確認房主在線…」等提示樣式。

可新增：

`room-liveness.js`

將 liveness 常數與純函數集中，避免 `app.js` 再膨脹：

- `HEARTBEAT_INTERVAL_MS = 3000`
- `HOST_STALE_MS = 10000`
- `JOIN_PROBE_TIMEOUT_MS = 2000`
- `roomTopic(roomId)`
- probe payload 驗證／TTL helper

---

## 12. 測試與驗證

### 自動測試

- heartbeat interval 固定 3000ms。
- stale threshold 固定 10000ms。
- join probe timeout 固定 2000ms。
- topic 對 A/B 都為 `game-${roomId}`，不可含 client token。
- `loadLobby()` 必須呼叫 `list_live_rooms()`。
- `joinRoom()` 必須先 probe，再呼叫 `join_room()`。
- probe timeout 不可呼叫 `join_room()`。
- `pagehide` request 必須 `keepalive: true`，且只限 host waiting。
- SQL contract 驗證 heartbeat table、RPC、10 秒 threshold、security definer、revoke/grant、guard trigger、`HOST_OFFLINE`。
- 既有 V4 tests 全部保持 green。

### 真機驗收

至少測：

1. A 開房 → 正常按取消：仍可立即回 lobby。
2. A 開房 → 直接關分頁：其他裝置的大廳約 10 秒內房間消失。
3. A 開房 → 強制關閉瀏覽器／斷網：房間約 10 秒內失效。
4. A 剛離線但卡片尚可見 → B 點加入：2 秒內被擋下，不能進入單人 battle。
5. A 正常在線 → B 加入：正常配對。
6. A/B playing 後 A 關閉：B 約 5 秒偵測對手斷線。
7. 同時兩位 B/C 點同一房：仍只有一人成功 seat 2。

---

## 13. 不在本次範圍

- 不做帳號登入。
- 不做永久 reconnect/resume battle。
- 不做 Supabase cron 清房；清理由 `list_live_rooms()` 觸發即可。
- 不改題目、攻擊動畫、勝負畫面。
- 不建立排行榜或長期成績。
