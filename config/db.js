require('dotenv').config();


const { Pool } = require('pg');
// const pool = new Pool({
//     user: 'postgres',
//     host: 'localhost',
//     database: 'postgres',
//     password:'1111',
//     port: 5432,
// });
const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
  });
module.exports = pool;

// DB_USER=
// DB_HOST=
// DB_NAME=
// DB_PASSWORD="1111"
// DB_PORT=5432 