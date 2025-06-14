require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');

// --- Configuration ---
const USERS_FILE = 'user-data.json';
const STATE_FILE = 'bot-state.json';
const token = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_IDS = ['6068398591']; // <<<<<<<< IMPORTANT: REPLACE WITH YOUR TELEGRAM USER ID(s)
const VERIFICATION_TIMEOUT_MS = 300000; // 5 minutes for new member verification

if (!token) {
    console.error('❌ TELEGRAM_BOT_TOKEN is not set in environment variables. Please create a .env file.');
    process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });

// Stop any existing polling to prevent conflicts (good for development restarts)
bot.stopPolling().then(() => {
    console.log('Stopped any existing polling instances.');
    bot.startPolling();
});

// --- Data Storage ---
let users = {};
let botState = {
    maintenanceMode: false,
    registerEnabled: false,
    lastSnapshot: null,
    startTime: new Date().toISOString(),
    whitelistClosed: true,
    lastMessageTimes: {}, // For anti-raid
    pendingVerification: {}, // userId: { code: '...', timestamp: Date.now(), chatId: '...', messageId: '...' }
};
const verificationTimeouts = {}; // Stores setTimeout IDs for unverified users

// --- File Operations ---
const loadUsers = () => {
    const filePath = path.join(__dirname, USERS_FILE);
    if (fs.existsSync(filePath)) {
        try {
            users = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            console.log('✅ Loaded user data from user-data.json');
        } catch (error) {
            console.error('❌ Error loading user-data.json:', error.message);
            users = {}; // Fallback to empty if corrupted
        }
    }
};

const saveUsers = () => {
    try {
        const filePath = path.join(__dirname, USERS_FILE);
        fs.writeFileSync(filePath, JSON.stringify(users, null, 2));
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupFile = path.join(__dirname, `backup-user-data-${timestamp}.json`);
        fs.writeFileSync(backupFile, JSON.stringify(users, null, 2));
        console.log(`✅ Saved user data and created backup: ${backupFile}`);
    } catch (error) {
        console.error('❌ Error saving user-data.json:', error.message);
    }
};

const loadBotState = () => {
    const filePath = path.join(__dirname, STATE_FILE);
    if (fs.existsSync(filePath)) {
        try {
            const loadedState = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            // Merge with defaults, ensuring new properties exist
            botState = {
                ...botState, // Start with current defaults
                ...loadedState, // Overwrite with loaded values
                registerEnabled: loadedState.registerEnabled !== undefined ? loadedState.registerEnabled : false,
                whitelistClosed: loadedState.whitelistClosed !== undefined ? loadedState.whitelistClosed : true,
                lastMessageTimes: loadedState.lastMessageTimes || {}, // Ensure it's an object
                pendingVerification: loadedState.pendingVerification || {}, // Ensure it's an object
            };
            // Clean up any stale pending verifications on load
            for (const userId in botState.pendingVerification) {
                if (Date.now() - botState.pendingVerification[userId].timestamp > VERIFICATION_TIMEOUT_MS) {
                    delete botState.pendingVerification[userId];
                }
            }
            console.log('✅ Loaded bot state from bot-state.json');
        } catch (error) {
            console.error('❌ Error loading bot-state.json:', error.message);
            // Revert to default state if corrupted
            botState = { maintenanceMode: false, registerEnabled: false, lastSnapshot: null, startTime: new Date().toISOString(), whitelistClosed: true, lastMessageTimes: {}, pendingVerification: {} };
        }
    }
};

const saveBotState = () => {
    try {
        const filePath = path.join(__dirname, STATE_FILE);
        fs.writeFileSync(filePath, JSON.stringify(botState, null, 2));
        console.log('✅ Saved bot state to bot-state.json');
    } catch (error) {
        console.error('❌ Error saving bot-state.json:', error.message);
    }
};

// Initial load of data
loadUsers();
loadBotState();

// --- Group Permissions for Verification ---
const RESTRICTED_PERMISSIONS = {
    can_send_messages: false,
    can_send_media_messages: false,
    can_send_polls: false,
    can_send_other_messages: false,
    can_add_web_page_previews: false,
    can_change_info: false,
    can_invite_users: false,
    can_pin_messages: false,
};

