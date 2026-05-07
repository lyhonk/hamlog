import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import xlsx from 'xlsx';
import { openDatabase, seedDatabase } from './db.mjs';
import { createToken, hashPassword, verifyPassword, verifyToken } from './auth.mjs';
import { createCarouselSlide, createUser, dashboardSummary, deleteCarouselSlide, deleteContacts, deleteUser, getContactById, getUserById, insertUploadedContacts, listAntennas, listCarouselSlides, listContacts, listDevices, listUsers, normalizeUploadedContact, publicUser, updateCarouselSlide, updateContact, updateProfile, updateUserRole } from './queries.mjs';

const port = Number(process.env.PORT ?? 4174);
const db = openDatabase();
seedDatabase(db);
const here = dirname(fileURLToPath(import.meta.url));
const uploadRoot = resolve(here, '../uploads');
const staticRoot = resolve(here, '../../client/dist');
mkdirSync(uploadRoot, { recursive: true });
const publicViewer = { id: 0, callsign: 'PUBLIC', display_name: '公共访客', role: 'admin' };

const server = http.createServer(async (req, res) => {
  try {
    await route(req, res);
  } catch (error) {
    console.error(error);
    json(res, 500, { error: '服务器内部错误' });
  }
});

server.listen(port, () => {
  console.log(`Hamlog API listening on http://localhost:${port}`);
});

