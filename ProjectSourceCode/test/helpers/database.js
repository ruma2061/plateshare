const { PGlite } = require('@electric-sql/pglite');
const { readdir, readFile } = require('node:fs/promises');
const path = require('node:path');
const pgp = require('pg-promise')();

async function applySchema(engine) {
  const directory = path.join(__dirname, '../../src/init_data');
  for (const file of (await readdir(directory)).filter(name => name.endsWith('.sql')).sort()) {
    await engine.exec(await readFile(path.join(directory, file), 'utf8'));
  }
}

async function createDatabase({ baseOnly = false } = {}) {
  const engine = await PGlite.create();
  if (baseOnly) {
    await engine.exec(await readFile(path.join(__dirname, '../../src/init_data/create.sql'), 'utf8'));
  } else {
    await applySchema(engine);
  }
  // Use pg-promise's production parameter formatter with a real PostgreSQL engine.
  function adapter(connection) {
    const query = async (sql, values) => (await connection.query(pgp.as.format(sql, values))).rows;
    return {
      engine,
      any: query,
      async one(sql, values) {
        const rows = await query(sql, values);
        if (rows.length !== 1) throw new Error(`Expected one row, received ${rows.length}`);
        return rows[0];
      },
      async oneOrNone(sql, values) {
        const rows = await query(sql, values);
        if (rows.length > 1) throw new Error('Expected at most one row');
        return rows[0] || null;
      },
      async none(sql, values) { await query(sql, values); },
      async tx(callback) { return connection.transaction(transaction => callback(adapter(transaction))); },
    };
  }
  return adapter(engine);
}

module.exports = { createDatabase, applySchema };