const VERIFIED_PERMISSIONS = {
    can_send_messages: true,
    can_send_media_messages: true,
    can_send_polls: true,
    can_send_other_messages: true,
    can_add_web_page_previews: true,
    can_change_info: false,
    can_invite_users: false,
    can_pin_messages: false,
};

// --- Middleware & Anti-Raid ---
bot.on('message', (msg) => {
    const chatId = msg.chat.id.toString();
    const userId = msg.from.id.toString();
    const isAdmin = ADMIN_IDS.includes(userId);

    // Maintenance Mode Check
    if (botState.maintenanceMode && !isAdmin) {
        bot.sendMessage(chatId, '⚙️ Bot is in maintenance mode. Please try again later.');
        return;
    }

    // Anti-raid: Limit message frequency
    const now = Date.now();
    const lastMessageTime = botState.lastMessageTimes[userId] || 0;
    if (now - lastMessageTime < 1000 && !isAdmin) { // 1-second cooldown per user
        // console.log(`Anti-raid: Ignoring message from ${userId} due to cooldown.`);
        return; // Ignore the message to prevent spam
    }
    botState.lastMessageTimes[userId] = now;
    // No need to save botState every message, it's frequently saved by other actions

    // Remove external links (in groups for non-admins)
    if (msg.chat.type === 'group' || msg.chat.type === 'supergroup') {
        const text = msg.text || '';
        if (text.includes('http') && !isAdmin) {
            bot.deleteMessage(msg.chat.id, msg.message_id)
                .catch((err) => console.error('❌ Failed to delete message (link):', err.message));
            bot.sendMessage(chatId, '🚫 External links are not allowed for security reasons.').then(sentMsg => {
                // Delete the warning message after a short delay
                setTimeout(() => bot.deleteMessage(chatId, sentMsg.message_id).catch(err => console.error('❌ Failed to delete warning message:', err.message)), 5000);
            });
            return; // Stop processing this message
        }
    }
});


