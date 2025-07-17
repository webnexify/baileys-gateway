const {
  default: makeWASocket,
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
} = require('@whiskeysockets/baileys');

const { Boom } = require('@hapi/boom');
const axios = require('axios');

// Wrap everything in an async function since useMultiFileAuthState is async
(async () => {
  const { state, saveCreds } = await useMultiFileAuthState('./auth_info');

  async function startSock() {
    const sock = makeWASocket({
      auth: state,
      printQRInTerminal: true,
    });

    // Save session credentials whenever they update
    sock.ev.on('creds.update', saveCreds);

    // Handle incoming messages
    sock.ev.on('messages.upsert', async (m) => {
      const msg = m.messages[0];
      if (!msg.message || msg.key.fromMe) return;

      const from = msg.key.remoteJid;
      const text =
        msg.message.conversation || msg.message.extendedTextMessage?.text;

      console.log(`💬 Message from ${from}: ${text}`);

      // Send to Flask bot
      try {
        const response = await axios.post('https://whtzaap-bot.onrender.com/message', {
          from,
          text,
        });

        if (response.data.reply) {
          await sock.sendMessage(from, { text: response.data.reply });
        }
      } catch (err) {
        console.error('❌ Error sending to Flask bot:', err.message);
      }
    });

    // Reconnect on disconnect
    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect } = update;

      if (connection === 'close') {
        const shouldReconnect =
          lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
        console.log('🔌 Connection closed. Reconnecting...', shouldReconnect);
        if (shouldReconnect) {
          startSock();
        }
      } else if (connection === 'open') {
        console.log('✅ Connected to WhatsApp!');
      }
    });
  }

  startSock();
})();
