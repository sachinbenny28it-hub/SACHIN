// Runs schema.sql against the configured MySQL server.
// Usage: npm run db:init
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

async function main() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  const database = process.env.DB_NAME || 'sachin';
  if (!/^[A-Za-z0-9_]+$/.test(database)) throw new Error('DB_NAME may contain only letters, numbers, and underscores.');

  const admin = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    multipleStatements: true
  });

  await admin.query(`CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await admin.end();

  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database,
    multipleStatements: true
  });

  console.log(`Connected to ${database}. Applying schema...`);
  await connection.query(schema);
  await ensureColumn(connection, database, 'preferences', 'memory_enabled', 'BOOLEAN NOT NULL DEFAULT FALSE');
  await ensureColumn(connection, database, 'memories', 'approved', 'BOOLEAN NOT NULL DEFAULT TRUE');
  await connection.query(
    `ALTER TABLE memories MODIFY COLUMN category ENUM('goal','learning','project','preference','plan','instruction','context','behaviour') NOT NULL`
  );
  await runMemoryConsentMigration(connection, database);
  console.log('SACHIN database is ready.');
  await connection.end();
}

async function runMemoryConsentMigration(connection, database) {
  const migrationId = '2026-09-memory-approval';
  const [[existing]] = await connection.query('SELECT migration_id FROM schema_migrations WHERE migration_id = ?', [migrationId]);
  if (existing) return;

  await connection.beginTransaction();
  try {
    await connection.query("UPDATE memories SET approved = FALSE WHERE source = 'sachin_suggested'");
    const [[table]] = await connection.query(
      'SELECT COUNT(*) AS found FROM information_schema.tables WHERE table_schema = ? AND table_name = ?',
      [database, 'behaviour_patterns']
    );
    if (table.found) {
      await connection.query(
        `INSERT INTO memories (id, user_id, category, content, source, approved, pinned)
         SELECT UUID(), user_id, 'behaviour', LEFT(CONCAT('SACHIN noticed: ', REPLACE(pattern_key, '_', ' ')), 500), 'sachin_suggested', FALSE, FALSE
         FROM behaviour_patterns`
      );
      await connection.query('DELETE FROM behaviour_patterns');
    }
    await connection.query('INSERT INTO schema_migrations (migration_id) VALUES (?)', [migrationId]);
    await connection.commit();
  } catch (err) {
    await connection.rollback();
    throw err;
  }
}

async function ensureColumn(connection, database, table, column, definition) {
  const [rows] = await connection.query(
    `SELECT COUNT(*) AS found FROM information_schema.columns WHERE table_schema = ? AND table_name = ? AND column_name = ?`,
    [database, table, column]
  );
  if (!rows[0].found) await connection.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
}

main().catch((err) => {
  console.error('Failed to initialize database:', err.message);
  process.exit(1);
});
