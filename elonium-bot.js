require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const fs = require("fs");
const path = require("path");

const usersFile = "user-data.json";
const token = process.env.TELEGRAM_BOT_TOKEN;
const adminId = process.env.ADMIN_ID || "your_actual_admin_id_here";

if (!token) {
  console.error("TELEGRAM_BOT_TOKEN is not set in environment variables.");
  process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });
let users = {};

const loadUsers = () => {
  if (fs.existsSync(usersFile)) {
    try {
      users = JSON.parse(fs.readFileSync(usersFile, "utf8"));
    } catch (error) {
      console.error("Error loading user-data.json:", error);
      users = {};
    }
  }
};

const saveUsers = () => {
  try {
    fs.writeFileSync(usersFile, JSON.stringify(users, null, 2));

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupFile = `backup-user-data-${timestamp}.json`;
    fs.writeFileSync(backupFile, JSON.stringify(users, null, 2));

    console.log(`✅ Saved user-data and backup: ${backupFile}`);
  } catch (error) {
    console.error("Error saving user-data.json:", error);
  }
};

loadUsers();

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id.toString();

  if (!users[chatId]) {
    users[chatId] = {
      id: chatId,
      totalRewards: 0,
      modulesCompleted: 0,
      invites: 0,
      referredBy: null,
      lastActive: "Never"
    };
    saveUsers();
  }

  users[chatId].lastActive = new Date().toLocaleDateString("en-US");
  saveUsers();

  bot.sendMessage(chatId, "🌟 Welcome to Elonium AI! 🌟\nWe’re building the future of AI-powered finance on Solana. Earn $ELONI, learn, and grow with us!", {
    reply_markup: {
      keyboard: [
        ["/help", "/learn"],
        ["/reward", "/stats"],
        ["/register", "/id"],
        ["/snapshot", "/invite"]
      ],
      resize_keyboard: true
    }
  });
});

// /register
bot.onText(/\/register (.+)/, (msg, match) => {
  const chatId = msg.chat.id.toString();
  const walletAddress = match[1];

  if (!walletAddress || walletAddress.length < 10) {
    bot.sendMessage(chatId, "❌ Please provide a valid wallet address.");
    return;
  }

  // Check if this wallet has already been registered by someone else
  const isTaken = Object.entries(users).some(
    ([id, data]) => data.wallet === walletAddress && id !== chatId
  );

  if (isTaken) {
    bot.sendMessage(chatId, "❌ This wallet address is already registered by another user.");
    return;
  }

  // If wallet is already the same for this user, reject
  if (users[chatId]?.wallet === walletAddress) {
    bot.sendMessage(chatId, "ℹ️ This wallet is already registered to your account.");
    return;
  }

  // Update or create user record
  users[chatId] = {
    ...users[chatId],
    id: chatId,
    wallet: walletAddress,
    totalRewards: users[chatId]?.totalRewards || 0,
    modulesCompleted: users[chatId]?.modulesCompleted || 0,
    invites: users[chatId]?.invites || 0,
    referredBy: users[chatId]?.referredBy || null,
    lastActive: new Date().toLocaleDateString("en-US"),
    registeredAt: users[chatId]?.registeredAt || new Date().toISOString(),
    first_name: msg.from.first_name || null,
    username: msg.from.username || null,
    language_code: msg.from.language_code || null
  };

  saveUsers();
  bot.sendMessage(chatId, `✅ Wallet address *${walletAddress}* registered successfully.`, { parse_mode: "Markdown" });
});

// /help
bot.onText(/\/help/, (msg) => {
  const helpText = "Commands:\n/start - Start the bot\n/help - Show this message\n/reward - Claim $ELONI\n/learn - Learn-to-Earn\n/stats - View your stats\n/register - Register your wallet\n/snapshot - Admin only\n/id - View your Telegram user ID";
  bot.sendMessage(msg.chat.id, helpText);
});

// /id
bot.onText(/\/id/, (msg) => {
  bot.sendMessage(msg.chat.id, `🆔 Your Telegram ID: ${msg.chat.id}`);
});

// /reward
bot.onText(/\/reward/, (msg) => {
  const chatId = msg.chat.id.toString();
  if (!users[chatId]) return bot.sendMessage(chatId, "❌ Please /start first.");
  users[chatId].totalRewards += 15;
  users[chatId].modulesCompleted += 1;
  users[chatId].lastActive = new Date().toLocaleDateString("en-US");
  saveUsers();
  bot.sendMessage(chatId, `🎁 You earned 15 $ELONI! Total: ${users[chatId].totalRewards}`);
});

// /stats
bot.onText(/\/stats/, (msg) => {
  const chatId = msg.chat.id.toString();
  const user = users[chatId];
  if (!user) return bot.sendMessage(chatId, "❌ No data found. Use /start first.");
  bot.sendMessage(chatId,
    `📊 Your Stats:\nWallet: ${user.wallet || "Not set"}\nRewards: ${user.totalRewards}\nModules: ${user.modulesCompleted}\nInvites: ${user.invites}\nLast Active: ${user.lastActive}\nReferred By: ${user.referredBy || "None"}`
  );
});

// /backuplist
bot.onText(/\/backuplist/, (msg) => {
  const chatId = msg.chat.id.toString();
  const files = fs.readdirSync(".").filter(f => f.startsWith("backup-user-data"));
  if (files.length === 0) {
    return bot.sendMessage(chatId, "🗃️ No backups found yet.");
  }
  bot.sendMessage(chatId, `🗂 Backup Files:\n${files.join("\n")}`);
});

// /exportcsv
bot.onText(/\/exportcsv/, (msg) => {
  const chatId = msg.chat.id.toString();
  const csv = ["id,wallet,totalRewards,modulesCompleted,invites,first_name,username,language_code"];
  for (const [id, data] of Object.entries(users)) {
    csv.push([
      id,
      data.wallet || "",
      data.totalRewards || 0,
      data.modulesCompleted || 0,
      data.invites || 0,
      data.first_name || "",
      data.username || "",
      data.language_code || ""
    ].join(","));
  }
  const csvData = csv.join("\n");
  const filename = "export-users.csv";
  fs.writeFileSync(filename, csvData);
  bot.sendDocument(chatId, filename);
});

// /whitelist
bot.onText(/\/whitelist/, (msg) => {
  const chatId = msg.chat.id.toString();
  const csv = ["wallet,tier"];
  for (const user of Object.values(users)) {
    if (user.wallet) {
      csv.push(`${user.wallet},OG`);
    }
  }
  const filename = "whitelist.csv";
  fs.writeFileSync(filename, csv.join("\n"));
  bot.sendDocument(chatId, filename);
});

// Catch all
bot.on("message", (msg) => {
  if (!msg.text.startsWith("/")) {
    bot.sendMessage(msg.chat.id, "🤖 Unknown command. Use /help to see what's available.");
  }
});

bot.on("polling_error", (error) => console.error("Polling error:", error));

console.log("✅ EloniumAI bot is live...");