// --- New Member Group Verification ---
bot.on('new_chat_members', async (msg) => {
    const chatId = msg.chat.id.toString();
    const newMembers = msg.new_chat_members;

    if (!newMembers || newMembers.length === 0) return;

    for (const member of newMembers) {
        const userId = member.id.toString();
        const isAdmin = ADMIN_IDS.includes(userId);

        // Safely check bot ID or admin status
        const botId = bot?.id ? bot.id.toString() : null; // Use optional chaining and fallback
        if (userId === botId || isAdmin) {
            if (member.is_bot && userId !== botId) {
                // If another bot joins and it's not our bot, kick it immediately
                try {
                    await bot.kickChatMember(chatId, userId);
                    console.log(`Kicked bot ${member.first_name || userId} from chat ${chatId}`);
                } catch (error) {
                    console.error(`Error kicking joining bot ${userId}:`, error.message);
                }
            }
            continue;
        }

        // Initialize user if not exists (or update info for existing user)
        if (!users[userId]) {
            users[userId] = {
                id: userId,
                first_name: member.first_name,
                username: member.username,
                language_code: member.language_code,
                totalRewards: 0,
                modulesCompleted: 0,
                invites: 0,
                referredBy: null,
                lastActive: new Date().toLocaleDateString('en-US'),
                verified: false, // New users start unverified
            };
            saveUsers();
        } else {
            // Update user info for existing users (e.g., if username changed)
            users[userId].first_name = member.first_name;
            users[userId].username = member.username;
            users[userId].language_code = member.language_code;
            saveUsers();
        }

        // If user is already verified (e.g., from private chat or previous join)
        if (users[userId].verified) {
            bot.sendMessage(chatId, `👋 Welcome back, ${member.first_name || 'new member'}!`);
            continue; // Skip group verification
        }

        try {
            // 1. Immediately restrict the new member
            await bot.restrictChatMember(chatId, userId, { permissions: RESTRICTED_PERMISSIONS });
            console.log(`Restricted ${member.first_name || userId} in chat ${chatId}`);

            // 2. Generate verification challenge and store it
            const verificationCode = Math.random().toString(36).substring(2, 8).toUpperCase();
            botState.pendingVerification[userId] = {
                code: verificationCode,
                timestamp: Date.now(),
                chatId: chatId, // Store the chat ID where verification was requested
                messageId: null // Placeholder for the verification message ID
            };
            saveBotState();

            // 3. Send verification message with inline button to the group
            const welcomeMessage = `👋 Welcome, ${member.first_name || 'new member'}!
To gain full access and send messages, please click the button below to verify you are human.
You have ${VERIFICATION_TIMEOUT_MS / 60000} minutes to verify or you will be kicked.`;

            const sentMessage = await bot.sendMessage(
                chatId,
                welcomeMessage,
                {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: `✅ I am human! Click Here`, callback_data: `verify_${verificationCode}` }],
                        ],
                    },
                    parse_mode: 'HTML'
                }
            );

            // Store the message ID for later deletion/editing
            botState.pendingVerification[userId].messageId = sentMessage.message_id;
            saveBotState();

            // 4. Set a timeout to kick if not verified
            verificationTimeouts[userId] = setTimeout(async () => {
                if (botState.pendingVerification[userId] && botState.pendingVerification[userId].chatId === chatId) {
                    try {
                        await bot.kickChatMember(chatId, userId);
                        await bot.deleteMessage(chatId, botState.pendingVerification[userId].messageId)
                            .catch(err => console.warn(`Could not delete verification message for kicked user ${userId}:`, err.message));
                        delete botState.pendingVerification[userId];
                        delete verificationTimeouts[userId];
                        saveBotState();
                        console.log(`Kicked unverified user ${member.first_name || userId} from chat ${chatId}`);
                        bot.sendMessage(chatId, `👋 ${member.first_name || 'A user'} was kicked for not verifying.`);
                    } catch (error) {
                        console.error(`Error kicking unverified user ${userId} from chat ${chatId}:`, error.message);
                    }
                }
            }, VERIFICATION_TIMEOUT_MS);

        } catch (error) {
            console.error(`Error processing new member ${userId} in chat ${chatId}:`, error.message);
            // This usually means the bot doesn't have enough permissions
            bot.sendMessage(chatId, `⚠️ I couldn't restrict ${member.first_name || 'a new member'}. Please check my admin permissions (Restrict Members & Delete Messages).`);
        }
    }
});


// --- Callback Query Handler (for inline buttons) ---
bot.on('callback_query', async (callbackQuery) => {
    const message = callbackQuery.message;
    const data = callbackQuery.data;
    const userId = callbackQuery.from.id.toString();
    const chatId = message.chat.id.toString(); // Chat where the button was pressed

    // Always answer the callback query to remove the loading state
    await bot.answerCallbackQuery(callbackQuery.id);

    // Handle verification button
    if (data.startsWith('verify_')) {
        const receivedCode = data.split('_')[1];

        if (botState.pendingVerification[userId] &&
            botState.pendingVerification[userId].code === receivedCode &&
            botState.pendingVerification[userId].chatId === chatId) { // Ensure correct chat context

            // User verified!
            users[userId].verified = true;

            // Unrestrict the user in the group
            try {
                await bot.restrictChatMember(chatId, userId, { permissions: VERIFIED_PERMISSIONS });
                console.log(`Unrestricted ${callbackQuery.from.first_name || userId} in chat ${chatId}`);
            } catch (error) {
                console.error(`Error unrestricting user ${userId} in chat ${chatId}:`, error.message);
            }

            // Clear the kick timeout
            if (verificationTimeouts[userId]) {
                clearTimeout(verificationTimeouts[userId]);
                delete verificationTimeouts[userId];
            }

            // Delete the original verification message
            try {
                await bot.deleteMessage(chatId, botState.pendingVerification[userId].messageId);
            } catch (error) {
                console.warn(`Could not delete verification message for user ${userId}:`, error.message);
            }

            delete botState.pendingVerification[userId]; // Clean up pending state
            saveUsers();
            saveBotState(); // Save state after changes

            // Send a confirmation message
            bot.sendMessage(chatId, `🎉 ${callbackQuery.from.first_name || 'Welcome'}, you are now verified and can send messages!`);

        } else {
            // Invalid code, expired, or mismatch (e.g., user clicked an old button)
            try {
                await bot.sendMessage(chatId, '❌ Verification failed or expired. Please contact an admin if you believe this is an error, or try rejoining the group.');
            } catch (error) {
                // If the message fails, it means the user might have already been kicked or left.
                console.error(`Error sending verification failure message to ${chatId} for user ${userId}:`, error.message);
            }
        }
    }
    // Add other callback_query handlers here if you have more inline buttons
});


