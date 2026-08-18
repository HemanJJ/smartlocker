// 模擬電控板（mock RS-485 bridge）+ 22 格視覺看板
// 用法：node simulator/mock-485.mjs    （預設埠 4321）
//   - 看板：http://localhost:4321/
//   - 送幀：POST /rs485  {"hex":"55A101E2010117"}
//   - 狀態：GET  /state
//   - 手動：POST /open {"no":3}  / POST /close {"no":3}
//
// 協議：UPUS-SKB（锁控板 V3.1）RS-485，9600-N-8-1
// 幀結構：55 A1 <地址> <功能碼> <長度> <資料...> <XOR校驗>

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4321);
const CELL_COUNT = 22;

// 每格狀態：door: 'closed'(門關/接通) | 'open'(門開/斷開)；power: 'off'(鎖住) | 'on'(解鎖)
const cells = Array.from({ length: CELL_COUNT + 1 }, (_, i) => ({
  no: i,
  door: 'closed',
  power: 'off',
}));

function xorChecksum(bytes) {
  return bytes.reduce((a, b) => a ^ b, 0) & 0xff;
}
function toHex(bytes) {
  return bytes.map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join('');
}
function fromHex(hex) {
  const clean = String(hex || '').replace(/[\s:]/g, '');
  if (clean.length % 2 !== 0) return null;
  return clean.match(/../g).map((h) => parseInt(h, 16));
}

function parseFrame(hex) {
  const bytes = fromHex(hex);
  if (!bytes || bytes.length < 6) return { error: '幀太短' };
  const [head, type, addr, func, len, ...rest] = bytes;
  if (head !== 0x55 || type !== 0xa1) return { error: '命令頭/類型碼錯誤' };
  if (bytes.length !== 6 + len) return { error: '長度不符' };
  const data = rest.slice(0, len);
  const chk = rest[len];
  if (xorChecksum(bytes.slice(0, 5 + len)) !== chk) return { error: '校驗錯誤' };
  return { addr, func, data };
}

function buildResponse(addr, func, data) {
  const bytes = [0x55, 0xa1, addr, func, data.length, ...data];
  bytes.push(xorChecksum(bytes));
  return toHex(bytes);
}

function handleFrame(hex) {
  const p = parseFrame(hex);
  if (p.error) return { error: p.error };
  const { addr, func, data } = p;

  switch (func) {
    case 0xdf: // 廣播尋址
      return { hex: buildResponse(0xff, 0xdf, [0x01]) };

    case 0xdd: // 讀 MCU ID
      return { hex: buildResponse(addr, 0xdd, [0xf7, 0x84, 0xc9, 0x1c, 0x01, 0xeb, 0x07]) };

    case 0xd1: { // 讀通道通電狀態
      const ch = data[0];
      if (ch === 0) return { hex: buildResponse(addr, 0xd1, [0, 0, 0, 0, 0]) };
      const st = cells[ch] && cells[ch].power === 'on' ? 1 : 0;
      return { hex: buildResponse(addr, 0xd1, [ch, st]) };
    }

    case 0xe1: { // 寫通道通電狀態
      const [ch, st] = data;
      if (ch >= 1 && ch <= CELL_COUNT) cells[ch].power = st === 1 ? 'on' : 'off';
      return { hex: buildResponse(addr, 0xe1, [ch, st]) };
    }

    case 0xd2: { // 讀通道門磁信號狀態（0=門關接通，1=門開斷開）
      const ch = data[0];
      if (ch === 0) return { hex: buildResponse(addr, 0xd2, [0, 0, 0, 0, 0]) };
      const st = cells[ch] && cells[ch].door === 'open' ? 1 : 0;
      return { hex: buildResponse(addr, 0xd2, [ch, st]) };
    }

    case 0xe2: { // 開鎖
      const ch = data[0];
      if (ch === 0) {
        for (let i = 1; i <= CELL_COUNT; i++) { cells[i].power = 'on'; cells[i].door = 'open'; }
        return { hex: buildResponse(addr, 0xe2, [0, 0]) };
      }
      if (ch >= 1 && ch <= CELL_COUNT) {
        cells[ch].power = 'on';
        cells[ch].door = 'open';
      }
      return { hex: buildResponse(addr, 0xe2, [ch, 1]) };
    }

    default:
      return { error: '不支援的功能碼 0x' + func.toString(16).toUpperCase() };
  }
}

function readBody(req) {
  return new Promise((resolve) => {
    let s = '';
    req.on('data', (c) => (s += c));
    req.on('end', () => resolve(s));
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const send = (code, obj, ctype = 'application/json') => {
    res.writeHead(code, { 'Content-Type': ctype });
    res.end(ctype === 'application/json' ? JSON.stringify(obj) : obj);
  };

  if (url.pathname === '/' && req.method === 'GET') {
    const html = fs.readFileSync(path.join(__dirname, 'board.html'), 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  if (url.pathname === '/state' && req.method === 'GET') {
    send(200, { cellCount: CELL_COUNT, cells: cells.slice(1) });
    return;
  }

  if (url.pathname === '/rs485' && req.method === 'POST') {
    const body = JSON.parse((await readBody(req)) || '{}');
    const result = handleFrame(body.hex);
    console.log(`[485] RX ${body.hex}  →  ${result.error ? 'ERR ' + result.error : 'TX ' + result.hex}`);
    send(result.error ? 400 : 200, result);
    return;
  }

  if (url.pathname === '/reset' && req.method === 'POST') {
    for (let i = 1; i <= CELL_COUNT; i++) { cells[i].door = 'closed'; cells[i].power = 'off'; }
    console.log('[模擬板] 已重置（22 格全關門）');
    send(200, { ok: true, reset: CELL_COUNT });
    return;
  }

  if ((url.pathname === '/open' || url.pathname === '/close') && req.method === 'POST') {
    const body = JSON.parse((await readBody(req)) || '{}');
    const no = Number(body.no);
    if (no >= 1 && no <= CELL_COUNT) {
      if (url.pathname === '/open') { cells[no].power = 'on'; cells[no].door = 'open'; }
      else { cells[no].door = 'closed'; cells[no].power = 'off'; }
      send(200, { ok: true, cell: cells[no] });
    } else {
      send(400, { ok: false, error: '格號超出範圍' });
    }
    return;
  }

  send(404, { error: 'not found' });
});

server.listen(PORT, () => {
  console.log(`[模擬電控板] 已啟動：http://localhost:${PORT}/  （${CELL_COUNT} 格）`);
  console.log(`  送幀範例：curl -X POST localhost:${PORT}/rs485 -d '{"hex":"55A101E2010117"}'`);
});
