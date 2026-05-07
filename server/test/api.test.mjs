import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createToken, hashPassword } from '../src/auth.mjs';
import { createUser, dashboardSummary, deleteContacts, deleteUser, getContactById, listContacts, listUsers, updateContact, updateUserRole } from '../src/queries.mjs';
import { resetAndSeed } from '../src/db.mjs';

function freshDb() {
  return resetAndSeed(join(mkdtempSync(join(tmpdir(), 'hamlog-')), 'test.sqlite'));
}

test('operator only sees own contacts', () => {
  const db = freshDb();
  const operator = db.prepare("SELECT id, callsign, display_name, role FROM users WHERE role = 'operator'").get();
  const admin = db.prepare("SELECT id, callsign, display_name, role FROM users WHERE role = 'admin'").get();

  const operatorRows = listContacts(db, operator, { pageSize: 50 });
  const adminRows = listContacts(db, admin, { pageSize: 150 });

  assert.equal(operatorRows.total, 360);
  assert.equal(adminRows.total, 720);
  assert.equal(listContacts(db, admin).rows.length, 30);
  assert.equal(adminRows.rows.length, 150);
  assert.ok(operatorRows.rows.every((row) => row.ownerCallsign === operator.callsign));
  db.close();
});

test('filters contacts by callsign and device', () => {
  const db = freshDb();
  const admin = db.prepare("SELECT id, callsign, display_name, role FROM users WHERE role = 'admin'").get();
  const device = db.prepare('SELECT id, name FROM devices ORDER BY id LIMIT 1').get();

  const byCallsign = listContacts(db, admin, { callsign: 'JA1XYZ' });
  const byDevice = listContacts(db, admin, { deviceId: device.id });

  assert.ok(byCallsign.total > 0);
  assert.ok(byCallsign.rows.every((row) => row.callsign.includes('JA1XYZ')));
  assert.ok(byDevice.total > 0);
  assert.ok(byDevice.rows.every((row) => row.device === device.name));
  db.close();
});

test('filters contacts by UTC+8 calendar day without matching time', () => {
  const db = freshDb();
  const admin = db.prepare("SELECT id, callsign, display_name, role FROM users WHERE role = 'admin'").get();
  const day = db.prepare(`
    SELECT strftime('%Y-%m-%d', contacted_at, '+8 hours') AS day
    FROM contacts
    ORDER BY contacted_at DESC
    LIMIT 1
  `).get().day;

  const result = listContacts(db, admin, { contactDate: `${day} 12:34:56`, pageSize: 50 });

  assert.ok(result.total > 0);
  assert.ok(result.rows.every((row) => {
    const localDay = new Date(row.contactedAt).toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
    return localDay === day;
  }));
  db.close();
});

test('updates and deletes contacts within user visibility', () => {
  const db = freshDb();
  const operator = db.prepare("SELECT id, callsign, display_name, role FROM users WHERE role = 'operator'").get();
  const adminContact = db.prepare("SELECT id FROM contacts WHERE user_id != ? LIMIT 1").get(operator.id);
  const ownContact = listContacts(db, operator, { pageSize: 1 }).rows[0];
  const device = db.prepare('SELECT id FROM devices WHERE user_id = ? LIMIT 1').get(operator.id);
  const antenna = db.prepare('SELECT id FROM antennas WHERE user_id = ? LIMIT 1').get(operator.id);

  const updated = updateContact(db, operator, ownContact.id, {
    contactedAt: '2026-05-03 20:30',
    callsign: 'BG4TEST',
    frequencyMhz: 438.5,
    mode: 'FM',
    deviceId: device.id,
    antennaId: antenna.id,
    location: 'Tengzhou',
    country: 'China',
    powerText: '5W',
    signalReport: '59',
    note: 'edited'
  });

  assert.equal(updated.callsign, 'BG4TEST');
  assert.equal(new Date(updated.contactedAt).toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).slice(0, 16), '2026-05-03 20:30');
  assert.equal(updateContact(db, operator, adminContact.id, { callsign: 'NOPE' }), null);
  assert.equal(deleteContacts(db, operator, [adminContact.id]).deleted, 0);
  assert.equal(deleteContacts(db, operator, [ownContact.id]).deleted, 1);
  assert.equal(getContactById(db, ownContact.id, operator), undefined);
  db.close();
});

test('dashboard summary is aggregated from seed data', () => {
  const db = freshDb();
  const admin = db.prepare("SELECT id, callsign, display_name, role FROM users WHERE role = 'admin'").get();
  const summary = dashboardSummary(db, admin);
  const topOperator = db.prepare(`
    SELECT name, COUNT(*) AS value
    FROM (
      SELECT COALESCE(NULLIF(contacts.operator_callsign, ''), users.callsign) AS name,
        date(contacts.contacted_at, '+8 hours') AS activeDate
      FROM contacts
      JOIN users ON users.id = contacts.user_id
      GROUP BY name, activeDate
    )
    GROUP BY name
    ORDER BY value DESC
    LIMIT 1
  `).get();
  const activeDays = db.prepare(`
    SELECT COUNT(DISTINCT date(contacted_at, '+8 hours')) AS count
    FROM contacts
    WHERE date(contacted_at, '+8 hours') >= date('now', '+8 hours', '-12 months')
  `).get().count;

  assert.equal(summary.cards.totalContacts, 720);
  assert.equal(summary.cards.activeOperators, 2);
  assert.deepEqual(summary.ranks.operators[0], topOperator);
  assert.equal(summary.report.metrics.find((item) => item.label === '通联天数').value, activeDays);
  assert.ok(summary.distributions.bands.length > 0);
  assert.equal(summary.trends.monthly.length, 12);
  db.close();
});

test('admin user listing and token creation work', () => {
  const db = freshDb();
  const admin = db.prepare("SELECT id, callsign, display_name, role FROM users WHERE role = 'admin'").get();

  assert.equal(listUsers(db).length, 2);
  assert.match(createToken(admin), /^[^.]+\.[^.]+$/);
  db.close();
});

test('admin can create, delete and change user roles', () => {
  const db = freshDb();
  const admin = db.prepare("SELECT id, callsign, display_name, role FROM users WHERE role = 'admin'").get();

  const created = createUser(db, {
    callsign: 'BH4NEW',
    displayName: 'New Operator',
    role: 'operator'
  }, hashPassword('newpass123'));
  assert.equal(created.callsign, 'BH4NEW');
  assert.equal(created.role, 'operator');

  const promoted = updateUserRole(db, admin, created.id, 'admin');
  assert.equal(promoted.role, 'admin');

  const demoted = updateUserRole(db, admin, created.id, 'operator');
  assert.equal(demoted.role, 'operator');
  assert.equal(deleteUser(db, admin, created.id).deleted, 1);
  assert.equal(listUsers(db).some((item) => item.id === created.id), false);
  db.close();
});

test('user management keeps at least one admin and protects current admin', () => {
  const db = freshDb();
  const admin = db.prepare("SELECT id, callsign, display_name, role FROM users WHERE role = 'admin'").get();

  assert.throws(() => updateUserRole(db, admin, admin.id, 'operator'), /管理员/);
  assert.throws(() => deleteUser(db, admin, admin.id), /当前登录用户/);
  db.close();
});