// --- Command Handlers ---

// Command: /toggleregister (Admin only)
bot.onText(/\/toggleregister/, (msg) => {
    const userId = msg.from.id.toString();
    if (!ADMIN_IDS.includes(userId)) {
        return bot.sendMessage(msg.chat.id, '🚫 Admin only command.');
    }

    botState.registerEnabled = !botState.registerEnabled;
    bot.sendMessage(msg.chat.id, `✅ Register command is now ${botState.registerEnabled ? 'enabled' : 'disabled'}.`);
    saveBotState();
});

// Command: /togglemaintenance (Admin only)
bot.onText(/\/togglemaintenance/, (msg) => {
    const userId = msg.from.id.toString();
    if (!ADMIN_IDS.includes(userId)) {
        return bot.sendMessage(msg.chat.id, '🚫 Admin only.');
    }

    botState.maintenanceMode = !botState.maintenanceMode;
    saveBotState();
    bot.sendMessage(msg.chat.id, botState.maintenanceMode ? '⚙️ Maintenance mode enabled.' : '✅ Maintenance mode disabled.');
});

// Command: /status (Admin only)
bot.onText(/\/status/, (msg) => {
    const userId = msg.from.id.toString();
    if (!ADMIN_IDS.includes(userId)) {
        return bot.sendMessage(msg.chat.id, '🚫 Admin only.');
    }

    const uptime = new Date(new Date() - new Date(botState.startTime)).toISOString().slice(11, 19);
    const pendingVerificationsCount = Object.keys(botState.pendingVerification).length;

    bot.sendMessage(
        msg.chat.id,
        `📈 Bot Status:
Uptime: ${uptime}
Maintenance Mode: ${botState.maintenanceMode ? 'Enabled ⚙️' : 'Disabled ✅'}
Register Enabled: ${botState.registerEnabled ? 'Yes ✅' : 'No ⛔'}
Last Snapshot: ${botState.lastSnapshot || 'None'}
Whitelist Status: ${botState.whitelistClosed ? 'Closed ⛔' : 'Open ✅'}
Pending Verifications: ${pendingVerificationsCount} ⏳`
    );
});

// Command: /shutdown (Admin only)
bot.onText(/\/shutdown/, (msg) => {
    const userId = msg.from.id.toString();
    if (!ADMIN_IDS.includes(userId)) {
        return bot.sendMessage(msg.chat.id, '🚫 Admin only.');
    }

    bot.sendMessage(msg.chat.id, '🔌 Shutting down bot...');
    saveUsers();
    saveBotState();
    setTimeout(() => process.exit(0), 1000);
});

// Command: /restart (Admin only)
bot.onText(/\/restart/, (msg) => {
    const userId = msg.from.id.toString();
    if (!ADMIN_IDS.includes(userId)) {
        return bot.sendMessage(msg.chat.id, '🚫 Admin only.');
    }

    bot.sendMessage(msg.chat.id, '🔄 Restarting bot...');
    saveUsers();
    saveBotState();
    setTimeout(() => process.exit(0), 1000);
});

