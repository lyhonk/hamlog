export function publicUser(user) {
  return {
    id: user.id,
    callsign: user.callsign,
    displayName: user.display_name,
    nickname: user.nickname ?? '',
    avatarUrl: user.avatar_url ?? '',
    email: user.email ?? '',
    bio: user.bio ?? '',
    signature: user.signature ?? '',
    role: user.role
  };
}

export function visibilityWhere(user, alias = 'contacts') {
  return user.role === 'admin' ? { clause: '1 = 1', params: [] } : { clause: `${alias}.user_id = ?`, params: [user.id] };
}

export function getUserById(db, id) {
  return db.prepare('SELECT id, callsign, display_name, nickname, avatar_url, email, bio, signature, role FROM users WHERE id = ?').get(id);
}

export function getContactById(db, id, user) {
  const visibility = visibilityWhere(user, 'contacts');
  return db.prepare(`
    SELECT contacts.id, contacts.contacted_at AS contactedAt, contacts.callsign, contacts.frequency_mhz AS frequencyMhz,
      contacts.band, contacts.mode, contacts.device_id AS deviceId, devices.name AS device,
      contacts.antenna_id AS antennaId, antennas.name AS antenna, contacts.location,
      contacts.country, contacts.power_w AS powerW, contacts.power_text AS powerText,
      contacts.signal_report AS signalReport, contacts.note, contacts.operator_callsign AS operatorCallsign,
      users.callsign AS ownerCallsign
    FROM contacts
    JOIN devices ON devices.id = contacts.device_id
    JOIN antennas ON antennas.id = contacts.antenna_id
    JOIN users ON users.id = contacts.user_id
    WHERE contacts.id = ? AND ${visibility.clause}
  `).get(id, ...visibility.params);
}

