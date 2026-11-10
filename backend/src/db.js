const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const { Pool } = require('pg');

// En la nube (Railway) llega una sola variable DATABASE_URL; en local se usan las variables POSTGRES_* del .env.
// PGSSL=1 activa TLS (solo hace falta si se usa la dirección pública de la base).
const ssl = process.env.PGSSL === '1' ? { rejectUnauthorized: false } : undefined;
const pool = new Pool(process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL, ssl }
  : {
    host: process.env.POSTGRES_HOST || 'localhost',
    port: Number(process.env.POSTGRES_PORT || 5432),
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB,
    ssl,
  });

module.exports = pool;