// Command: /start
bot.onText(/\/start(?:\s+ref_(\d+))?/, async (msg, match) => {
    const chatId = msg.chat.id.toString();
    const userId = msg.from.id.toString();
    const isAdmin = ADMIN_IDS.includes(userId);

    if (botState.maintenanceMode && !isAdmin) {
        return bot.sendMessage(chatId, '⚙️ Bot is in maintenance mode. Please try again later.');
    }

    // Human verification check (for group users)
    if (!users[userId]?.verified && (msg.chat.type === 'group' || msg.chat.type === 'supergroup') && !isAdmin) {
        bot.sendMessage(chatId, '🔒 You must complete the group verification process first! Please check the welcome message sent when you joined or contact an admin for assistance.', {
            reply_to_message_id: msg.message_id
        });
        return;
    }

    // Initialize or update user
    if (!users[userId]) {
        users[userId] = {
            id: userId,
            first_name: msg.from.first_name,
            username: msg.from.username,
            language_code: msg.from.language_code,
            totalRewards: 0,
            modulesCompleted: 0,
            invites: 0,
            referredBy: null,
            lastActive: new Date().toLocaleDateString('en-US'),
            verified: false,
        };
    } else {
        users[userId].first_name = msg.from.first_name;
        users[userId].username = msg.from.username;
        users[userId].language_code = msg.from.language_code;
    }

    users[userId].lastActive = new Date().toLocaleDateString('en-US');
    saveUsers();

    // Placeholder for referral system (Phase 2)
    const referrerId = match && match[1];
    if (referrerId && referrerId !== userId) {
        bot.sendMessage(chatId, '📩 Referral noted. Referral rewards will be active in Phase 2.');
    }

    // Send welcome message
    bot.sendMessage(
        chatId,
        `🌐 Welcome to Elonium AI\nYou're now part of the next-gen AI x DeFi revolution on Solana.\n\n🚀 Earn $ELONI\n📚 Learn & grow with AI modules\n🔒 Stake, vote, and shape the future\n🌟 Early supporters like you will be remembered\n\n🔗 Explore: https://eloniumai.io | https://twitter.com/EloniumAI`,
        {
            reply_markup: {
                keyboard: [
                    ['/help', '/learn'],
                    ['/reward', '/stats'],
                    ['/register', '/links'],
                ],
                resize_keyboard: true,
            },
        }
    );
});

   // Referral placeholder — full system coming in Phase 2
if (referrerId && referrerId !== userId) {
    bot.sendMessage(chatId, '📩 Referral noted. Referral rewards will be activated in Phase 2.');

    // Optional: log for manual review later
    console.log(`Referral noted: User ${userId} was referred by ${referrerId}`);
}


    // Update last active and save
    users[userId].lastActive = new Date().toLocaleDateString('en-US');
    saveUsers();

    // Send welcome message (only if verified or in private chat after verification)
    bot.sendMessage(
        chatId,
        `🌐 Welcome to Elonium AI\nYou're now part of the next-gen AI x DeFi revolution on Solana.\n\n🚀 Earn $ELONI\n📚 Learn & grow with AI modules\n🔒 Stake, vote, and shape the future\n🌟 Early supporters like you will be remembered\n\n🔗 Explore: https://eloniumai.io | https://twitter.com/EloniumAI`,
        {
            reply_markup: {
                keyboard: [
                    ['/help', '/learn'],
                    ['/reward', '/stats'],
                    ['/register', '/links'],
                ],
                resize_keyboard: true,
            },
        }
    );
});

// Command: /register <wallet>
bot.onText(/\/register (.+)/, (msg, match) => {
    const userId = msg.from.id.toString();
    const chatId = msg.chat.id.toString();

    if (botState.maintenanceMode && !ADMIN_IDS.includes(userId)) return;

    if (!users[userId] || !users[userId].verified) {
        return bot.sendMessage(chatId, '❌ You need to be verified to use this command. Use /start first.');
    }

    if (!botState.registerEnabled) {
        return bot.sendMessage(chatId, '⛔ Registration is currently disabled. Please try again later.');
    }

    const wallet = match[1].trim();
    if (!/^[A-Za-z0-9]{32,44}$/.test(wallet)) {
        return bot.sendMessage(chatId, '❌ Invalid wallet address. Please provide a valid Solana wallet address (32-44 alphanumeric characters).');
    }

    if (users[userId].wallet) {
        return bot.sendMessage(chatId, '⚠️ You have already registered a wallet.');
    }

    users[userId].wallet = wallet;
    users[userId].lastActive = new Date().toLocaleDateString('en-US');
    saveUsers();
    bot.sendMessage(chatId, `✅ Wallet ${wallet} registered successfully!`);
});

