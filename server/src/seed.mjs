import { openDatabase, resetAndSeed, dbPath } from './db.mjs';

const db = resetAndSeed(dbPath);
const users = db.prepare('SELECT callsign, role FROM users ORDER BY id').all();
db.close();

console.log(`Seeded ${dbPath}`);
console.table(users);
