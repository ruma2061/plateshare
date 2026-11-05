const pgp = require('pg-promise')();
const { createApp } = require('./app');

const db = pgp({
  host: process.env.POSTGRES_HOST || 'db',
  port: Number(process.env.POSTGRES_PORT || 5432),
  database: process.env.POSTGRES_DB,
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
});

db.connect().then(connection => {
  console.log('Database connection successful');
  connection.done();
}).catch(error => console.error('Database connection failed:', error.message));

const port = Number(process.env.PORT || 3000);
createApp(db).listen(port, () => console.log(`Server is listening on port ${port}`));