// Command: /closewhitelist (Admin only)
bot.onText(/\/closewhitelist/, (msg) => {
    const userId = msg.from.id.toString();
    if (!ADMIN_IDS.includes(userId)) {
        return bot.sendMessage(msg.chat.id, '🚫 Admin only.');
    }

    botState.whitelistClosed = true;
    saveBotState();
    bot.sendMessage(msg.chat.id, '⛔ Whitelist Phase 1 has been closed.');
});

// Command: /openwhitelist (Admin only)
bot.onText(/\/openwhitelist/, (msg) => {
    const userId = msg.from.id.toString();
    if (!ADMIN_IDS.includes(userId)) {
        return bot.sendMessage(msg.chat.id, '🚫 Admin only.');
    }

    botState.whitelistClosed = false;
    saveBotState();
    bot.sendMessage(msg.chat.id, '✅ Whitelist Phase 1 has been reopened.');
});

// Command: /help
bot.onText(/\/help/, (msg) => {
    const userId = msg.from.id.toString();
    const chatId = msg.chat.id.toString();
    const isAdmin = ADMIN_IDS.includes(userId);

    if (botState.maintenanceMode && !isAdmin) return;

    // Users must be verified to get full help or interact
    if (!users[userId] || !users[userId].verified) {
        return bot.sendMessage(chatId, '🔒 Please start the bot and complete verification first. Type /start');
    }


    let helpText = `Commands:
  /start - Start the bot
  /help - Show this menu
  /reward - Claim daily $ELONI
  /nextclaim - Check next claim time
  /stats - Your stats
  /register - Register your wallet (currently ${botState.registerEnabled ? 'enabled' : 'disabled'})
  /learn - Learn-to-Earn (coming soon)
  /id - Your Telegram ID
  /invite - Invite friends
  /links - Project links`;

    if (isAdmin) {
        helpText += `\n\nAdmin Commands:
  /exportcsv - Export full user data (CSV)
  /whitelist - Export whitelisted wallets (CSV)
  /backuplist - List data backups
  /snapshot - Create a data snapshot
  /togglemaintenance - Toggle bot maintenance mode
  /status - Show bot status
  /shutdown - Shutdown bot
  /restart - Restart bot
  /closewhitelist - Close whitelist phase 1
  /openwhitelist - Reopen whitelist phase 1
  /toggleregister - Toggle register command status`;
    }

    bot.sendMessage(chatId, helpText);
});

// Command: /id
bot.onText(/\/id/, (msg) => {
    const userId = msg.from.id.toString();
    const chatId = msg.chat.id.toString();
    const isAdmin = ADMIN_IDS.includes(userId);

    if (botState.maintenanceMode && !isAdmin) return;
    if (!users[userId] || !users[userId].verified) {
        return bot.sendMessage(chatId, '🔒 Please start the bot and complete verification first. Type /start');
    }
    bot.sendMessage(chatId, `🆔 Your Telegram User ID: ${userId}`);
});

// Command: /reward
bot.onText(/\/reward/, (msg) => {
    const userId = msg.from.id.toString();
    const chatId = msg.chat.id.toString();
    const isAdmin = ADMIN_IDS.includes(userId);

    if (botState.maintenanceMode && !isAdmin) return;
    if (!users[userId] || !users[userId].verified) {
        return bot.sendMessage(chatId, '🔒 Please start the bot and complete verification first. Type /start');
    }

    const today = new Date().toLocaleDateString('en-US');
    const user = users[userId];

    if (user.lastReward === today) {
        return bot.sendMessage(chatId, '🕒 Already claimed today. Come back tomorrow!');
    }

    user.totalRewards = (user.totalRewards || 0) + 15;
    user.modulesCompleted = (user.modulesCompleted || 0) + 1; // Assuming each reward is a module completion
    user.lastActive = today;
    user.lastReward = today;

    saveUsers();
    bot.sendMessage(chatId, `✅ Earned 15 $ELONI!\nTotal: ${user.totalRewards} $ELONI`);
});

