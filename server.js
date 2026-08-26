'use strict';

require('dotenv').config();
const app = require('./app');

// PORT=0 is treated as unset (some environments export it; 0 means "random port" to Node).
const PORT = process.env.PORT && process.env.PORT !== '0' ? Number(process.env.PORT) : 3000;

app.listen(PORT, () => {
  console.log(`Evidence map running at http://localhost:${PORT}`);
});
