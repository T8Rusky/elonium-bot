require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');

// Configuration
const usersFile = 'user-data.json';
const stateFile = 'bot-state.json';
const token = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_IDS = ['6068398591'];

if (!token) {
  console.error('❌ TELEGRAM_BOT_TOKEN is not set in environment variables.');
  process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });
let users = {};
let botState = {
  maintenanceMode: false,
  lastSnapshot: null,
  startTime: new Date().toISOString(),
  whitelistClosed: true, // Set to true since Phase 1 is closed
};

// File Operations
const loadUsers = () => {
  const filePath = path.join(__dirname, usersFile);
  if (fs.existsSync(filePath)) {
    try {
      users = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      console.log('✅ Loaded user data from user-data.json');
    } catch (error) {
      console.error('❌ Error loading user-data.json:', error.message);
      users = {};
    }
  }
};

const saveUsers = () => {
  try {
    const filePath = path.join(__dirname, usersFile);
    fs.writeFileSync(filePath, JSON.stringify(users, null, 2));
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = path.join(__dirname, `backup-user-data-${timestamp}.json`);
    fs.writeFileSync(backupFile, JSON.stringify(users, null, 2));
    console.log(`✅ Saved user data and backup: ${backupFile}`);
  } catch (error) {
    console.error('❌ Error saving user-data.json:', error.message);
  }
};

// Load and Save Bot State
const loadBotState = () => {
  const filePath = path.join(__dirname, stateFile);
  if (fs.existsSync(filePath)) {
    try {
      botState = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      console.log('✅ Loaded bot state from bot-state.json');
    } catch (error) {
      console.error('❌ Error loading bot-state.json:', error.message);
      botState = { maintenanceMode: false, lastSnapshot: null, startTime: new Date().toISOString(), whitelistClosed: true };
    }
  }
};

const saveBotState = () => {
  try {
    const filePath = path.join(__dirname, stateFile);
    fs.writeFileSync(filePath, JSON.stringify(botState, null, 2));
    console.log('✅ Saved bot state to bot-state.json');
  } catch (error) {
    console.error('❌ Error saving bot-state.json:', error.message);
  }
};

loadUsers();
loadBotState();

// Maintenance Mode Middleware
bot.on('message', (msg) => {
  const chatId = msg.chat.id.toString();
  if (botState.maintenanceMode && !ADMIN_IDS.includes(chatId)) {
    bot.sendMessage(chatId, '⚙️ Bot is in maintenance mode. Please try again later.');
    return;
  }
});

// Command: /togglemaintenance (Admin Only)
bot.onText(/\/togglemaintenance/, (msg) => {
  const chatId = msg.chat.id.toString();
  if (!ADMIN_IDS.includes(chatId)) {
    return bot.sendMessage(chatId, '🚫 Admin only.');
  }

  botState.maintenanceMode = !botState.maintenanceMode;
  saveBotState();
  bot.sendMessage(chatId, botState.maintenanceMode ? '⚙️ Maintenance mode enabled.' : '✅ Maintenance mode disabled.');
});

// Command: /status (Admin Only)
bot.onText(/\/status/, (msg) => {
  const chatId = msg.chat.id.toString();
  if (!ADMIN_IDS.includes(chatId)) {
    return bot.sendMessage(chatId, '🚫 Admin only.');
  }

  const uptime = new Date(new Date() - new Date(botState.startTime)).toISOString().slice(11, 19);
  bot.sendMessage(
    chatId,
    `📈 Bot Status:
Uptime: ${uptime}
Maintenance Mode: ${botState.maintenanceMode ? 'Enabled ⚙️' : 'Disabled ✅'}
Last Snapshot: ${botState.lastSnapshot || 'None'}
Whitelist Status: ${botState.whitelistClosed ? 'Closed ⛔' : 'Open ✅'}`
  );
});

// Command: /shutdown (Admin Only)
bot.onText(/\/shutdown/, (msg) => {
  const chatId = msg.chat.id.toString();
  if (!ADMIN_IDS.includes(chatId)) {
    return bot.sendMessage(chatId, '🚫 Admin only.');
  }

  bot.sendMessage(chatId, '🔌 Shutting down bot...');
  saveUsers();
  saveBotState();
  setTimeout(() => process.exit(0), 1000);
});

