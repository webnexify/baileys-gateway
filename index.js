const {
  default: makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeInMemoryStore,
} = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode-terminal');
const axios = require('axios');
const fs = require('fs');

(async () => {
  const { state, saveCreds } = await useMultiFileAuthState('./auth_info');

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: true,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      console.log('Scan the QR Code below:');
      qrcode.generate(qr, { small: true });
    }
    if (connection === 'close') {
      const shouldReconnect =
        lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log('Connection closed. Reconnecting...', shouldReconnect);
      if (shouldReconnect) {
        startSock();
      }
    } else if (connection === 'open') {
      console.log('✅ Connected to WhatsApp!');
    }
  });

  sock.ev.on('messages.upsert', async (m) => {
    const msg = m.messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const from = msg.key.remoteJid;
    const isGroup = from.endsWith('@g.us');
    const text =
      msg.message.conversation || msg.message.extendedTextMessage?.text || '';

    console.log(`📨 ${isGroup ? 'Group' : 'Private'} message from ${from}: ${text}`);

    if (isGroup && text.toLowerCase().startsWith('.tagall')) {
      try {
        const groupMetadata = await sock.groupMetadata(from);
        const mentions = groupMetadata.participants.map((p) => p.id);
        const names = groupMetadata.participants.map((p) => `@${p.id.split('@')[0]}`).join(' ');

        await sock.sendMessage(from, {
          text: `📢 Tagging everyone:\n${names}`,
          mentions,
        });
      } catch (err) {
        console.error('Error sending .tagall:', err.message);
      }
    } else if (text.toLowerCase() === 'hi') {
      await sock.sendMessage(from, { text: '👋 Hello there!' });
    }
  });
})();
