'use strict';

// Local development and tests retain SQLite. Railway production uses its
// managed PostgreSQL service when DATABASE_URL is supplied.
module.exports = process.env.DATABASE_URL ? require('./postgres-db') : require('./db');
