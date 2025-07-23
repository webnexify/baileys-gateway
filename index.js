// ✅ 1. Start Express First (for UptimeRobot keep-alive)
const express = require("express");
const app = express();
app.get("/", (_, res) => res.send("Bot is running."));
app.listen(3000, () => console.log("✅ Web server started on port 3000"));
let remindersEnabled = true;  // 🔁 Default: reminders are ON


// ✅ 2. Import other modules
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode-terminal');
const axios = require('axios');
const cron = require('node-cron');

// ✅ 3. Main bot logic
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
        require('child_process').fork(__filename);
        process.exit();
      }
    } else if (connection === 'open') {
      console.log('✅ Connected to WhatsApp!');
    }
  });

  // 🌅 DAILY MORNING MESSAGE at 6:00 AM IST
  cron.schedule('30 0 * * *', async () => {
    try {
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
    } catch (err) {
      console.error('❌ Error sending morning messages:', err.message);
    }
  });

  // 🌙 DAILY GOOD NIGHT MESSAGE at 11:45 PM IST (which is 18:15 UTC)
  cron.schedule('15 18 * * *', async () => {
    try {
      const allChats = await sock.groupFetchAllParticipating();
      const groupIds = Object.keys(allChats);
      const messages = [
        "🌙 Good night, legends! Recharge and respawn tomorrow.",
        "💤 Sleep mode: ON. Dream of victory!",
        "😴 May your dreams be lag-free and full of loot!",
        "🌌 Logging out IRL. GG for today, see you tomorrow!"
      ];
      const message = messages[Math.floor(Math.random() * messages.length)];
      for (const groupId of groupIds) {
        await sock.sendMessage(groupId, { text: message });
      }
    } catch (err) {
      console.error('❌ Error sending good night messages:', err.message);
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
    console.log('Group ID:', from);  // ✅ log group ID
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
    

    
    // 🔔 reminder button
    
    const buttonReply = msg.message?.buttonsResponseMessage;
    if (buttonReply && buttonReply.selectedButtonId === 'toggle_reminder') {
      remindersEnabled = !remindersEnabled;
      await sock.sendMessage(from, {
        text: `🔁 Reminders are now *${remindersEnabled ? 'ENABLED ✅' : 'DISABLED ❌'}*.`
      });
    }

    if (text === '.reminder' && isGroup && admins.includes(sender)) {
      await sock.sendMessage(from, {
        text: `🛠️ Reminder system is currently *${remindersEnabled ? 'ENABLED' : 'DISABLED'}*.\n\nWould you like to toggle it?`,
        buttons: [
          { buttonId: 'toggle_reminder', buttonText: { displayText: remindersEnabled ? '❌ Turn Off' : '✅ Turn On' }, type: 1 }
        ],
        footer: 'Only admins can use this',
        headerType: 1
      });
    }
    
    const allowedGroups = [
      '120363048505746465@g.us',
      '120363419378716476@g.us'
    ];

    // 🕘 9:00 PM IST = 15:30 UTC - First Full Reminder
    cron.schedule('30 15 * * *', async () => {
      if (!remindersEnabled) return;

      const message = `🔔 *Daily Reminder*\n\n` +
        `🗨️ *Chat Freely Until:* 10:00 PM\n` +
        `🎯 *Last Matchmaking:* 10:30 PM\n` +
        `⏳ *Submission Deadline:* 11:00 PM\n\n` +
        `💡 Please stay active and complete your tasks before the deadline.`;

      try {
        for (const groupId of allowedGroups) {
          await sock.sendMessage(groupId, { text: message });
        }
      } catch (err) {
        console.error('❌ 9PM Reminder Error:', err.message);
      }
    });

    // 🕤 9:30 PM IST = 16:00 UTC - Final Full Reminder
    cron.schedule('0 16 * * *', async () => {
      if (!remindersEnabled) return;

      const message = `⚠️ *Final Reminder*\n\n` +
        `🚨 *Last 30 Minutes to Chat!*\n` +
        `🏁 *Last Matchmaking Call at:* 10:30 PM\n` +
        `📌 *Deadline at:* 11:00 PM\n\n` +
        `🕒 Please hurry up and submit everything on time!`;

      try {
        for (const groupId of allowedGroups) {
          await sock.sendMessage(groupId, { text: message });
        }
      } catch (err) {
        console.error('❌ 9:30PM Reminder Error:', err.message);
      }
    });


    // 🚫 Delete non-admin link shares
    if (isGroup && linkRegex.test(text) && !admins.includes(sender)) {
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

    // 🐒 Special "hari" text response
    if (isGroup && text.toLowerCase().includes("hari")) {
      //const hariId = "916282995415@s.whatsapp.net";
      const hari_Id = '@~Hari';// ✅ Replace with correct ID
      const replyText = "അണ്ടിക്കോയെ 🍆 തോൽപ്പിക്കാൻ ഒരു അണ്ടിക്കും സാധിക്കില്ല എന്ന് പറഞ്ഞുകൊണ്ട് 💪🛑 ഹരി (Andikoya)😎🔥🐒👑";
      await sock.sendMessage(from, {
        text: replyText,
        mentions: [hari_Id]
      });
      return;
    }

    // 🤝 Forward to Flask Bot
    try {
      const response = await axios.post('https://whtzaap-bot.onrender.com/message', {
        from,
        text,
        type,
        isGroup,
        groupId,
        participants,
        admins,
        sender
      });

      if (response.data.delete) {
        await sock.sendMessage(from, { delete: msg.key });
      }

      if (response.data.reply) {
    await sock.sendMessage(msg.key.remoteJid, {
        text: response.data.reply,
        mentions: response.data.mentions || [],
    });
}

    } catch (err) {
      console.error('❌ Flask bot error:', err.message);
    }
  });
})();