async function route(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'GET' && url.pathname.startsWith('/uploads/')) {
    serveUpload(url.pathname, res);
    return;
  }

  if (req.method === 'GET' && !url.pathname.startsWith('/api/')) {
    serveStatic(url.pathname, res);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/login') {
    const body = await readJson(req);
    const user = db.prepare('SELECT * FROM users WHERE callsign = ?').get(String(body.callsign ?? '').toUpperCase());
    if (!user || !verifyPassword(String(body.password ?? ''), user.password_hash)) {
      json(res, 401, { error: '呼号或密码不正确' });
      return;
    }
    json(res, 200, { token: createToken(user), user: publicUser(user) });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/dashboard/summary') {
    json(res, 200, dashboardSummary(db, authenticate(req) ?? publicViewer));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/contacts') {
    json(res, 200, listContacts(db, authenticate(req) ?? publicViewer, Object.fromEntries(url.searchParams)));
    return;
  }

  const publicContactMatch = url.pathname.match(/^\/api\/contacts\/(\d+)$/);
  if (req.method === 'GET' && publicContactMatch) {
    const contact = getContactById(db, Number(publicContactMatch[1]), authenticate(req) ?? publicViewer);
    if (!contact) {
      json(res, 404, { error: '未找到通联记录' });
      return;
    }
    json(res, 200, { contact });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/devices') {
    json(res, 200, { devices: listDevices(db, authenticate(req) ?? publicViewer) });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/antennas') {
    json(res, 200, { antennas: listAntennas(db, authenticate(req) ?? publicViewer) });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/carousel-slides') {
    json(res, 200, { slides: listCarouselSlides(db) });
    return;
  }

  const currentUser = authenticate(req);
  if (!currentUser) {
    json(res, 401, { error: '请先登录' });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/me') {
    json(res, 200, { user: publicUser(currentUser) });
    return;
  }

  if (req.method === 'PATCH' && url.pathname === '/api/me') {
    const body = await readJson(req);
    const updated = updateProfile(db, currentUser, body);
    json(res, 200, { user: publicUser(updated) });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/me/password') {
    const body = await readJson(req);
    const userWithPassword = db.prepare('SELECT * FROM users WHERE id = ?').get(currentUser.id);
    if (!verifyPassword(String(body.currentPassword ?? ''), userWithPassword.password_hash)) {
      json(res, 400, { error: '当前密码不正确' });
      return;
    }
    const nextPassword = String(body.newPassword ?? '');
    if (nextPassword.length < 6) {
      json(res, 400, { error: '新密码至少需要 6 位' });
      return;
    }
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(nextPassword), currentUser.id);
    json(res, 200, { ok: true });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/uploads/image') {
    const body = await readJson(req);
    const scope = String(body.scope ?? 'avatar') === 'carousel' ? 'carousel' : 'avatars';
    if (scope === 'carousel' && currentUser.role !== 'admin') {
      json(res, 403, { error: 'Only admins can upload carousel images' });
      return;
    }
    json(res, 201, saveImageUpload(body.dataUrl, scope, scope === 'avatars' ? 2 * 1024 * 1024 : 6 * 1024 * 1024));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/dashboard/summary') {
    json(res, 200, dashboardSummary(db, currentUser));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/contacts') {
    json(res, 200, listContacts(db, currentUser, Object.fromEntries(url.searchParams)));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/contacts/import') {
    const body = await readJson(req);
    const content = String(body.content ?? '');
    const format = String(body.format ?? 'csv');
    const records = format === 'records' ? JSON.parse(content) : format === 'xlsx' ? parseXlsx(content) : format === 'adif' ? parseAdif(content) : parseCsv(content);
    if (records.length === 0) {
      json(res, 400, { error: '没有解析到可导入的日志记录' });
      return;
    }
    json(res, 200, insertUploadedContacts(db, currentUser, records));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/contacts/preview') {
    const body = await readJson(req);
    const records = parseXlsx(String(body.content ?? ''));
    const rows = records.map((record) => normalizeUploadedContact(record)).filter(Boolean).map((row) => ({
      ...row,
      contactedAt: formatPreviewDate(row.contactedAt)
    }));
    if (rows.length === 0) {
      json(res, 400, { error: '没有解析到可预览的日志记录' });
      return;
    }
    json(res, 200, { rows, total: rows.length });
    return;
  }

  const contactMatch = url.pathname.match(/^\/api\/contacts\/(\d+)$/);
  if (req.method === 'GET' && contactMatch) {
    const contact = getContactById(db, Number(contactMatch[1]), currentUser);
    if (!contact) {
      json(res, 404, { error: '未找到通联记录' });
      return;
    }
    json(res, 200, { contact });
    return;
  }

  if (req.method === 'PATCH' && contactMatch) {
    const body = await readJson(req);
    const contact = updateContact(db, currentUser, Number(contactMatch[1]), body);
    if (!contact) {
      json(res, 404, { error: '未找到通联记录，或当前账号无权修改' });
      return;
    }
    json(res, 200, { contact });
    return;
  }

  if (req.method === 'DELETE' && contactMatch) {
    json(res, 200, deleteContacts(db, currentUser, [Number(contactMatch[1])]));
    return;
  }

  if (req.method === 'DELETE' && url.pathname === '/api/contacts') {
    const body = await readJson(req);
    json(res, 200, deleteContacts(db, currentUser, Array.isArray(body.ids) ? body.ids : []));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/devices') {
    json(res, 200, { devices: listDevices(db, currentUser) });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/antennas') {
    json(res, 200, { antennas: listAntennas(db, currentUser) });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/users') {
    if (currentUser.role !== 'admin') {
      json(res, 403, { error: '仅管理员可查看用户列表' });
      return;
    }
    json(res, 200, { users: listUsers(db) });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/carousel-slides') {
    if (currentUser.role !== 'admin') {
      json(res, 403, { error: 'Only admins can manage carousel slides' });
      return;
    }
    json(res, 201, { slide: createCarouselSlide(db, await readJson(req)) });
    return;
  }

  const carouselMatch = url.pathname.match(/^\/api\/carousel-slides\/(\d+)$/);
  if (req.method === 'PATCH' && carouselMatch) {
    if (currentUser.role !== 'admin') {
      json(res, 403, { error: 'Only admins can manage carousel slides' });
      return;
    }
    const slide = updateCarouselSlide(db, Number(carouselMatch[1]), await readJson(req));
    if (!slide) {
      json(res, 404, { error: 'Carousel slide not found' });
      return;
    }
    json(res, 200, { slide });
    return;
  }

  if (req.method === 'DELETE' && carouselMatch) {
    if (currentUser.role !== 'admin') {
      json(res, 403, { error: 'Only admins can manage carousel slides' });
      return;
    }
    json(res, 200, deleteCarouselSlide(db, Number(carouselMatch[1])));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/users') {
    if (currentUser.role !== 'admin') {
      json(res, 403, { error: '仅管理员可新增用户' });
      return;
    }
    const body = await readJson(req);
    const password = String(body.password ?? '');
    if (password.length < 6) {
      json(res, 400, { error: '初始密码至少需要 6 位' });
      return;
    }
    json(res, 201, { user: createUser(db, body, hashPassword(password)) });
    return;
  }

  const userMatch = url.pathname.match(/^\/api\/users\/(\d+)$/);
  if (req.method === 'PATCH' && userMatch) {
    if (currentUser.role !== 'admin') {
      json(res, 403, { error: '仅管理员可修改用户权限' });
      return;
    }
    const body = await readJson(req);
    const updated = updateUserRole(db, currentUser, Number(userMatch[1]), body.role);
    if (!updated) {
      json(res, 404, { error: '未找到用户' });
      return;
    }
    json(res, 200, { user: updated });
    return;
  }

  if (req.method === 'DELETE' && userMatch) {
    if (currentUser.role !== 'admin') {
      json(res, 403, { error: '仅管理员可删除用户' });
      return;
    }
    json(res, 200, deleteUser(db, currentUser, Number(userMatch[1])));
    return;
  }

  json(res, 404, { error: '接口不存在' });
}

function authenticate(req) {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const payload = verifyToken(token);
  if (!payload) return null;
  return getUserById(db, payload.sub);
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
}