// Command: /restart (Admin Only)
bot.onText(/\/restart/, (msg) => {
  const chatId = msg.chat.id.toString();
  if (!ADMIN_IDS.includes(chatId)) {
    return bot.sendMessage(chatId, '🚫 Admin only.');
  }

  bot.sendMessage(chatId, '🔄 Restarting bot...');
  saveUsers();
  saveBotState();
  setTimeout(() => process.exit(0), 1000);
});

// Command: /start (with optional referral)
bot.onText(/\/start(?:\s+ref_(\d+))?/, (msg, match) => {
  if (botState.maintenanceMode && !ADMIN_IDS.includes(msg.chat.id.toString())) return;

  const chatId = msg.chat.id.toString();
  const referrerId = match[1];

  if (!users[chatId]) {
    users[chatId] = {
      id: chatId,
      totalRewards: 0,
      modulesCompleted: 0,
      invites: 0,
      referredBy: null,
      lastActive: new Date().toLocaleDateString('en-US'),
    };
  }

  if (referrerId && referrerId !== chatId && !users[chatId].referredBy) {
    users[chatId].referredBy = referrerId;

    if (!users[referrerId]) {
      users[referrerId] = {
        id: referrerId,
        totalRewards: 0,
        modulesCompleted: 0,
        invites: 0,
        referredBy: null,
        lastActive: 'Never',
      };
    }

    users[referrerId].invites = (users[referrerId].invites || 0) + 1;
    users[referrerId].totalRewards = (users[referrerId].totalRewards || 0) + 10;
    users[referrerId].lastActive = new Date().toLocaleDateString('en-US');

    bot.sendMessage(referrerId, `🎉 You earned 10 $ELONI!\nUser ${chatId} joined using your invite link.`);
  }

  users[chatId].lastActive = new Date().toLocaleDateString('en-US');
  saveUsers();

  bot.sendMessage(
    chatId,
    `🌐 Welcome to Elonium AI
You're now part of the next-gen AI x DeFi revolution on Solana.

🚀 Earn $ELONI
📚 Learn & grow with AI modules
🔒 Stake, vote, and shape the future
🌟 Early supporters like you will be remembered

This is just the beginning. Let's build it together.`,
    {
      reply_markup: {
        keyboard: [
          ['/help', '/learn'],
          ['/reward', '/stats'],
          ['/register', '/id'],
          ['/snapshot', '/invite'],
        ],
        resize_keyboard: true,
      },
    }
  );
});

// Command: /register <wallet_address>
bot.onText(/\/register (.+)/, (msg, match) => {
  if (botState.maintenanceMode && !ADMIN_IDS.includes(msg.chat.id.toString())) return;

  const chatId = msg.chat.id.toString();
  const walletAddress = match[1];

  if (botState.whitelistClosed) {
    return bot.sendMessage(chatId, '⛔ Whitelist Phase 1 is now closed. Stay tuned for Phase 2.');
  }

  if (!walletAddress || walletAddress.length < 10) {
    return bot.sendMessage(chatId, '❌ Please provide a valid wallet address.');
  }

  const isTaken = Object.entries(users).some(([id, data]) => data.wallet === walletAddress && id !== chatId);
  if (isTaken) {
    return bot.sendMessage(chatId, '❌ This wallet address is already registered by another user.');
  }

  if (users[chatId]?.wallet === walletAddress) {
    return bot.sendMessage(chatId, 'ℹ️ This wallet is already registered to your account.');
  }

  users[chatId] = {
    ...users[chatId],
    id: chatId,
    wallet: walletAddress,
    totalRewards: users[chatId]?.totalRewards || 0,
    modulesCompleted: users[chatId]?.modulesCompleted || 0,
    invites: users[chatId]?.invites || 0,
    referredBy: users[chatId]?.referredBy || null,
    lastActive: new Date().toLocaleDateString('en-US'),
    registeredAt: users[chatId]?.registeredAt || new Date().toISOString(),
    first_name: msg.from.first_name || null,
    username: msg.from.username || null,
    language_code: msg.from.language_code || null,
  };

  saveUsers();
  bot.sendMessage(chatId, `✅ Wallet address *${walletAddress}* registered successfully.`, { parse_mode: 'Markdown' });
});

// Command: /closewhitelist (Admin Only)
bot.onText(/\/closewhitelist/, (msg) => {
  const chatId = msg.chat.id.toString();
  if (!ADMIN_IDS.includes(chatId)) {
    return bot.sendMessage(chatId, '🚫 Admin only.');
  }

  botState.whitelistClosed = true;
  saveBotState();
  bot.sendMessage(chatId, '⛔ Whitelist Phase 1 has been closed.');
});

