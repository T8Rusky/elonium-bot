require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const fs = require("fs");

const usersFile = "user-data.json";
const token = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_IDS = ["6068398591"]; // Replace with actual admin Telegram user ID(s)

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
  }
  users[chatId].lastActive = new Date().toLocaleDateString("en-US");
  saveUsers();

 bot.sendMessage(chatId, `🌐 Welcome to Elonium AI
You're now part of the next-gen AI x DeFi revolution on Solana.

🚀 Earn $ELONI
📚 Learn & grow with AI modules
🔒 Stake, vote, and shape the future
🌟 Early supporters like you will be remembered

This is just the beginning. Let's build it together.`, {
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

bot.onText(/\/register (.+)/, (msg, match) => {
  const chatId = msg.chat.id.toString();
  const walletAddress = match[1];

  if (!walletAddress || walletAddress.length < 10) {
    return bot.sendMessage(chatId, "❌ Please provide a valid wallet address.");
  }

  const isTaken = Object.entries(users).some(([id, data]) => data.wallet === walletAddress && id !== chatId);
  if (isTaken) return bot.sendMessage(chatId, "❌ This wallet address is already registered by another user.");

  if (users[chatId]?.wallet === walletAddress) {
    return bot.sendMessage(chatId, "ℹ️ This wallet is already registered to your account.");
  }

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

bot.onText(/\/help/, (msg) => {
  const helpText = `Commands:
/start - Start the bot
/help - Show this menu
/reward - Claim daily $ELONI
/nextclaim - Check next claim time
/stats - Your stats
/register - Register wallet
/learn - Learn-to-Earn
/id - Your Telegram ID
/exportcsv - Export full data (admin)
/whitelist - Whitelist export (admin)
/backuplist - Backups list (admin)
/snapshot - Snapshot backup (admin)`;
  bot.sendMessage(msg.chat.id, helpText);
});

bot.onText(/\/id/, (msg) => {
  bot.sendMessage(msg.chat.id, `🆔 Your Telegram ID: ${msg.chat.id}`);
});

bot.onText(/\/reward/, (msg) => {
  const chatId = msg.chat.id.toString();
  const today = new Date().toLocaleDateString("en-US");

  if (!users[chatId]) return bot.sendMessage(chatId, "❌ You need to /start first.");
  if (users[chatId].lastReward === today) return bot.sendMessage(chatId, "🕒 Already claimed today. Come back tomorrow!");

  users[chatId].totalRewards += 15;
  users[chatId].modulesCompleted += 1;
  users[chatId].lastActive = today;
  users[chatId].lastReward = today;

  saveUsers();
  bot.sendMessage(chatId, `✅ Earned 15 $ELONI!
Total: ${users[chatId].totalRewards} $ELONI`);
});

bot.onText(/\/nextclaim/, (msg) => {
  const chatId = msg.chat.id.toString();
  const today = new Date().toLocaleDateString("en-US");
  if (!users[chatId]) return bot.sendMessage(chatId, "❌ You need to /start first.");

  if (users[chatId].lastReward === today) {
    bot.sendMessage(chatId, "⏳ Already claimed today. Next claim after midnight 🌙");
  } else {
    bot.sendMessage(chatId, "✅ You can claim now. Use /reward to earn!");
  }
});

bot.onText(/\/stats/, (msg) => {
  const chatId = msg.chat.id.toString();
  const user = users[chatId];
  if (!user) return bot.sendMessage(chatId, "❌ No data. Use /start.");

  bot.sendMessage(chatId, `📊 Your Stats:
Wallet: ${user.wallet || "Not set"}
Rewards: ${user.totalRewards}
Modules: ${user.modulesCompleted}
Invites: ${user.invites}
Last Active: ${user.lastActive}
Referred By: ${user.referredBy || "None"}`);
});

bot.onText(/\/backuplist/, (msg) => {
  const chatId = msg.chat.id.toString();
  if (!ADMIN_IDS.includes(chatId)) return bot.sendMessage(chatId, "🚫 Admin only.");
  const files = fs.readdirSync(".").filter(f => f.startsWith("backup-user-data"));
  if (!files.length) return bot.sendMessage(chatId, "🗃️ No backups found.");
  bot.sendMessage(chatId, `🗂 Backups:
${files.join("\n")}`);
});

bot.onText(/\/exportcsv/, (msg) => {
  const chatId = msg.chat.id.toString();
  if (!ADMIN_IDS.includes(chatId)) return bot.sendMessage(chatId, "🚫 Admin only.");

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
  const filename = "export-users.csv";
  fs.writeFileSync(filename, csv.join("\n"));
  bot.sendDocument(chatId, filename);
});

bot.onText(/\/whitelist/, (msg) => {
  const chatId = msg.chat.id.toString();
  if (!ADMIN_IDS.includes(chatId)) return bot.sendMessage(chatId, "🚫 Admin only.");

  const csv = ["wallet,tier"];
  for (const user of Object.values(users)) {
    if (user.wallet) csv.push(`${user.wallet},OG`);
  }
  const filename = "whitelist.csv";
  fs.writeFileSync(filename, csv.join("\n"));
  bot.sendDocument(chatId, filename);
});

bot.on("message", (msg) => {
  if (!msg.text.startsWith("/")) {
    bot.sendMessage(msg.chat.id, "🤖 Unknown command. Use /help to see options.");
  }
});

bot.on("polling_error", (error) => console.error("Polling error:", error));
console.log("✅ EloniumAI bot is live...");
