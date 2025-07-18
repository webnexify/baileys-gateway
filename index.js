const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode-terminal');
const axios = require('axios');
const cron = require('node-cron');

(async () => {
  const { state, saveCreds } = await useMultiFileAuthState('./auth_info');
  const sock = makeWASocket({ auth: state, printQRInTerminal: true });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) qrcode.generate(qr, { small: true });
    if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log('🔌 Disconnected. Reconnect?', shouldReconnect);
      if (shouldReconnect) {
        // Re-run main function to reconnect
        require('child_process').fork(__filename); // 💡 safest restart trick
        process.exit();
      }
    } else if (connection === 'open') {
      console.log('✅ Connected to WhatsApp!');
    }
  });

  // 🌅 DAILY MORNING MESSAGE at 6:00 AM IST (which is 0:30 UTC)
  cron.schedule('30 0 * * *', async () => {
    try {
      console.log('🌄 Sending morning messages...');

      const allChats = await sock.groupFetchAllParticipating();
      const groupIds = Object.keys(allChats);

      const messages = [
        "🌞 Good Morning Gamers! 🎮 Let’s grind!",
        "🔥 New day, new loot! Good morning warriors!",
        "⚔️ Rise and shine, time to conquer!",
        "💡 Level up IRL too — good morning!"
      ];
      const message = messages[Math.floor(Math.random() * messages.length)];

      for (const groupId of groupIds) {
        await sock.sendMessage(groupId, { text: message });
      }

      console.log('✅ Morning messages sent!');
    } catch (err) {
      console.error('❌ Error sending morning messages:', err.message);
    }
  });

  // 👋 Welcome New Participants
  sock.ev.on('group-participants.update', async (update) => {
    const { id, participants, action } = update;
    if (action === 'add' && participants.length > 0) {
      try {
        const metadata = await sock.groupMetadata(id);
        const allParticipants = metadata.participants.map(p => p.id);

        const response = await axios.post('https://whtzaap-bot.onrender.com/message', {
          from: id,
          isGroup: true,
          participants: allParticipants,
          joined: participants
        });

        if (response.data.reply) {
          await sock.sendMessage(id, {
            text: response.data.reply,
            mentions: response.data.mentions || []
          });
        }
      } catch (err) {
        console.error('❌ Welcome message error:', err.message);
      }
    }
  });

  // 💬 Handle Messages
  sock.ev.on('messages.upsert', async (m) => {
    const linkRegex = /(https?:\/\/[^\s]+)/gi;
    const msg = m.messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const from = msg.key.remoteJid;
    const isGroup = from.endsWith('@g.us');
    const sender = msg.key.participant || msg.key.remoteJid;

    const text =
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      msg.message.imageMessage?.caption ||
      msg.message.videoMessage?.caption || '';

    const type = msg.message?.stickerMessage
      ? 'sticker'
      : (msg.message.conversation || msg.message.extendedTextMessage?.text
        ? 'text'
        : null);

    console.log(`📨 ${isGroup ? 'Group' : 'Private'} message from ${from}: ${text}`);

    let participants = [], admins = [];
    if (isGroup) {
      try {
        const metadata = await sock.groupMetadata(from);
        participants = metadata.participants.map((p) => p.id);
        admins = metadata.participants
          .filter((p) => p.admin !== null)
          .map((p) => p.id);
      } catch (err) {
        console.error('❌ Group metadata error:', err.message);
      }
    }

    // 🚫 Delete non-admin link shares
    if (isGroup && linkRegex.test(text)) {
  if (!admins.includes(sender)) {
    try {
      await sock.sendMessage(from, {
        delete: {
          remoteJid: from,
          fromMe: false,
          id: msg.key.id,
          participant: sender
        }
      });

    } catch (err) {
      console.error('❌ Failed to delete link message:', err.message);
    }
  }
}

    // 🤝 Forward to Flask Bot
    try {
      const response = await axios.post('https://whtzaap-bot.onrender.com/message', {
        from,
        text,
        type,
        isGroup,
        participants,
        admins,
        sender
      });

      console.log('📥 Flask response:', response.data);

      if (response.data.delete) {
        await sock.sendMessage(from, { delete: msg.key });
      }

      if (response.data.reply) {
        await sock.sendMessage(from, {
          text: response.data.reply,
          mentions: response.data.mentions || [],
        });
      }
    } catch (err) {
      console.error('❌ Flask bot error:', err.message);
    }
  });
})();