// Command: /openwhitelist (Admin Only)
bot.onText(/\/openwhitelist/, (msg) => {
  const chatId = msg.chat.id.toString();
  if (!ADMIN_IDS.includes(chatId)) {
    return bot.sendMessage(chatId, '🚫 Admin only.');
  }

  botState.whitelistClosed = false;
  saveBotState();
  bot.sendMessage(chatId, '✅ Whitelist Phase 1 has been reopened.');
});

// Command: /help
bot.onText(/\/help/, (msg) => {
  if (botState.maintenanceMode && !ADMIN_IDS.includes(msg.chat.id.toString())) return;

  const chatId = msg.chat.id.toString();
  const isAdmin = ADMIN_IDS.includes(chatId);
  let helpText = `Commands:
/start - Start the bot
/help - Show this menu
/reward - Claim daily $ELONI
/nextclaim - Check next claim time
/stats - Your stats
/register - Register wallet
/learn - Learn-to-Earn
/id - Your Telegram ID
/invite - Get your invite link`;

  if (isAdmin) {
    helpText += `
/exportcsv - Export full data (admin)
/whitelist - Whitelist export (admin)
/backuplist - Backups list (admin)
/snapshot - Snapshot backup (admin)
/togglemaintenance - Toggle maintenance mode (admin)
/status - Show bot status (admin)
/shutdown - Shutdown bot (admin)
/restart - Restart bot (admin)
/closewhitelist - Close whitelist (admin)
/openwhitelist - Reopen whitelist (admin)`;
  }

  bot.sendMessage(chatId, helpText);
});

// Command: /id
bot.onText(/\/id/, (msg) => {
  if (botState.maintenanceMode && !ADMIN_IDS.includes(msg.chat.id.toString())) return;
  bot.sendMessage(msg.chat.id, `🆔 Your Telegram ID: ${msg.chat.id}`);
});

// Command: /reward
bot.onText(/\/reward/, (msg) => {
  if (botState.maintenanceMode && !ADMIN_IDS.includes(msg.chat.id.toString())) return;

  const chatId = msg.chat.id.toString();
  const today = new Date().toLocaleDateString('en-US');

  if (!users[chatId]) {
    return bot.sendMessage(chatId, '❌ You need to /start first.');
  }
  if (users[chatId].lastReward === today) {
    return bot.sendMessage(chatId, '🕒 Already claimed today. Come back tomorrow!');
  }

  users[chatId].totalRewards = (users[chatId].totalRewards || 0) + 15;
  users[chatId].modulesCompleted = (users[chatId].modulesCompleted || 0) + 1;
  users[chatId].lastActive = today;
  users[chatId].lastReward = today;

  saveUsers();
  bot.sendMessage(chatId, `✅ Earned 15 $ELONI!\nTotal: ${users[chatId].totalRewards} $ELONI`);
});

// Command: /nextclaim
bot.onText(/\/nextclaim/, (msg) => {
  if (botState.maintenanceMode && !ADMIN_IDS.includes(msg.chat.id.toString())) return;

  const chatId = msg.chat.id.toString();
  const today = new Date().toLocaleDateString('en-US');

  if (!users[chatId]) {
    return bot.sendMessage(chatId, '❌ You need to /start first.');
  }

  if (users[chatId].lastReward === today) {
    bot.sendMessage(chatId, '⏳ Already claimed today. Next claim after midnight 🌙');
  } else {
    bot.sendMessage(chatId, '✅ You can claim now. Use /reward to earn!');
  }
});

// Command: /stats
bot.onText(/\/stats/, (msg) => {
  if (botState.maintenanceMode && !ADMIN_IDS.includes(msg.chat.id.toString())) return;

  const chatId = msg.chat.id.toString();
  const user = users[chatId];

  if (!user) {
    return bot.sendMessage(chatId, '❌ No data found. Use /start first.');
  }

  bot.sendMessage(
    chatId,
    `📊 Your Stats:
Wallet: ${user.wallet || 'Not set'}
Rewards: ${user.totalRewards || 0}
Modules Completed: ${user.modulesCompleted || 0}
Invites: ${user.invites || 0}
Last Active: ${user.lastActive}
Referred By: ${user.referredBy || 'None'}`
  );
});

