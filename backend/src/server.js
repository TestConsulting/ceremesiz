require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });
const { createApp } = require('./app');

const PORT = Number(process.env.PORT) || 4000;
const HOST = process.env.HOST || '127.0.0.1';

createApp().listen(PORT, HOST, () => {
  console.log(`Ceremesiz Backend läuft auf http://${HOST}:${PORT}`);
});
