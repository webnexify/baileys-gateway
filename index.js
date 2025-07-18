const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode-terminal');
const axios = require('axios');

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
      if (shouldReconnect) startSock();
    } else if (connection === 'open') {
      console.log('✅ Connected to WhatsApp!');
    }
  });

  // ✅ WELCOME HANDLER (defined once only!)
  sock.ev.on('group-participants.update', async (update) => {
    const { id, participants, action } = update;
    if (action === 'add' && participants.length > 0) {
      try {
        const metadata = await sock.groupMetadata(id);
        const allParticipants = metadata.participants.map((p) => p.id);

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
        console.error('❌ Error sending welcome message:', err.message);
      }
    }
  });

  // ✅ MESSAGE HANDLER
    sock.ev.on('messages.upsert', async (m) => {
      const msg = m.messages[0];
      if (!msg.message || msg.key.fromMe) return;

      const from = msg.key.remoteJid;
      const isGroup = from.endsWith('@g.us');
      const sender = msg.key.participant || msg.key.remoteJid;

      const text =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        msg.message.imageMessage?.caption ||
        msg.message.videoMessage?.caption ||
        msg.message.stickerMessage?.caption ||
        '';

      const msgType = Object.keys(msg.message)[0];
      const type = msgType.replace('Message', '').toLowerCase(); // e.g., "text", "sticker"

      console.log(`📨 ${isGroup ? 'Group' : 'Private'} message from ${from}: ${text}`);

      let participants = [];
      let admins = [];

      if (isGroup) {
        try {
          const metadata = await sock.groupMetadata(from);
          participants = metadata.participants.map((p) => p.id);
          admins = metadata.participants
            .filter((p) => p.admin !== null)
            .map((p) => p.id);
        } catch (err) {
          console.error('❌ Failed to fetch group metadata:', err.message);
        }
      }

      // ✅ Block non-admin link sharing (AFTER metadata is ready)
      const linkRegex = /(https?:\/\/[^\s]+)/gi;
      if (isGroup && linkRegex.test(text)) {
        if (!admins.includes(sender)) {
          // 1. Delete the message
          await sock.sendMessage(from, {
            delete: {
              remoteJid: from,
              fromMe: false,
              id: msg.key.id,
              participant: sender
            }
          });

          // 2. Send warning
          await sock.sendMessage(from, {
            text: `🚫 Only *group admins* can share links, @${sender.split('@')[0]}.`,
            mentions: [sender]
          });

          return; // 🔚 stop further processing
        }
      }

      // ✅ Send to Flask backend
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
        console.error('❌ Error sending to Flask bot:', err.message);
      }
    });

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
        await sock.sendMessage(from, { delete: msg.key });  // 🔥 delete the original message
      }

      if (response.data.reply) {
        await sock.sendMessage(from, {
          text: response.data.reply,
          mentions: response.data.mentions || [],
        });
      }
    } catch (err) {
      console.error('❌ Error sending to Flask bot:', err.message);
    }
  });
