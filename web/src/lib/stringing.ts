import { getDb } from './db';
import { pushMessage, getProfile } from './line';

// ── 型別 ────────────────────────────────────────────────────────────────

export type OrderStatus = 'pending' | 'stringing' | 'ready' | 'done';
export type SlotStatus = 'empty' | 'occupied';

export const STATUS_LABEL: Record<OrderStatus, string> = {
  pending: '待收件',
  stringing: '穿線中',
  ready: '待取件',
  done: '已完成',
};

export interface StringItem {
  id: number;
  model: string;
  gauge: string;
  feature: string;
  maxTension: number;
  price: number;
  isActive: boolean;
}

export interface OrderItem {
  id: number;
  orderNo: string;
  stringId: number;
  stringModel: string;
  tension: number;
  price: number;
  pickupCode: string;
  status: OrderStatus;
  paid: boolean;
  lineUserId: string;
  lineName: string;
  customerName: string;
  note: string;
  currentSlot: number | null;
  createdAt: string;
  completedAt: string | null;
}

export interface SlotItem {
  id: number;
  slotNo: number;
  status: SlotStatus;
  orderId: number | null;
}

export interface PrintJobItem {
  id: number;
  orderId: number;
  status: 'pending' | 'done';
  label: {
    orderNo: string;
    pickupCode: string;
    model: string;
    tension: number;
    price: number;
    slotNo: number;
  };
  createdAt: string;
  doneAt: string | null;
}

export interface CellCommand {
  id: number;
  slotNo: number;
  status: 'pending' | 'done';
  createdAt: string;
  doneAt: string | null;
}

// ── 線種種子（11 條，與 HANDOFF 價目表一致）────────────────────────────

// model / gauge / feature / max_tension / price
const STRING_SEED: Array<[string, string, string, number, number]> = [
  ['AL-69', '0.69mm', '硬線', 28, 250],
  ['AL-66', '0.66mm', '硬線', 30, 250],
  ['AL-65', '0.65mm', '硬線', 30, 300],
  ['AL-63', '0.63mm', '鍍鈦線', 28, 350],
  ['YOUNG66', '0.66mm', '硬線', 30, 250],
  ['YOUNG65', '0.65mm', '硬線', 28, 300],
  ['YOUNG63', '0.63mm', '鍍鈦硬線', 28, 350],
  ['BG65', '0.70mm', '軟線', 26, 250],
  ['BG65-2', '0.70mm', '軟線', 26, 250],
  ['BG65-T-2', '0.70mm', '鈦', 28, 350],
  ['BG80-2', '0.68mm', '—', 28, 350],
];

// ── Schema 初始化（惰性 + 每個 instance 只跑一次）────────────────────────

let ensurePromise: Promise<void> | null = null;

