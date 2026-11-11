const pgp = require('pg-promise')();
const { createApp } = require('./app');

const db = pgp({
  host: process.env.POSTGRES_HOST || 'db',
  port: Number(process.env.POSTGRES_PORT || 5432),
  database: process.env.POSTGRES_DB,
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
});

async function start() {
  const connection = await db.connect();
  connection.done();
  const port = Number(process.env.PORT || 3000);
  createApp(db).listen(port, () => console.log(`Server is listening on port ${port}`));
}

start().catch(error => {
  console.error('Server startup failed:', error.message);
  pgp.end();
  process.exitCode = 1;
});
