import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashPassword } from './auth.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const dbPath = resolve(here, '../data/hamlog.sqlite');

export function openDatabase(path = dbPath) {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db);
  return db;
}

export function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      callsign TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      nickname TEXT NOT NULL DEFAULT '',
      avatar_url TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      bio TEXT NOT NULL DEFAULT '',
      signature TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL CHECK (role IN ('admin', 'operator')),
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active'
    );

    CREATE TABLE IF NOT EXISTS antennas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      type TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS contacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      contacted_at TEXT NOT NULL,
      callsign TEXT NOT NULL,
      frequency_mhz REAL NOT NULL,
      band TEXT NOT NULL,
      mode TEXT NOT NULL,
      device_id INTEGER NOT NULL REFERENCES devices(id),
      antenna_id INTEGER NOT NULL REFERENCES antennas(id),
      location TEXT NOT NULL,
      country TEXT NOT NULL,
      power_w INTEGER NOT NULL,
      power_text TEXT NOT NULL DEFAULT '',
      signal_report TEXT NOT NULL,
      note TEXT NOT NULL,
      operator_callsign TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS carousel_slides (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL DEFAULT '',
      subtitle TEXT NOT NULL DEFAULT '',
      image_url TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  addColumnIfMissing(db, 'contacts', 'power_text', "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(db, 'contacts', 'operator_callsign', "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(db, 'users', 'nickname', "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(db, 'users', 'avatar_url', "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(db, 'users', 'email', "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(db, 'users', 'bio', "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(db, 'users', 'signature', "TEXT NOT NULL DEFAULT ''");
}

function addColumnIfMissing(db, table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((item) => item.name);
  if (!columns.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

export function seedDatabase(db) {
  const existing = db.prepare('SELECT COUNT(*) AS count FROM users').get();
  if (existing.count > 0) return;

  const insertUser = db.prepare(`
    INSERT INTO users (callsign, display_name, role, password_hash)
    VALUES (?, ?, ?, ?)
  `);
  const admin = insertUser.run('BA1ABC', '基地台管理员', 'admin', hashPassword('admin123')).lastInsertRowid;
  const operator = insertUser.run('BG5QSL', '五区操作员', 'operator', hashPassword('operator123')).lastInsertRowid;

  const insertDevice = db.prepare('INSERT INTO devices (user_id, name, type, status) VALUES (?, ?, ?, ?)');
  const insertAntenna = db.prepare('INSERT INTO antennas (user_id, name, type) VALUES (?, ?, ?)');

  const deviceIds = {
    [admin]: [
      insertDevice.run(admin, 'IC-705', '便携电台', 'active').lastInsertRowid,
      insertDevice.run(admin, 'FT-891', '短波电台', 'active').lastInsertRowid,
      insertDevice.run(admin, 'Xiegu G90', '短波电台', 'active').lastInsertRowid
    ],
    [operator]: [
      insertDevice.run(operator, 'UV-K5', '手台', 'active').lastInsertRowid,
      insertDevice.run(operator, 'FT-891', '短波电台', 'active').lastInsertRowid
    ]
  };

  const antennaIds = {
    [admin]: [
      insertAntenna.run(admin, 'GP天线', '垂直天线').lastInsertRowid,
      insertAntenna.run(admin, '八木天线', '定向天线').lastInsertRowid,
      insertAntenna.run(admin, '长线天线', '端馈天线').lastInsertRowid
    ],
    [operator]: [
      insertAntenna.run(operator, '手台原装天线', '橡胶天线').lastInsertRowid,
      insertAntenna.run(operator, '偶极天线', '水平天线').lastInsertRowid
    ]
  };

  const callsigns = ['JA1XYZ', 'VK3DEF', 'BH4HAM', 'BD7ABC', 'BA4RF', 'UA0AAA', 'DL1ABC', 'ZS6QW', '9M2ABC', 'K2DX', 'HL3CQ', 'W6TEST'];
  const locations = [
    ['Tokyo', 'Japan'],
    ['Melbourne', 'Australia'],
    ['Nanjing', 'China'],
    ['Guangzhou', 'China'],
    ['Khabarovsk', 'Russia'],
    ['Munich', 'Germany'],
    ['Pretoria', 'South Africa'],
    ['Kuala Lumpur', 'Malaysia'],
    ['Seattle', 'United States'],
    ['Seoul', 'South Korea']
  ];
  const bands = [
    ['20m', 14.27],
    ['40m', 7.032],
    ['2m', 145.5],
    ['15m', 21.074],
    ['17m', 18.086],
    ['70cm', 433.5]
  ];
  const modes = ['SSB', 'CW', 'FM', 'FT8'];
  const notes = ['远距离通联稳定', 'CW信号清晰', '本地中继', '数字模式', '语音质量好', '高频传播良好', '欧洲方向通联', 'FT8自动通联', '信号平稳', '短距离测试'];
  const insertContact = db.prepare(`
    INSERT INTO contacts (
      user_id, contacted_at, callsign, frequency_mhz, band, mode, device_id, antenna_id,
      location, country, power_w, power_text, signal_report, note, operator_callsign
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const baseDate = new Date('2026-04-28T15:30:45.000Z');
  for (const userId of [admin, operator]) {
    for (let i = 0; i < 360; i += 1) {
      const date = new Date(baseDate);
      date.setUTCDate(date.getUTCDate() - i);
      date.setUTCHours((8 + i * 3) % 24, (i * 11) % 60, 0, 0);
      const [band, frequency] = bands[(i + userId) % bands.length];
      const [location, country] = locations[(i * 2 + userId) % locations.length];
      const mode = modes[(i + Math.floor(i / 5)) % modes.length];
      insertContact.run(
        userId,
        date.toISOString(),
        callsigns[(i + userId) % callsigns.length],
        frequency,
        band,
        mode,
        deviceIds[userId][i % deviceIds[userId].length],
        antennaIds[userId][(i + 1) % antennaIds[userId].length],
        location,
        country,
        [5, 10, 20, 50, 100][i % 5],
        `${[5, 10, 20, 50, 100][i % 5]}W`,
        mode === 'FT8' ? `${-13 + (i % 10)}/${-10 + (i % 7)}` : `${55 + (i % 5)}/${57 + (i % 3)}`,
        notes[i % notes.length],
        userId === admin ? 'BA1ABC' : 'BG5QSL'
      );
    }
  }
}

export function resetAndSeed(path = dbPath) {
  const db = openDatabase(path);
  db.exec('DELETE FROM contacts; DELETE FROM antennas; DELETE FROM devices; DELETE FROM users;');
  seedDatabase(db);
  return db;
}