export function ensureStringingSchema(): Promise<void> {
  if (!ensurePromise) {
    ensurePromise = (async () => {
      const sql = getDb();

      await sql`
        CREATE TABLE IF NOT EXISTS strings (
          id SERIAL PRIMARY KEY,
          model VARCHAR(40) NOT NULL UNIQUE,
          gauge VARCHAR(10) NOT NULL DEFAULT '',
          feature VARCHAR(40) NOT NULL DEFAULT '',
          max_tension INTEGER NOT NULL DEFAULT 30,
          price INTEGER NOT NULL DEFAULT 0,
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS locker_slots (
          id SERIAL PRIMARY KEY,
          slot_no INTEGER NOT NULL UNIQUE,
          status VARCHAR(10) NOT NULL DEFAULT 'empty',
          order_id INTEGER,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS orders (
          id SERIAL PRIMARY KEY,
          order_no VARCHAR(30) NOT NULL UNIQUE,
          string_id INTEGER NOT NULL REFERENCES strings(id),
          tension INTEGER NOT NULL,
          price INTEGER NOT NULL DEFAULT 0,
          pickup_code VARCHAR(6) NOT NULL UNIQUE,
          status VARCHAR(10) NOT NULL DEFAULT 'pending',
          paid BOOLEAN NOT NULL DEFAULT FALSE,
          line_user_id VARCHAR(255) NOT NULL DEFAULT '',
          line_name VARCHAR(255) NOT NULL DEFAULT '',
          customer_name VARCHAR(100) NOT NULL DEFAULT '',
          note VARCHAR(255) NOT NULL DEFAULT '',
          current_slot INTEGER,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          completed_at TIMESTAMPTZ
        )
      `;

      await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS line_name VARCHAR(255) NOT NULL DEFAULT ''`;

      await sql`
        CREATE TABLE IF NOT EXISTS print_jobs (
          id SERIAL PRIMARY KEY,
          order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
          status VARCHAR(10) NOT NULL DEFAULT 'pending',
          label_data TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          done_at TIMESTAMPTZ
        )
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS cell_commands (
          id SERIAL PRIMARY KEY,
          slot_no INTEGER NOT NULL,
          status VARCHAR(10) NOT NULL DEFAULT 'pending',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          done_at TIMESTAMPTZ
        )
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS kiosk_sessions (
          id SERIAL PRIMARY KEY,
          code VARCHAR(4) NOT NULL UNIQUE,
          line_user_id VARCHAR(255) NOT NULL DEFAULT '',
          line_name VARCHAR(255) NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          linked_at TIMESTAMPTZ
        )
      `;

      await sql`CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_orders_pickup_code ON orders(pickup_code)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_orders_line_user_id ON orders(line_user_id)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_locker_slots_status ON locker_slots(status)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_print_jobs_status ON print_jobs(status)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_cell_commands_status ON cell_commands(status)`;

      // 種入 11 條線種（已存在則跳過，保留後續人工調整）
      await sql`
        INSERT INTO strings (model, gauge, feature, max_tension, price) VALUES
          ('AL-69', '0.69mm', '硬線', 28, 250),
          ('AL-66', '0.66mm', '硬線', 30, 250),
          ('AL-65', '0.65mm', '硬線', 30, 300),
          ('AL-63', '0.63mm', '鍍鈦線', 28, 350),
          ('YOUNG66', '0.66mm', '硬線', 30, 250),
          ('YOUNG65', '0.65mm', '硬線', 28, 300),
          ('YOUNG63', '0.63mm', '鍍鈦硬線', 28, 350),
          ('BG65', '0.70mm', '軟線', 26, 250),
          ('BG65-2', '0.70mm', '軟線', 26, 250),
          ('BG65-T-2', '0.70mm', '鈦', 28, 350),
          ('BG80-2', '0.68mm', '—', 28, 350)
        ON CONFLICT (model) DO NOTHING
      `;

      // 停用舊線種（已不再販售）
      await sql`
        UPDATE strings SET is_active = FALSE
        WHERE model IN ('KIZUNA Z61', 'KIZUNA Z63X', 'KIZUNA Z65X', 'DEARFLY61 螺紋線')
      `;

      // 種入格口（數量可調，預設 22）
      const slotCount = Math.max(1, Number(process.env.LOCKER_SLOT_COUNT || 22));
      await sql`
        INSERT INTO locker_slots (slot_no)
        SELECT gs FROM generate_series(1, ${slotCount}) AS gs
        ON CONFLICT (slot_no) DO NOTHING
      `;

      console.log('[Stringing] Schema ensured');
    })().catch((err) => {
      ensurePromise = null; // 失敗時重設，讓下一次請求重試
      throw err;
    });
  }
  return ensurePromise;
}

// ── 工具 ────────────────────────────────────────────────────────────────

function toIso(v: any): string {
  if (!v) return '';
  return v instanceof Date ? v.toISOString() : String(v);
}

function rowToString(row: any): StringItem {
  return {
    id: Number(row.id),
    model: row.model,
    gauge: row.gauge,
    feature: row.feature,
    maxTension: Number(row.max_tension),
    price: Number(row.price ?? 0),
    isActive: Boolean(row.is_active),
  };
}

function rowToOrder(row: any, modelOverride?: string): OrderItem {
  return {
    id: Number(row.id),
    orderNo: row.order_no,
    stringId: Number(row.string_id),
    stringModel: modelOverride || row.string_model || '',
    tension: Number(row.tension),
    price: Number(row.price ?? 0),
    pickupCode: row.pickup_code,
    status: row.status,
    paid: Boolean(row.paid),
    lineUserId: row.line_user_id || '',
    lineName: row.line_name || '',
    customerName: row.customer_name || '',
    note: row.note || '',
    currentSlot: row.current_slot == null ? null : Number(row.current_slot),
    createdAt: toIso(row.created_at),
    completedAt: toIso(row.completed_at),
  };
}

// ── 線種 ────────────────────────────────────────────────────────────────

export async function listStrings(activeOnly = true): Promise<StringItem[]> {
  await ensureStringingSchema();
  const sql = getDb();
  const rows = activeOnly
    ? await sql`SELECT * FROM strings WHERE is_active = TRUE ORDER BY id`
    : await sql`SELECT * FROM strings ORDER BY id`;
  return rows.map(rowToString);
}

export async function getString(id: number): Promise<StringItem | null> {
  await ensureStringingSchema();
  const sql = getDb();
  const rows = await sql`SELECT * FROM strings WHERE id = ${id} AND is_active = TRUE`;
  return rows.length ? rowToString(rows[0]) : null;
}

// ── 格口 ────────────────────────────────────────────────────────────────

export async function listSlots(): Promise<SlotItem[]> {
  await ensureStringingSchema();
  const sql = getDb();
  const rows = await sql`SELECT * FROM locker_slots ORDER BY slot_no`;
  return rows.map((r: any) => ({
    id: Number(r.id),
    slotNo: Number(r.slot_no),
    status: r.status,
    orderId: r.order_id == null ? null : Number(r.order_id),
  }));
}

async function occupyEmptySlot(orderId: number | null = null): Promise<number> {
  const sql = getDb();
  const rows = await sql`SELECT slot_no FROM locker_slots WHERE status = 'empty' ORDER BY slot_no LIMIT 1`;
  if (rows.length === 0) throw new Error('暫無空置格口，請稍後再試');
  const slotNo = Number(rows[0].slot_no);
  const updated = await sql`
    UPDATE locker_slots SET status = 'occupied', order_id = ${orderId}, updated_at = NOW()
    WHERE slot_no = ${slotNo} AND status = 'empty'
    RETURNING slot_no
  `;
  if (updated.length === 0) throw new Error('格口分配衝突，請重試');
  return Number(updated[0].slot_no);
}

async function releaseSlot(slotNo: number | null): Promise<void> {
  if (slotNo == null) return;
  const sql = getDb();
  await sql`
    UPDATE locker_slots SET status = 'empty', order_id = NULL, updated_at = NOW()
    WHERE slot_no = ${slotNo}
  `;
}

// ── 訂單查詢 ────────────────────────────────────────────────────────────

export async function getOrderById(id: number): Promise<OrderItem | null> {
  await ensureStringingSchema();
  const sql = getDb();
  const rows = await sql`
    SELECT o.*, s.model AS string_model
    FROM orders o JOIN strings s ON s.id = o.string_id
    WHERE o.id = ${id}
  `;
  return rows.length ? rowToOrder(rows[0]) : null;
}

export async function getOrderByPickupCode(code: string): Promise<OrderItem | null> {
  await ensureStringingSchema();
  const sql = getDb();
  const rows = await sql`
    SELECT o.*, s.model AS string_model
    FROM orders o JOIN strings s ON s.id = o.string_id
    WHERE o.pickup_code = ${code}
  `;
  return rows.length ? rowToOrder(rows[0]) : null;
}

export async function listOrders(status?: OrderStatus): Promise<OrderItem[]> {
  await ensureStringingSchema();
  const sql = getDb();
  const rows = status
    ? await sql`
        SELECT o.*, s.model AS string_model
        FROM orders o JOIN strings s ON s.id = o.string_id
        WHERE o.status = ${status}
        ORDER BY o.id DESC LIMIT 200
      `
    : await sql`
        SELECT o.*, s.model AS string_model
        FROM orders o JOIN strings s ON s.id = o.string_id
        ORDER BY o.id DESC LIMIT 200
      `;
  return rows.map((r: any) => rowToOrder(r));
}

export async function listMineOrders(lineUserId: string): Promise<OrderItem[]> {
  await ensureStringingSchema();
  const sql = getDb();
  const rows = await sql`
    SELECT o.*, s.model AS string_model
    FROM orders o JOIN strings s ON s.id = o.string_id
    WHERE o.line_user_id = ${lineUserId}
    ORDER BY o.id DESC LIMIT 50
  `;
  return rows.map((r: any) => rowToOrder(r));
}

/** 查詢該 LINE 用戶「最近一筆」訂單（自動帶 ID，不用再輸入碼） */
export async function getLatestOrderByLineUser(lineUserId: string): Promise<OrderItem | null> {
  await ensureStringingSchema();
  const sql = getDb();
  const rows = await sql`
    SELECT o.*, s.model AS string_model
    FROM orders o JOIN strings s ON s.id = o.string_id
    WHERE o.line_user_id = ${lineUserId}
    ORDER BY o.id DESC LIMIT 1
  `;
  return rows.length ? rowToOrder(rows[0]) : null;
}

// ── 建立訂單（kiosk 下單）──────────────────────────────────────────────

export async function createOrder(input: {
  stringId: number;
  tension: number;
  lineUserId?: string;
  customerName?: string;
  note?: string;
}): Promise<OrderItem> {
  await ensureStringingSchema();
  const sql = getDb();

  const stringItem = await getString(input.stringId);
  if (!stringItem) throw new Error('線種不存在或已停用');

  const tension = Number(input.tension);
  if (!Number.isInteger(tension) || tension < 1) throw new Error('磅數無效');
  if (tension > stringItem.maxTension) {
    throw new Error(`「${stringItem.model}」磅數上限為 ${stringItem.maxTension} lbs`);
  }

  // 先佔一格（交拍格）
  const slotNo = await occupyEmptySlot();

  // 產生不重複 6 位取件碼
  let pickupCode = '';
  for (let i = 0; i < 100; i++) {
    pickupCode = String(Math.floor(100000 + Math.random() * 900000));
    const dup = await sql`SELECT 1 FROM orders WHERE pickup_code = ${pickupCode}`;
    if (dup.length === 0) break;
  }
  if (!pickupCode) throw new Error('取件碼產生失敗');

  // 產生單號 S-YYYYMMDD-XXXX
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  let orderNo = '';
  for (let i = 0; i < 100; i++) {
    orderNo = `S-${day}-${String(Math.floor(1000 + Math.random() * 9000))}`;
    const dup = await sql`SELECT 1 FROM orders WHERE order_no = ${orderNo}`;
    if (dup.length === 0) break;
  }
  if (!orderNo) throw new Error('單號產生失敗');

  const inserted = await sql`
    INSERT INTO orders (order_no, string_id, tension, price, pickup_code, status, paid, line_user_id, customer_name, note, current_slot)
    VALUES (${orderNo}, ${stringItem.id}, ${tension}, ${stringItem.price}, ${pickupCode}, 'pending', FALSE,
            ${input.lineUserId || ''}, ${input.customerName || ''}, ${input.note || ''}, ${slotNo})
    RETURNING *
  `;
  const orderId = Number(inserted[0].id);
  await sql`
    UPDATE locker_slots SET order_id = ${orderId} WHERE slot_no = ${slotNo}
  `;

  // 建立列印工作（kiosk 輪詢後印貼紙）
  const labelData = JSON.stringify({
    orderNo,
    pickupCode,
    model: stringItem.model,
    tension,
    price: stringItem.price,
    slotNo,
  });
  await sql`INSERT INTO print_jobs (order_id, label_data) VALUES (${orderId}, ${labelData})`;
  // 註：交拍的「開格」由 kiosk 統一輪詢程式在「印完貼紙後」接著開格（見 kiosk-poller.mjs），
  //     這裡不再單獨排開格，避免與列印各自非同步造成順序錯亂。

  const order = rowToOrder(inserted[0], stringItem.model);

  // LINE 通知員工：新單
  await notifyStaffNewOrder(order);
  // 若已認證 LINE，寄件當下就推電子收據給客人
  await notifyCustomerOrder(order);

  return order;
}

// ── 列印佇列（kiosk 輪詢印貼紙）────────────────────────────────────────

function rowToPrintJob(row: any): PrintJobItem {
  let label: PrintJobItem['label'] = { orderNo: '', pickupCode: '', model: '', tension: 0, price: 0, slotNo: 0 };
  try {
    label = JSON.parse(row.label_data || '{}');
  } catch {
    /* ignore */
  }
  return {
    id: Number(row.id),
    orderId: Number(row.order_id),
    status: row.status,
    label,
    createdAt: toIso(row.created_at),
    doneAt: toIso(row.done_at),
  };
}

export async function listPrintJobs(status: 'pending' | 'done' = 'pending'): Promise<PrintJobItem[]> {
  await ensureStringingSchema();
  const sql = getDb();
  const rows = await sql`SELECT * FROM print_jobs WHERE status = ${status} ORDER BY id`;
  return rows.map(rowToPrintJob);
}

export async function markPrintJobDone(id: number): Promise<boolean> {
  await ensureStringingSchema();
  const sql = getDb();
  const result = await sql`
    UPDATE print_jobs SET status = 'done', done_at = NOW()
    WHERE id = ${id} AND status = 'pending'
    RETURNING id
  `;
  return result.length > 0;
}

// ── 開格佇列（kiosk 輪詢後送 RS-485 開鎖）──────────────────────────────

function rowToCellCommand(row: any): CellCommand {
  return {
    id: Number(row.id),
    slotNo: Number(row.slot_no),
    status: row.status,
    createdAt: toIso(row.created_at),
    doneAt: toIso(row.done_at),
  };
}

/** 排入「開第 N 格」指令（kiosk 輪詢後執行） */
export async function queueOpenCell(slotNo: number): Promise<void> {
  await ensureStringingSchema();
  const sql = getDb();
  await sql`INSERT INTO cell_commands (slot_no) VALUES (${slotNo})`;
}

export async function listCellCommands(status: 'pending' | 'done' = 'pending'): Promise<CellCommand[]> {
  await ensureStringingSchema();
  const sql = getDb();
  const rows = await sql`SELECT * FROM cell_commands WHERE status = ${status} ORDER BY id`;
  return rows.map(rowToCellCommand);
}

export async function markCellCommandDone(id: number): Promise<boolean> {
  await ensureStringingSchema();
  const sql = getDb();
  const result = await sql`
    UPDATE cell_commands SET status = 'done', done_at = NOW()
    WHERE id = ${id} AND status = 'pending'
    RETURNING id
  `;
  return result.length > 0;
}

// ── kiosk 認證 session（客人加 LINE 後傳認證碼 → 綁定身份）─────────────

export interface KioskSession {
  code: string;
  linked: boolean;
  lineUserId: string;
  lineName: string;
}

export async function createKioskSession(): Promise<string> {
  await ensureStringingSchema();
  const sql = getDb();
  let code = '';
  for (let i = 0; i < 100; i++) {
    code = String(Math.floor(1000 + Math.random() * 9000));
    const dup = await sql`SELECT 1 FROM kiosk_sessions WHERE code = ${code}`;
    if (dup.length === 0) break;
  }
  if (!code) throw new Error('認證碼產生失敗');
  await sql`INSERT INTO kiosk_sessions (code) VALUES (${code})`;
  return code;
}

export async function getKioskSession(code: string): Promise<KioskSession | null> {
  await ensureStringingSchema();
  const sql = getDb();
  const rows = await sql`SELECT * FROM kiosk_sessions WHERE code = ${code}`;
  if (rows.length === 0) return null;
  return {
    code: rows[0].code,
    linked: Boolean(rows[0].line_user_id),
    lineUserId: rows[0].line_user_id || '',
    lineName: rows[0].line_name || '',
  };
}

export async function linkKioskSession(code: string, lineUserId: string, lineName: string): Promise<boolean> {
  await ensureStringingSchema();
  const sql = getDb();
  const r = await sql`
    UPDATE kiosk_sessions SET line_user_id = ${lineUserId}, line_name = ${lineName}, linked_at = NOW()
    WHERE code = ${code} AND line_user_id = ''
    RETURNING id
  `;
  return r.length > 0;
}

/** 點「認證」→ 綁到最近 5 分鐘內、尚未綁定的 kiosk session（單機 kiosk 用） */
export async function linkMostRecentSession(lineUserId: string, lineName: string): Promise<boolean> {
  await ensureStringingSchema();
  const sql = getDb();
  const rows = await sql`
    SELECT code FROM kiosk_sessions
    WHERE line_user_id = '' AND created_at > NOW() - INTERVAL '5 minutes'
    ORDER BY id DESC LIMIT 1
  `;
  if (rows.length === 0) return false;
  const r = await sql`
    UPDATE kiosk_sessions SET line_user_id = ${lineUserId}, line_name = ${lineName}, linked_at = NOW()
    WHERE code = ${rows[0].code} AND line_user_id = ''
    RETURNING id
  `;
  return r.length > 0;
}

// ── 狀態流轉（員工後台）────────────────────────────────────────────────

export async function transitionOrder(id: number, action: string): Promise<OrderItem> {
  await ensureStringingSchema();
  const sql = getDb();

  const rows = await sql`SELECT * FROM orders WHERE id = ${id}`;
  if (rows.length === 0) throw new Error('訂單不存在');
  const order = rowToOrder(rows[0]);
  const status = order.status;

  if (action === 'take') {
    if (status !== 'pending') throw new Error('只有「待收件」訂單可以取件');
    // 開格取拍
    if (order.currentSlot != null) await queueOpenCell(order.currentSlot);
    await releaseSlot(order.currentSlot);
    await sql`UPDATE orders SET status = 'stringing', current_slot = NULL WHERE id = ${id}`;
  } else if (action === 'return') {
    if (status !== 'stringing') throw new Error('只有「穿線中」訂單可以送回');
    const slotNo = await occupyEmptySlot(id);
    // 開格放拍
    await queueOpenCell(slotNo);
    await sql`UPDATE orders SET status = 'ready', current_slot = ${slotNo} WHERE id = ${id}`;
  } else if (action === 'pay') {
    await sql`UPDATE orders SET paid = TRUE WHERE id = ${id}`;
  } else if (action === 'complete') {
    if (status !== 'ready') throw new Error('只有「待取件」訂單可以完成');
    if (!order.paid) throw new Error('尚未付款，請先標記已付款');
    await releaseSlot(order.currentSlot);
    await sql`
      UPDATE orders SET status = 'done', current_slot = NULL, completed_at = NOW()
      WHERE id = ${id}
    `;
  } else {
    throw new Error('未知操作');
  }

  const updated = await getOrderById(id);
  if (!updated) throw new Error('訂單不存在');

  // 送回後若已付款 → 發客人取件通知；標付款後若已待取件 → 也發
  if ((action === 'return' || action === 'pay') && updated.status === 'ready' && updated.paid) {
    await notifyCustomerPickup(updated);
  }

  return updated;
}

// ── 客人取件（kiosk 取件頁：掃碼／輸入取件碼 → 開格）──────────────────

export async function pickupOrder(code: string): Promise<OrderItem> {
  await ensureStringingSchema();

  const normalized = (code || '').trim();
  if (!/^\d{6}$/.test(normalized)) throw new Error('請輸入 6 位取件碼');

  const order = await getOrderByPickupCode(normalized);
  if (!order) throw new Error('查無此取件碼，請再確認');

  if (order.status === 'done') throw new Error('此訂單已完成取件');
  if (order.status !== 'ready') throw new Error('球拍尚未送回，請稍候再來');
  if (!order.paid) throw new Error('尚未付款，請先至櫃檯付款');
  if (order.currentSlot == null) throw new Error('訂單沒有分配格口，請洽櫃檯');

  // 開格（排入開格指令，kiosk 輪詢後送 RS-485 開鎖）
  // 註：不在此自動完成訂單；客人取件後由員工後台按「完成取件」釋放格口並標記完成
  //     （關門偵測 D2 門磁上線後，再評估自動完成，見交接文件待辦第 4 項）
  await queueOpenCell(order.currentSlot);

  return order;
}

/** 取消訂單：釋放格口並刪除訂單（print_jobs 由 CASCADE 刪除） */
export async function cancelOrder(id: number): Promise<boolean> {
  await ensureStringingSchema();
  const sql = getDb();
  const rows = await sql`SELECT id, current_slot FROM orders WHERE id = ${id}`;
  if (rows.length === 0) return false;
  if (rows[0].current_slot != null) {
    await sql`UPDATE locker_slots SET status = 'empty', order_id = NULL WHERE slot_no = ${Number(rows[0].current_slot)}`;
  }
  const del = await sql`DELETE FROM orders WHERE id = ${id} RETURNING id`;
  return del.length > 0;
}

/** 清空全部訂單＋開格指令＋格口（測試用，一鍵歸零） */
export async function clearAllOrders(): Promise<void> {
  await ensureStringingSchema();
  const sql = getDb();
  await sql`DELETE FROM orders`;
  await sql`DELETE FROM cell_commands`;
  await sql`UPDATE locker_slots SET status = 'empty', order_id = NULL`;
}

// ── 綁定客人 LINE（webhook 收到取件碼時）────────────────────────────────

/** 綁定「最近一筆未綁 LINE 的訂單」並推電子收據（掃 QR 加好友 / 點「綁定」用） */
export async function bindMostRecentUnboundOrder(
  lineUserId: string,
  lineName: string
): Promise<OrderItem | null> {
  await ensureStringingSchema();
  const sql = getDb();
  const rows = await sql`
    SELECT id FROM orders WHERE line_user_id = '' ORDER BY id DESC LIMIT 1
  `;
  if (rows.length === 0) return null;
  await sql`
    UPDATE orders SET line_user_id = ${lineUserId}, line_name = ${lineName}
    WHERE id = ${Number(rows[0].id)} AND line_user_id = ''
  `;
  const order = await getOrderById(Number(rows[0].id));
  if (order && order.lineUserId === lineUserId) {
    await notifyCustomerOrder(order);
  }
  return order;
}

export async function bindCustomer(
  pickupCode: string,
  lineUserId: string
): Promise<{ order: OrderItem | null; boundNow: boolean; alreadyBoundOther: boolean }> {
  await ensureStringingSchema();
  const sql = getDb();
  const order = await getOrderByPickupCode(pickupCode);
  if (!order) return { order: null, boundNow: false, alreadyBoundOther: false };

  if (order.lineUserId && order.lineUserId !== lineUserId) {
    return { order, boundNow: false, alreadyBoundOther: true };
  }
  if (!order.lineUserId) {
    await sql`UPDATE orders SET line_user_id = ${lineUserId} WHERE id = ${order.id}`;
    // 抓客人 LINE 別名（顯示名稱）存起來，方便後台辨識
    const profile = await getProfile(lineUserId);
    if (profile?.displayName) {
      await sql`UPDATE orders SET line_name = ${profile.displayName} WHERE id = ${order.id}`;
    }
    const updated = await getOrderById(order.id);
    return { order: updated, boundNow: true, alreadyBoundOther: false };
  }
  return { order, boundNow: false, alreadyBoundOther: false };
}

// ── LINE 通知 ───────────────────────────────────────────────────────────

function getStaffLineIds(): string[] {
  const raw = process.env.STAFF_LINE_USER_ID || process.env.STAFF_LINE_USER_IDS || '';
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function notifyStaffNewOrder(order: OrderItem): Promise<void> {
  const staffIds = getStaffLineIds();
  if (staffIds.length === 0) {
    console.warn('[Stringing] 未設定 STAFF_LINE_USER_ID，略過員工新單通知');
    return;
  }
  const text =
    `🧵 新穿線單！\n\n` +
    `單號：${order.orderNo}\n` +
    `線種：${order.stringModel}（${order.tension} lbs）\n` +
    `費用：NT$${order.price}\n` +
    `取件碼：${order.pickupCode}\n` +
    `格號：第 ${order.currentSlot} 格\n` +
    `${order.customerName ? `客人：${order.customerName}\n` : ''}` +
    `請取件後開始穿線。`;
  for (const id of staffIds) {
    await pushMessage(id, [{ type: 'text', text }]);
  }
}

/** 寄件當下推電子收據給客人（若已認證 LINE） */
async function notifyCustomerOrder(order: OrderItem): Promise<void> {
  if (!order.lineUserId) return;
  const text =
    `🧾 羽拍有約 · 電子收據\n` +
    `━━━━━━━━━━━━\n` +
    `單號：${order.orderNo}\n` +
    `線種：${order.stringModel}（${order.tension} lbs）\n` +
    `費用：NT$${order.price}\n` +
    `取件碼：${order.pickupCode}\n` +
    `格號：第 ${order.currentSlot} 格\n` +
    `━━━━━━━━━━━━\n` +
    `已收到您的球拍，穿好付款後將通知取件。`;
  await pushMessage(order.lineUserId, [{ type: 'text', text }]);
}

async function notifyCustomerPickup(order: OrderItem): Promise<void> {
  if (!order.lineUserId) {
    console.warn(`[Stringing] 訂單 ${order.orderNo} 未綁定客人 LINE，略過取件通知`);
    return;
  }
  const text =
    `🏸 您的球拍穿好囉！\n\n` +
    `單號：${order.orderNo}\n` +
    `線種：${order.stringModel}（${order.tension} lbs）\n` +
    `取件碼：${order.pickupCode}\n` +
    `格號：第 ${order.currentSlot ?? '-'} 格\n\n` +
    `請至羽拍有約（太平永成店）輸入取件碼取件。`;
  await pushMessage(order.lineUserId, [{ type: 'text', text }]);
}
