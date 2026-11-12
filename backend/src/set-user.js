// Legt einen Benutzer an oder setzt sein Passwort neu.
//   npm run user:set -- <email> <Vorname> <Nachname>
// Das Passwort wird abgefragt (oder per Umgebungsvariable USER_PASSWORD übergeben),
// damit es nicht in der Shell-Historie landet.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });
const readline = require('readline');
const { upsertUser } = require('./users');

function askHidden(question) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = s => { if (s.includes(question)) rl.output.write(s); };
    rl.question(question, answer => { rl.close(); process.stdout.write('\n'); resolve(answer); });
  });
}

function readStdin() {
  return new Promise(resolve => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', c => { data += c; });
    process.stdin.on('end', () => resolve(data.replace(/\r?\n$/, '')));
  });
}

(async () => {
  const [email, firstName, lastName] = process.argv.slice(2);
  if (!email || !firstName || !lastName) {
    console.error('Aufruf: npm run user:set -- <email> <Vorname> <Nachname>');
    process.exit(1);
  }
  let password = process.env.USER_PASSWORD;
  if (!password) password = process.stdin.isTTY ? await askHidden('Passwort: ') : await readStdin();

  try {
    const { created, user } = await upsertUser({ email, firstName, lastName, password });
    console.log(`${created ? 'Angelegt' : 'Aktualisiert'}: ${user.email} (${user.first_name} ${user.last_name})`);
  } catch (err) {
    console.error('Fehler:', err.message);
    process.exit(1);
  }
})();