// Command: /backuplist (Admin Only)
bot.onText(/\/backuplist/, (msg) => {
  const chatId = msg.chat.id.toString();
  if (!ADMIN_IDS.includes(chatId)) {
    return bot.sendMessage(chatId, '🚫 Admin only.');
  }

  const files = fs.readdirSync(__dirname).filter((f) => f.startsWith('backup-user-data'));
  if (!files.length) {
    return bot.sendMessage(chatId, '🗃️ No backups found.');
  }
  bot.sendMessage(chatId, `🗂 Backups:\n${files.join('\n')}`);
});

// Command: /exportcsv (Admin Only)
bot.onText(/\/exportcsv/, (msg) => {
  const chatId = msg.chat.id.toString();
  if (!ADMIN_IDS.includes(chatId)) {
    return bot.sendMessage(chatId, '🚫 Admin only.');
  }

  const csv = ['id,wallet,totalRewards,modulesCompleted,invites,first_name,username,language_code'];
  for (const [id, data] of Object.entries(users)) {
    csv.push(
      [
        id,
        data.wallet || '',
        data.totalRewards || 0,
        data.modulesCompleted || 0,
        data.invites || 0,
        data.first_name || '',
        data.username || '',
        data.language_code || '',
      ].join(',')
    );
  }
  const filename = path.join(__dirname, 'export-users.csv');
  fs.writeFileSync(filename, csv.join('\n'));
  bot.sendDocument(chatId, filename);
});

// Command: /whitelist (Admin Only)
bot.onText(/\/whitelist/, (msg) => {
  const chatId = msg.chat.id.toString();
  if (!ADMIN_IDS.includes(chatId)) {
    return bot.sendMessage(chatId, '🚫 Admin only.');
  }

  const csv = ['wallet,tier'];
  for (const user of Object.values(users)) {
    if (user.wallet) csv.push(`${user.wallet},OG`);
  }
  const filename = path.join(__dirname, 'whitelist.csv');
  fs.writeFileSync(filename, csv.join('\n'));
  bot.sendDocument(chatId, filename);
});

// Command: /snapshot (Admin Only)
bot.onText(/\/snapshot/, (msg) => {
  const chatId = msg.chat.id.toString();
  if (!ADMIN_IDS.includes(chatId)) {
    return bot.sendMessage(chatId, '🚫 Admin only.');
  }

  saveUsers();
  botState.lastSnapshot = new Date().toISOString();
  saveBotState();
  bot.sendMessage(chatId, '✅ Snapshot created successfully.');
});

// Command: /invite
bot.onText(/\/invite/, (msg) => {
  if (botState.maintenanceMode && !ADMIN_IDS.includes(msg.chat.id.toString())) return;

  const chatId = msg.chat.id.toString();
  const inviteLink = `https://t.me/EloniumAIAssistant?start=ref_${chatId}`;
  bot.sendMessage(chatId, `📩 Your Invite Link:\n${inviteLink}\nShare this link to earn 10 $ELONI per referral!`);
});

// Command: /learn (Placeholder for Learn-to-Earn)
bot.onText(/\/learn/, (msg) => {
  if (botState.maintenanceMode && !ADMIN_IDS.includes(msg.chat.id.toString())) return;

  bot.sendMessage(
    msg.chat.id,
    '📚 Learn-to-Earn Modules\nComing soon! Complete AI finance modules to earn $ELONI rewards.'
  );
});

// Handle Unknown Commands
bot.onText(/^\/\w+/, (msg) => {
  if (botState.maintenanceMode && !ADMIN_IDS.includes(msg.chat.id.toString())) return;

  const command = msg.text.split(' ')[0];
  const knownCommands = [
    '/start',
    '/help',
    '/reward',
    '/nextclaim',
    '/stats',
    '/register',
    '/learn',
    '/id',
    '/exportcsv',
    '/whitelist',
    '/backuplist',
    '/snapshot',
    '/invite',
    '/togglemaintenance',
    '/status',
    '/shutdown',
    '/restart',
    '/closewhitelist',
    '/openwhitelist',
  ];

  if (!knownCommands.includes(command)) {
    bot.sendMessage(msg.chat.id, '🤖 Unknown command. Use /help to see available options.');
  }
});

// Error Handling
bot.on('polling_error', (error) => {
  console.error('❌ Polling error:', error.message);
});

console.log('✅ EloniumAI bot is live!');