export function listContacts(db, user, filters = {}) {
  const page = Math.max(Number(filters.page ?? 1), 1);
  const pageSize = Math.min(Math.max(Number(filters.pageSize ?? 30), 5), 150);
  const where = [visibilityWhere(user, 'contacts')];

  if (filters.callsign) {
    where.push({ clause: 'contacts.callsign LIKE ?', params: [`%${filters.callsign}%`] });
  }
  if (filters.contactDate) {
    where.push({ clause: "date(contacts.contacted_at, '+8 hours') = date(?)", params: [dateOnly(filters.contactDate)] });
  }
  if (!filters.contactDate && filters.startDate) {
    where.push({ clause: 'date(contacts.contacted_at) >= date(?)', params: [filters.startDate] });
  }
  if (!filters.contactDate && filters.endDate) {
    where.push({ clause: 'date(contacts.contacted_at) <= date(?)', params: [filters.endDate] });
  }
  if (filters.deviceId) {
    where.push({ clause: 'contacts.device_id = ?', params: [Number(filters.deviceId)] });
  }
  if (filters.antennaId) {
    where.push({ clause: 'contacts.antenna_id = ?', params: [Number(filters.antennaId)] });
  }

  const clause = where.map((item) => item.clause).join(' AND ');
  const params = where.flatMap((item) => item.params);
  const total = db.prepare(`SELECT COUNT(*) AS count FROM contacts WHERE ${clause}`).get(...params).count;
  const rows = db.prepare(`
    SELECT contacts.id, contacts.contacted_at AS contactedAt, contacts.callsign, contacts.frequency_mhz AS frequencyMhz,
      contacts.band, contacts.mode, contacts.device_id AS deviceId, devices.name AS device,
      contacts.antenna_id AS antennaId, antennas.name AS antenna, contacts.location,
      contacts.country, contacts.power_w AS powerW, contacts.power_text AS powerText,
      contacts.signal_report AS signalReport, contacts.note, contacts.operator_callsign AS operatorCallsign,
      users.callsign AS ownerCallsign
    FROM contacts
    JOIN devices ON devices.id = contacts.device_id
    JOIN antennas ON antennas.id = contacts.antenna_id
    JOIN users ON users.id = contacts.user_id
    WHERE ${clause}
    ORDER BY contacts.contacted_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, pageSize, (page - 1) * pageSize);

  return { rows, total, page, pageSize, pages: Math.max(Math.ceil(total / pageSize), 1) };
}

export function updateContact(db, user, id, payload) {
  const current = getContactById(db, id, user);
  if (!current) return null;
  const deviceId = Number(payload.deviceId ?? current.deviceId);
  const antennaId = Number(payload.antennaId ?? current.antennaId);
  assertOwnedLookup(db, user, 'devices', deviceId);
  assertOwnedLookup(db, user, 'antennas', antennaId);

  const frequencyMhz = Number(payload.frequencyMhz ?? current.frequencyMhz);
  const powerW = parsePower(payload.powerText ?? payload.powerW ?? current.powerText ?? current.powerW);
  const powerText = String(payload.powerText ?? current.powerText ?? `${powerW}W`).trim();
  db.prepare(`
    UPDATE contacts
    SET contacted_at = ?, callsign = ?, frequency_mhz = ?, band = ?, mode = ?, device_id = ?,
      antenna_id = ?, location = ?, country = ?, power_w = ?, power_text = ?, signal_report = ?,
      note = ?, operator_callsign = ?
    WHERE id = ?
  `).run(
    parseDisplayDate(payload.contactedAt ?? current.contactedAt),
    String(payload.callsign ?? current.callsign).trim().toUpperCase(),
    frequencyMhz,
    String(payload.band ?? inferBand(frequencyMhz)).trim() || inferBand(frequencyMhz),
    String(payload.mode ?? current.mode).trim().toUpperCase(),
    deviceId,
    antennaId,
    String(payload.location ?? current.location).trim(),
    String(payload.country ?? current.country).trim() || 'China',
    powerW,
    powerText,
    String(payload.signalReport ?? current.signalReport).trim(),
    String(payload.note ?? current.note ?? '').trim(),
    String(payload.operatorCallsign ?? current.operatorCallsign ?? '').trim().toUpperCase(),
    id
  );
  return getContactById(db, id, user);
}

export function deleteContacts(db, user, ids) {
  const normalizedIds = [...new Set(ids.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))];
  if (normalizedIds.length === 0) return { deleted: 0 };
  const visibility = visibilityWhere(user, 'contacts');
  const placeholders = normalizedIds.map(() => '?').join(',');
  const result = db.prepare(`
    DELETE FROM contacts
    WHERE id IN (${placeholders}) AND ${visibility.clause}
  `).run(...normalizedIds, ...visibility.params);
  return { deleted: result.changes };
}

export function listDevices(db, user) {
  const where = user.role === 'admin' ? { clause: '1 = 1', params: [] } : { clause: 'devices.user_id = ?', params: [user.id] };
  return db.prepare(`
    SELECT devices.id, devices.name, devices.type, devices.status, users.callsign AS ownerCallsign
    FROM devices
    JOIN users ON users.id = devices.user_id
    WHERE ${where.clause}
    ORDER BY devices.name
  `).all(...where.params);
}

export function listAntennas(db, user) {
  const where = user.role === 'admin' ? { clause: '1 = 1', params: [] } : { clause: 'antennas.user_id = ?', params: [user.id] };
  return db.prepare(`
    SELECT antennas.id, antennas.name, antennas.type, users.callsign AS ownerCallsign
    FROM antennas
    JOIN users ON users.id = antennas.user_id
    WHERE ${where.clause}
    ORDER BY antennas.name
  `).all(...where.params);
}

export function listUsers(db) {
  return db.prepare(`
    SELECT id, callsign, display_name AS displayName, nickname, avatar_url AS avatarUrl,
      email, bio, signature, role, created_at AS createdAt
    FROM users
    ORDER BY id
  `).all();
}

export function createUser(db, input, passwordHash) {
  const callsign = String(input.callsign ?? '').trim().toUpperCase();
  const displayName = String(input.displayName ?? '').trim();
  const role = normalizeRole(input.role);
  if (!callsign) throw new Error('呼号不能为空');
  if (!displayName) throw new Error('显示名称不能为空');
  const result = db.prepare(`
    INSERT INTO users (callsign, display_name, role, password_hash)
    VALUES (?, ?, ?, ?)
  `).run(callsign, displayName, role, passwordHash);
  return listUsers(db).find((item) => item.id === result.lastInsertRowid);
}

export function updateUserRole(db, currentUser, id, role) {
  const targetId = Number(id);
  const nextRole = normalizeRole(role);
  const target = db.prepare('SELECT id, role FROM users WHERE id = ?').get(targetId);
  if (!target) return null;
  if (target.id === currentUser.id && nextRole !== 'admin') {
    throw new Error('不能取消自己的管理员权限');
  }
  if (target.role === 'admin' && nextRole !== 'admin') {
    const adminCount = db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'").get().count;
    if (adminCount <= 1) throw new Error('至少需要保留一名管理员');
  }
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(nextRole, targetId);
  return listUsers(db).find((item) => item.id === targetId);
}

export function deleteUser(db, currentUser, id) {
  const targetId = Number(id);
  if (targetId === currentUser.id) throw new Error('不能删除当前登录用户');
  const target = db.prepare('SELECT id, role FROM users WHERE id = ?').get(targetId);
  if (!target) return { deleted: 0 };
  if (target.role === 'admin') {
    const adminCount = db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'").get().count;
    if (adminCount <= 1) throw new Error('至少需要保留一名管理员');
  }
  const result = db.prepare('DELETE FROM users WHERE id = ?').run(targetId);
  return { deleted: result.changes };
}

function normalizeRole(role) {
  const value = String(role ?? 'operator').trim();
  if (!['admin', 'operator'].includes(value)) throw new Error('用户角色不正确');
  return value;
}

function updateLegacyProfile(db, user, profile) {
  const displayName = String(profile.displayName ?? '').trim();
  if (!displayName) throw new Error('姓名不能为空');
  db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(displayName, user.id);
  return getUserById(db, user.id);
}

export function updateProfile(db, user, profile) {
  const nickname = String(profile.nickname ?? profile.displayName ?? '').trim();
  const displayName = String(profile.displayName ?? nickname).trim();
  const avatarUrl = String(profile.avatarUrl ?? '').trim();
  const email = String(profile.email ?? '').trim();
  const bio = String(profile.bio ?? '').trim();
  const signature = String(profile.signature ?? '').trim();
  if (!nickname && !displayName) throw new Error('Nickname cannot be empty');
  db.prepare(`
    UPDATE users
    SET display_name = ?, nickname = ?, avatar_url = ?, email = ?, bio = ?, signature = ?
    WHERE id = ?
  `).run(displayName || nickname, nickname || displayName, avatarUrl, email, bio, signature, user.id);
  return getUserById(db, user.id);
}

export function listCarouselSlides(db) {
  return db.prepare(`
    SELECT id, title, subtitle, image_url AS imageUrl, sort_order AS sortOrder, created_at AS createdAt
    FROM carousel_slides
    ORDER BY sort_order, id
  `).all();
}

export function createCarouselSlide(db, input) {
  const title = String(input.title ?? '').trim();
  const subtitle = String(input.subtitle ?? '').trim();
  const imageUrl = String(input.imageUrl ?? '').trim();
  const sortOrder = Number(input.sortOrder ?? 0);
  if (!imageUrl) throw new Error('Carousel image is required');
  const result = db.prepare(`
    INSERT INTO carousel_slides (title, subtitle, image_url, sort_order)
    VALUES (?, ?, ?, ?)
  `).run(title, subtitle, imageUrl, Number.isFinite(sortOrder) ? sortOrder : 0);
  return listCarouselSlides(db).find((item) => item.id === result.lastInsertRowid);
}

export function updateCarouselSlide(db, id, input) {
  const targetId = Number(id);
  const current = db.prepare('SELECT * FROM carousel_slides WHERE id = ?').get(targetId);
  if (!current) return null;
  const title = String(input.title ?? current.title).trim();
  const subtitle = String(input.subtitle ?? current.subtitle).trim();
  const imageUrl = String(input.imageUrl ?? current.image_url).trim();
  const sortOrder = Number(input.sortOrder ?? current.sort_order);
  if (!imageUrl) throw new Error('Carousel image is required');
  db.prepare(`
    UPDATE carousel_slides
    SET title = ?, subtitle = ?, image_url = ?, sort_order = ?
    WHERE id = ?
  `).run(title, subtitle, imageUrl, Number.isFinite(sortOrder) ? sortOrder : current.sort_order, targetId);
  return listCarouselSlides(db).find((item) => item.id === targetId);
}

export function deleteCarouselSlide(db, id) {
  const result = db.prepare('DELETE FROM carousel_slides WHERE id = ?').run(Number(id));
  return { deleted: result.changes };
}

export function insertUploadedContacts(db, user, records) {
  const insert = db.prepare(`
    INSERT INTO contacts (
      user_id, contacted_at, callsign, frequency_mhz, band, mode, device_id, antenna_id,
      location, country, power_w, power_text, signal_report, note, operator_callsign
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let imported = 0;
  db.exec('BEGIN');
  try {
    for (const item of records) {
      const normalized = normalizeUploadedContact(item);
      if (!normalized) continue;
      const deviceId = ensureDevice(db, user.id, normalized.deviceName);
      const antennaId = ensureAntenna(db, user.id, normalized.antennaName);
      insert.run(
        user.id,
        parseDisplayDate(normalized.contactedAt),
        normalized.callsign,
        normalized.frequencyMhz,
        normalized.band,
        normalized.mode,
        deviceId,
        antennaId,
        normalized.location,
        normalized.country,
        normalized.powerW,
        normalized.powerText,
        normalized.signalReport,
        normalized.note,
        normalized.operatorCallsign
      );
      imported += 1;
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return { imported, skipped: records.length - imported };
}

export function dashboardSummary(db, user) {
  const visibility = visibilityWhere(user, 'contacts');
  const total = db.prepare(`SELECT COUNT(*) AS count FROM contacts WHERE ${visibility.clause}`).get(...visibility.params).count;
  const monthCount = db.prepare(`
    SELECT COUNT(*) AS count FROM contacts
    WHERE ${visibility.clause} AND strftime('%Y-%m', contacted_at, '+8 hours') = strftime('%Y-%m', 'now', '+8 hours')
  `).get(...visibility.params).count;
  const activeOperators = user.role === 'admin'
    ? db.prepare("SELECT COUNT(DISTINCT COALESCE(NULLIF(operator_callsign, ''), users.callsign)) AS count FROM contacts JOIN users ON users.id = contacts.user_id").get().count
    : db.prepare(`SELECT COUNT(DISTINCT COALESCE(NULLIF(operator_callsign, ''), users.callsign)) AS count FROM contacts JOIN users ON users.id = contacts.user_id WHERE ${visibility.clause}`).get(...visibility.params).count;
  const deviceCount = db.prepare(user.role === 'admin'
    ? 'SELECT COUNT(*) AS count FROM devices'
    : 'SELECT COUNT(*) AS count FROM devices WHERE user_id = ?'
  ).get(...(user.role === 'admin' ? [] : [user.id])).count;

  const lastYearRows = db.prepare(`
    SELECT strftime('%Y-%m', contacted_at, '+8 hours') AS month, COUNT(*) AS count
    FROM contacts
    WHERE ${visibility.clause} AND date(contacted_at, '+8 hours') >= date('now', '+8 hours', '-11 months', 'start of month')
    GROUP BY month
    ORDER BY month
  `).all(...visibility.params);

  const bands = db.prepare(`
    SELECT band AS name, COUNT(*) AS value FROM contacts
    WHERE ${visibility.clause}
    GROUP BY band ORDER BY value DESC
  `).all(...visibility.params);

  const modes = db.prepare(`
    SELECT mode AS name, COUNT(*) AS value FROM contacts
    WHERE ${visibility.clause}
    GROUP BY mode ORDER BY value DESC
  `).all(...visibility.params);

  const countries = db.prepare(`
    SELECT country AS name, COUNT(*) AS value FROM contacts
    WHERE ${visibility.clause}
    GROUP BY country ORDER BY value DESC LIMIT 8
  `).all(...visibility.params);

  const callsignRank = rank(db, visibility, 'contacts.callsign');
  const operatorRank = operatorContributionRank(db, visibility);
  const deviceRank = rank(db, visibility, 'devices.name', 'JOIN devices ON devices.id = contacts.device_id');

  const daily = db.prepare(`
    SELECT strftime('%w', contacted_at, '+8 hours') AS weekDay, strftime('%m', contacted_at, '+8 hours') AS month, COUNT(*) AS count
    FROM contacts
    WHERE ${visibility.clause} AND date(contacted_at, '+8 hours') >= date('now', '+8 hours', '-12 months')
    GROUP BY weekDay, month
  `).all(...visibility.params);
  const reportStats = annualReportStats(db, visibility);

  return {
    cards: {
      totalContacts: total,
      monthContacts: monthCount,
      activeOperators,
      deviceCount
    },
    trends: {
      monthly: fillLastTwelveMonths(lastYearRows)
    },
    distributions: { bands, modes },
    ranks: { callsigns: callsignRank, operators: operatorRank, devices: deviceRank },
    countries,
    activityCalendar: daily,
    report: buildReport(reportStats)
  };
}

function rank(db, visibility, field, joins = '') {
  return db.prepare(`
    SELECT ${field} AS name, COUNT(*) AS value
    FROM contacts
    ${joins}
    WHERE ${visibility.clause}
    GROUP BY ${field}
    ORDER BY value DESC
    LIMIT 5
  `).all(...visibility.params);
}

function operatorContributionRank(db, visibility) {
  return db.prepare(`
    SELECT name, COUNT(*) AS value
    FROM (
      SELECT COALESCE(NULLIF(contacts.operator_callsign, ''), users.callsign) AS name,
        date(contacts.contacted_at, '+8 hours') AS activeDate
      FROM contacts
      JOIN users ON users.id = contacts.user_id
      WHERE ${visibility.clause}
      GROUP BY name, activeDate
    )
    GROUP BY name
    ORDER BY value DESC
    LIMIT 5
  `).all(...visibility.params);
}

function dateOnly(value) {
  const match = String(value ?? '').match(/\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : String(value ?? '').slice(0, 10);
}

function annualReportStats(db, visibility) {
  const where = `${visibility.clause} AND date(contacts.contacted_at, '+8 hours') >= date('now', '+8 hours', '-12 months')`;
  const params = visibility.params;
  const totals = db.prepare(`
    SELECT
      COUNT(*) AS total,
      COUNT(DISTINCT date(contacts.contacted_at, '+8 hours')) AS activeDays,
      COUNT(DISTINCT contacts.country) AS countryCount
    FROM contacts
    WHERE ${where}
  `).get(...params);
  const monthRows = db.prepare(`
    SELECT strftime('%Y-%m', contacts.contacted_at, '+8 hours') AS month, COUNT(*) AS count
    FROM contacts
    WHERE ${where}
    GROUP BY month
    ORDER BY count DESC, month DESC
  `).all(...params);
  const topBand = topValue(db, visibility, 'contacts.band');
  const topMode = topValue(db, visibility, 'contacts.mode');
  return {
    total: totals.total,
    activeDays: totals.activeDays,
    countryCount: totals.countryCount,
    averagePerDay: totals.total ? (totals.total / 365).toFixed(1) : '0',
    topBand: topBand?.name ?? '-',
    topMode: topMode?.name ?? '-',
    peakMonth: monthRows[0]?.month ?? '-',
    peakMonthCount: monthRows[0]?.count ?? 0
  };
}

function topValue(db, visibility, field) {
  return db.prepare(`
    SELECT ${field} AS name, COUNT(*) AS value
    FROM contacts
    WHERE ${visibility.clause} AND date(contacts.contacted_at, '+8 hours') >= date('now', '+8 hours', '-12 months')
    GROUP BY ${field}
    ORDER BY value DESC, name ASC
    LIMIT 1
  `).get(...visibility.params);
}

function assertOwnedLookup(db, user, table, id) {
  const where = user.role === 'admin' ? 'id = ?' : 'id = ? AND user_id = ?';
  const params = user.role === 'admin' ? [id] : [id, user.id];
  const existing = db.prepare(`SELECT id FROM ${table} WHERE ${where}`).get(...params);
  if (!existing) throw new Error('设备或天线不存在，或当前账号无权使用');
}

function fillLastTwelveMonths(rows) {
  const map = new Map(rows.map((row) => [row.month, row.count]));
  const now = new Date();
  const values = [];
  for (let i = 11; i >= 0; i -= 1) {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const key = date.toISOString().slice(0, 7);
    values.push({ month: `${date.getUTCMonth() + 1}月`, count: map.get(key) ?? 0 });
  }
  return values;
}

function buildReport({ total, activeDays, countryCount, averagePerDay, topBand, topMode, peakMonth, peakMonthCount }) {
  return {
    text: `过去一年累计通联 ${total.toLocaleString('zh-CN')} 次，活跃通联 ${activeDays.toLocaleString('zh-CN')} 天，最常用频段为 ${topBand}，最常用模式为 ${topMode}，峰值月份为 ${peakMonth}（${peakMonthCount.toLocaleString('zh-CN')} 次），已覆盖 ${countryCount.toLocaleString('zh-CN')} 个国家/地区。`,
    metrics: [
      { label: '通联天数', value: activeDays, unit: '天' },
      { label: '国家/地区', value: countryCount, unit: '' },
      { label: '日均通联', value: averagePerDay, unit: '次' }
    ]
  };
}

export function normalizeUploadedContact(item) {
  const callsign = String(item.callsign ?? item.call ?? '').trim().toUpperCase();
  if (!callsign) return null;
  const rawDate = item.contactedAt ?? item.date ?? item.qsoDate ?? item.qso_date ?? new Date().toISOString();
  const contactedAt = normalizeDate(rawDate, item.time ?? item.timeOn ?? item.time_on);
  const frequencyMhz = Number(item.frequencyMhz ?? item.frequency ?? item.freq ?? 14.27);
  if (!Number.isFinite(frequencyMhz) || frequencyMhz <= 0) return null;

  return {
    contactedAt,
    callsign,
    frequencyMhz,
    band: String(item.band ?? inferBand(frequencyMhz)).trim() || inferBand(frequencyMhz),
    mode: String(item.mode ?? 'SSB').trim().toUpperCase(),
    deviceName: String(item.device ?? item.deviceName ?? item.radio ?? '模板导入设备').trim() || '模板导入设备',
    antennaName: String(item.antenna ?? item.antennaName ?? '模板导入天线').trim() || '模板导入天线',
    location: String(item.location ?? item.qth ?? 'Tengzhou').trim() || 'Tengzhou',
    country: String(item.country ?? 'China').trim() || 'China',
    powerW: parsePower(item.powerW ?? item.power ?? item.txPwr ?? item.tx_pwr ?? 10),
    powerText: String(item.powerText ?? item.power ?? item.txPwr ?? item.tx_pwr ?? '').trim(),
    signalReport: String(item.signalReport ?? item.rst ?? item.rstSent ?? item.rst_sent ?? '59/59').trim() || '59/59',
    note: String(item.note ?? item.comment ?? '').trim(),
    operatorCallsign: String(item.operatorCallsign ?? item.operator ?? item.controlOperator ?? item.ownerCallsign ?? '').trim().toUpperCase()
  };
}

function ensureDevice(db, userId, name) {
  const existing = db.prepare('SELECT id FROM devices WHERE user_id = ? AND name = ?').get(userId, name);
  if (existing) return existing.id;
  return db.prepare('INSERT INTO devices (user_id, name, type, status) VALUES (?, ?, ?, ?)').run(userId, name, '日志导入设备', 'active').lastInsertRowid;
}

function ensureAntenna(db, userId, name) {
  const existing = db.prepare('SELECT id FROM antennas WHERE user_id = ? AND name = ?').get(userId, name);
  if (existing) return existing.id;
  return db.prepare('INSERT INTO antennas (user_id, name, type) VALUES (?, ?, ?)').run(userId, name, '日志导入天线').lastInsertRowid;
}

function parsePower(value) {
  const match = String(value ?? '').match(/\d+(?:\.\d+)?/);
  return match ? Math.round(Number(match[0])) : 0;
}

function normalizeDate(value, timeValue) {
  const text = String(value ?? '').trim();
  if (/^\d{8}$/.test(text)) {
    const time = String(timeValue ?? '000000').replace(/\D/g, '').padEnd(6, '0').slice(0, 6);
    return new Date(`${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}T${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4, 6)}+08:00`).toISOString();
  }
  const localDateTime = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T]+(\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (localDateTime) {
    return new Date(`${localDateTime[1]}-${localDateTime[2]}-${localDateTime[3]}T${localDateTime[4] ?? '00'}:${localDateTime[5] ?? '00'}:${localDateTime[6] ?? '00'}+08:00`).toISOString();
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function parseDisplayDate(value) {
  const text = String(value ?? '').trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (match) {
    return new Date(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6] ?? '00'}+08:00`).toISOString();
  }
  return normalizeDate(text);
}

function inferBand(frequencyMhz) {
  if (frequencyMhz >= 430) return '70cm';
  if (frequencyMhz >= 144) return '2m';
  if (frequencyMhz >= 50) return '6m';
  if (frequencyMhz >= 28) return '10m';
  if (frequencyMhz >= 21) return '15m';
  if (frequencyMhz >= 18) return '17m';
  if (frequencyMhz >= 14) return '20m';
  if (frequencyMhz >= 7) return '40m';
  return '80m';
}