// Command: /nextclaim
bot.onText(/\/nextclaim/, (msg) => {
    const userId = msg.from.id.toString();
    const chatId = msg.chat.id.toString();
    const isAdmin = ADMIN_IDS.includes(userId);

    if (botState.maintenanceMode && !isAdmin) return;
    if (!users[userId] || !users[userId].verified) {
        return bot.sendMessage(chatId, '🔒 Please start the bot and complete verification first. Type /start');
    }

    const today = new Date().toLocaleDateString('en-US');
    const user = users[userId];

    if (user.lastReward === today) {
        bot.sendMessage(chatId, '⏳ Already claimed today. Next claim after midnight 🌙');
    } else {
        bot.sendMessage(chatId, '✅ You can claim now. Use /reward to earn!');
    }
});

// Command: /stats
bot.onText(/\/stats/, (msg) => {
    const userId = msg.from.id.toString();
    const chatId = msg.chat.id.toString();
    const isAdmin = ADMIN_IDS.includes(userId);

    if (botState.maintenanceMode && !isAdmin) return;
    if (!users[userId] || !users[userId].verified) {
        return bot.sendMessage(chatId, '🔒 Please start the bot and complete verification first. Type /start');
    }

    const user = users[userId];

    bot.sendMessage(
        chatId,
        `📊 Your Stats:
Telegram ID: ${user.id}
Wallet: ${user.wallet || 'Not set'}
Rewards: ${user.totalRewards || 0} $ELONI
Modules Completed: ${user.modulesCompleted || 0}
Invites: ${user.invites || 0}
Last Active: ${user.lastActive}
Referred By: ${user.referredBy || 'None'}`
    );
});

// Command: /backuplist (Admin only)
bot.onText(/\/backuplist/, (msg) => {
    const userId = msg.from.id.toString();
    if (!ADMIN_IDS.includes(userId)) {
        return bot.sendMessage(msg.chat.id, '🚫 Admin only.');
    }

    const files = fs.readdirSync(__dirname).filter((f) => f.startsWith('backup-user-data'));
    if (!files.length) {
        return bot.sendMessage(msg.chat.id, '🗃️ No backups found.');
    }
    bot.sendMessage(msg.chat.id, `🗂 Backups:\n${files.join('\n')}`);
});

// Command: /exportcsv (Admin only)
bot.onText(/\/exportcsv/, (msg) => {
    const userId = msg.from.id.toString();
    if (!ADMIN_IDS.includes(userId)) {
        return bot.sendMessage(msg.chat.id, '🚫 Admin only.');
    }

    const csvRows = ['id,first_name,username,language_code,wallet,totalRewards,modulesCompleted,invites,referredBy,lastActive,lastReward,verified'];
    for (const data of Object.values(users)) {
        csvRows.push(
            [
                data.id || '',
                data.first_name || '',
                data.username || '',
                data.language_code || '',
                data.wallet || '',
                data.totalRewards || 0,
                data.modulesCompleted || 0,
                data.invites || 0,
                data.referredBy || '',
                data.lastActive || '',
                data.lastReward || '',
                data.verified ? 'TRUE' : 'FALSE',
            ].map(item => `"${String(item).replace(/"/g, '""')}"`).join(',') // CSV escaping
        );
    }
    const filename = path.join(__dirname, 'export-users.csv');
    fs.writeFileSync(filename, csvRows.join('\n'));
    bot.sendDocument(msg.chat.id, filename, { caption: 'All user data export.' });
});

// Command: /whitelist (Admin only)
bot.onText(/\/whitelist/, (msg) => {
    const userId = msg.from.id.toString();
    if (!ADMIN_IDS.includes(userId)) {
        return bot.sendMessage(msg.chat.id, '🚫 Admin only.');
    }

    const csvRows = ['wallet,tier,telegram_id,username'];
    for (const user of Object.values(users)) {
        if (user.wallet) {
            csvRows.push(`"${user.wallet || ''}","OG","${user.id || ''}","${user.username || ''}"`);
        }
    }
    const filename = path.join(__dirname, 'whitelist.csv');
    fs.writeFileSync(filename, csvRows.join('\n'));
    bot.sendDocument(msg.chat.id, filename, { caption: 'Whitelisted wallets export.' });
});

// Command: /snapshot (Admin only)
bot.onText(/\/snapshot/, (msg) => {
    const userId = msg.from.id.toString();
    if (!ADMIN_IDS.includes(userId)) {
        return bot.sendMessage(msg.chat.id, '🚫 Admin only.');
    }

    saveUsers(); // This creates a backup
    botState.lastSnapshot = new Date().toISOString();
    saveBotState();
    bot.sendMessage(msg.chat.id, '✅ Snapshot created successfully (user data backup).');
});