function saveImageUpload(dataUrl, scope, maxBytes) {
  const match = String(dataUrl ?? '').match(/^data:(image\/(?:png|jpe?g|webp));base64,([a-z0-9+/=]+)$/i);
  if (!match) throw new Error('Unsupported image format');
  const [, mimeType, base64] = match;
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.length > maxBytes) throw new Error(`Image size cannot exceed ${Math.round(maxBytes / 1024 / 1024)}MB`);
  const extension = mimeType === 'image/png' ? '.png' : mimeType === 'image/webp' ? '.webp' : '.jpg';
  const directory = join(uploadRoot, scope);
  mkdirSync(directory, { recursive: true });
  const fileName = `${Date.now()}-${randomUUID()}${extension}`;
  writeFileSync(join(directory, fileName), bytes);
  return { url: `/uploads/${scope}/${fileName}`, size: bytes.length };
}

function serveUpload(pathname, res) {
  const relative = normalize(decodeURIComponent(pathname.replace(/^\/uploads\//, '')));
  const filePath = resolve(uploadRoot, relative);
  if (!filePath.startsWith(uploadRoot) || !existsSync(filePath)) {
    json(res, 404, { error: 'File not found' });
    return;
  }
  const ext = extname(filePath).toLowerCase();
  const contentTypes = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp'
  };
  res.writeHead(200, {
    'Content-Type': contentTypes[ext] ?? 'application/octet-stream',
    'Cache-Control': 'public, max-age=31536000, immutable'
  });
  createReadStream(filePath).pipe(res);
}

function serveStatic(pathname, res) {
  if (!existsSync(staticRoot)) {
    json(res, 404, { error: 'Static client build not found' });
    return;
  }

  const relative = normalize(decodeURIComponent(pathname.replace(/^\/+/, '')));
  const requestedPath = resolve(staticRoot, relative || 'index.html');
  const filePath = requestedPath.startsWith(staticRoot) && existsSync(requestedPath) && statSync(requestedPath).isFile()
    ? requestedPath
    : resolve(staticRoot, 'index.html');

  if (!filePath.startsWith(staticRoot) || !existsSync(filePath)) {
    json(res, 404, { error: 'Static file not found' });
    return;
  }

  const ext = extname(filePath).toLowerCase();
  const contentTypes = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2'
  };
  const assetsRoot = resolve(staticRoot, 'assets');
  const isHashedAsset = filePath.startsWith(`${assetsRoot}\\`) || filePath.startsWith(`${assetsRoot}/`);
  res.writeHead(200, {
    'Content-Type': contentTypes[ext] ?? 'application/octet-stream',
    'Cache-Control': isHashedAsset ? 'public, max-age=31536000, immutable' : 'no-cache'
  });
  createReadStream(filePath).pipe(res);
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function json(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function parseCsv(content) {
  const lines = content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]).map((header) => normalizeKey(header));
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? '']));
  });
}

function splitCsvLine(line) {
  const cells = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && line[index + 1] === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      cells.push(cell.trim());
      cell = '';
    } else {
      cell += char;
    }
  }
  cells.push(cell.trim());
  return cells;
}

function parseAdif(content) {
  return content
    .split(/<eor>/i)
    .map((entry) => {
      const record = {};
      for (const match of entry.matchAll(/<([a-z0-9_]+):(\d+)(?::[^>]*)?>([^<]*)/gi)) {
        const [, rawKey, rawLength, rest] = match;
        record[normalizeKey(rawKey)] = rest.slice(0, Number(rawLength)).trim();
      }
      return record;
    })
    .filter((record) => Object.keys(record).length > 0);
}

function normalizeKey(key) {
  const compact = String(key).trim().replace(/[\s-]+/g, '_').toLowerCase();
  const cnAliases = {
    日期: 'qsoDate',
    通联时间: 'timeOn',
    呼号: 'callsign',
    频率: 'frequency',
    模式: 'mode',
    使用设备: 'device',
    天线: 'antenna',
    位置: 'location',
    功率: 'power',
    信号: 'rst',
    备注: 'note',
    值机主控: 'operatorCallsign'
  };
  if (cnAliases[key]) return cnAliases[key];
  const aliases = {
    call: 'callsign',
    qso_date: 'qsoDate',
    time_on: 'timeOn',
    freq: 'frequency',
    rst_sent: 'rstSent',
    tx_pwr: 'txPwr',
    comment: 'note'
  };
  return aliases[compact] ?? compact.replace(/_([a-z])/g, (_, char) => char.toUpperCase());
}

function parseXlsx(base64Content) {
  const workbook = xlsx.read(Buffer.from(base64Content, 'base64'), { type: 'buffer', cellDates: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json(sheet, { defval: '', raw: false });
  return rows.map((row) => Object.fromEntries(
    Object.entries(row).map(([key, value]) => [normalizeKey(key), value])
  ));
}

function formatPreviewDate(value) {
  const date = new Date(value);
  const pad = (number) => String(number).padStart(2, '0');
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}`;
}
