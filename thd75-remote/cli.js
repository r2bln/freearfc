'use strict';
/** Live probe for the TH-D75: connect, handshake, read-only state sync.
 *  Nothing is transmitted that changes radio configuration. */
process.env.NODE_NO_WARNINGS = '1';
const { SerialPort } = require('serialport');
const { THD75Connection } = require('./src/protocol/connection');

const PATH = process.argv[2] || '/dev/ttyACM0';

const log = (d, f) => console.log((d === 'tx' ? '» ' : '« ') + JSON.stringify(f));

async function main() {
  const port = new SerialPort({
    path: PATH, baudRate: 115200, dataBits: 8, parity: 'none',
    stopBits: 1, rtscts: false, dtr: true, rts: true, autoOpen: false,
  });
  await new Promise((res, rej) => port.open((e) => (e ? rej(e) : res())));
  console.log(`opened ${PATH}`);

  const conn = new THD75Connection({
    write: (s) => port.write(Buffer.from(s, 'latin1'), () => {}),
    on: (ev, cb) => port.on(ev, cb),
  });
  conn.on('log', log);
  conn.on('warning', (m) => console.log('! ' + m));

  const t = (ms) => new Promise((r) => setTimeout(r, ms));

  console.log('--- enter control mode ---');
  await conn.enterControlMode();
  await t(400);

  console.log('--- identity ---');
  for (const [cmd, params] of [['ID', ''], ['TY', ''], ['FV', ''], ['PS', ''], ['GW', '']]) {
    try {
      const p = await conn.request(cmd, params, { timeout: 1500 });
      console.log(`${cmd} -> ${JSON.stringify(p)}`);
    } catch (e) {
      console.log(`${cmd} -> ERROR ${e.message}`);
    }
    await t(80);
  }

  console.log('--- read-only state (bands) ---');
  for (const cmd of ['FQ 0', 'FQ 1', 'MD 0', 'MD 1', 'VM 0', 'VM 1', 'SF 0', 'SF 1',
                     'RA 0', 'RA 1', 'AG', 'FS', 'FT', 'IO', 'TN', 'GP', 'DL', 'BC', 'BY 0', 'BY 1', 'SM 0', 'SM 1']) {
    const [c, ...rest] = cmd.split(' ');
    try {
      const p = await conn.request(c, rest.length ? ' ' + rest.join(' ') : '', { timeout: 1200 });
      console.log(`${cmd.padEnd(5)} -> ${JSON.stringify(p)}`);
    } catch (e) {
      console.log(`${cmd.padEnd(5)} -> ERROR ${e.message}`);
    }
    await t(60);
  }

  console.log('--- final mirrored state ---');
  console.log(JSON.stringify(conn.state, null, 2));

  console.log('--- listening for async AI frames for 3 s ---');
  await t(3000);

  port.close();
  process.exit(0);
}

main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