// Command: /invite
bot.onText(/\/invite/, (msg) => {
    const userId = msg.from.id.toString();
    const chatId = msg.chat.id.toString();
    const isAdmin = ADMIN_IDS.includes(userId);

    if (botState.maintenanceMode && !isAdmin) return;
    if (!users[userId] || !users[userId].verified) {
        return bot.sendMessage(chatId, '🔒 Please start the bot and complete verification first. Type /start');
    }

    const botUsername = 'AiEloniumBot'; // <<< IMPORTANT: REPLACE WITH YOUR BOT'S @USERNAME
    const inviteLink = `https://t.me/${botUsername}?start=ref_${userId}`;

    bot.sendMessage(
        chatId,
        `📩 Invite your friends to Elonium AI and earn $ELONI rewards for each referral!
\n🔗 Your personal invite link:\n\`${inviteLink}\`\n\nShare this link to earn 10 $ELONI for each friend who joins and verifies! 🚀`,
        {
            parse_mode: 'Markdown',
            reply_markup: {
                keyboard: [
                    ['/links', '/invite'],
                    ['/help', '/learn'],
                    ['/reward', '/stats'],
                ],
                resize_keyboard: true,
            },
        }
    );
});

// Command: /learn (Placeholder)
bot.onText(/\/learn/, (msg) => {
    const userId = msg.from.id.toString();
    const chatId = msg.chat.id.toString();
    const isAdmin = ADMIN_IDS.includes(userId);

    if (botState.maintenanceMode && !isAdmin) return;
    if (!users[userId] || !users[userId].verified) {
        return bot.sendMessage(chatId, '🔒 Please start the bot and complete verification first. Type /start');
    }

    bot.sendMessage(
        chatId,
        '📚 Learn-to-Earn Modules\nComing soon! Complete AI finance modules to earn $ELONI rewards.'
    );
});

// Command: /links
bot.onText(/\/links/, (msg) => {
    const userId = msg.from.id.toString();
    const chatId = msg.chat.id.toString();
    const isAdmin = ADMIN_IDS.includes(userId);

    if (botState.maintenanceMode && !isAdmin) return;
    if (!users[userId] || !users[userId].verified) {
        return bot.sendMessage(chatId, '🔒 Please start the bot and complete verification first. Type /start');
    }

    const linksMessage = `🔗 Elonium AI Links\n\n` +
        `🌐 Website: https://eloniumai.io\n` +
        `📩 Telegram Group: https://t.me/EloniumAICommunity\n` +
        `🐦 Twitter: https://twitter.com/EloniumAI\n` +
        `📧 Contact: team@eloniumai.io | support@eloniumai.io`;

    bot.sendMessage(chatId, linksMessage, {
        reply_markup: {
            keyboard: [
                ['/links', '/invite'],
                ['/help', '/learn'],
                ['/reward', '/stats'],
            ],
            resize_keyboard: true,
        },
    });
});

// Handle Unknown Commands
bot.onText(/^\/\w+/, (msg) => {
    const userId = msg.from.id.toString();
    const chatId = msg.chat.id.toString();
    const isAdmin = ADMIN_IDS.includes(userId);

    if (botState.maintenanceMode && !isAdmin) return;

    const command = msg.text.split(' ')[0];
    const knownCommands = [
        '/start', '/help', '/reward', '/nextclaim', '/stats', '/register', '/learn', '/id',
        '/invite', '/links',
        // Admin commands
        '/exportcsv', '/whitelist', '/backuplist', '/snapshot',
        '/togglemaintenance', '/status', '/shutdown', '/restart',
        '/closewhitelist', '/openwhitelist', '/toggleregister',
    ];

    if (!knownCommands.includes(command)) {
        bot.sendMessage(chatId, '🤖 Unknown command. Use /help to see available options.');
    }
});

// Error Handling
bot.on('polling_error', (error) => {
    console.error('❌ Polling error:', error.message);
});

console.log('✅ EloniumAI bot is live!');