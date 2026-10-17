import fs from 'fs/promises';
import path from 'path';
import TelegramBot from 'node-telegram-bot-api';
import dayjs from 'dayjs';

const BOT_TOKEN = process.env.BOT_TOKEN;
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, '..', 'data.json');

if (!BOT_TOKEN) {
  throw new Error('Environment variable BOT_TOKEN is required');
}

type GroupConfig = {
  chatId: number;
  ownerId: number | null;
  intervalDays: number;
  notifyTime: string;
  members: string[];
  currentIndex: number;
  nextDue?: string;
  reminderSentDate?: string;
  overdueReminderSentDate?: string;
};

type BotData = Record<string, GroupConfig>;

let store: BotData = {};

async function loadData() {
  try {
    const raw = await fs.readFile(DATA_FILE, 'utf-8');
    store = JSON.parse(raw) as BotData;
  } catch (error) {
    store = {};
    await saveData();
  }
}

async function saveData() {
  await fs.writeFile(DATA_FILE, JSON.stringify(store, null, 2), 'utf-8');
}

function getKey(chatId: number) {
  return String(chatId);
}

function getGroupConfig(chatId: number): GroupConfig {
  const key = getKey(chatId);
  if (!store[key]) {
    store[key] = {
      chatId,
      ownerId: null,
      intervalDays: 3,
      notifyTime: '20:00',
      members: [],
      currentIndex: 0,
    };
  }
  return store[key];
}

function normalizeMember(raw: string) {
  const username = raw.trim();
  if (username.startsWith('@')) {
    return username;
  }
  return `@${username}`;
}

function formatMemberList(members: string[]) {
  if (!members.length) {
    return 'Список пуст. Добавьте участников командой /add_member @username';
  }
  return members.map((member, index) => `${index + 1}. ${member}`).join('\n');
}

function computeNextDue(config: GroupConfig) {
  if (config.nextDue) {
    return config.nextDue;
  }
  const next = dayjs().add(config.intervalDays, 'day').startOf('day');
  config.nextDue = next.toISOString();
  return config.nextDue;
}

function getCurrentResponsible(config: GroupConfig) {
  if (!config.members.length) {
    return null;
  }
  if (config.currentIndex >= config.members.length) {
    config.currentIndex = 0;
  }
  return config.members[config.currentIndex];
}

function canModifyConfig(config: GroupConfig, userId: number) {
  return config.ownerId === null || config.ownerId === userId;
}

function setOwner(config: GroupConfig, userId: number) {
  if (!config.ownerId) {
    config.ownerId = userId;
  }
}

function isValidTime(value: string) {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(value);
  return Boolean(match);
}

function nextDueText(config: GroupConfig) {
  if (!config.nextDue) {
    return 'не назначено';
  }
  return dayjs(config.nextDue).locale('ru').format('DD.MM.YYYY');
}

async function sendHelp(chatId: number) {
  await bot.sendMessage(chatId, `Команды бота для управления поливом:\n
/start - начать работу и сохранить владельца\n/set_interval <days> - интервал полива\n/set_time HH:MM - время ежедневного напоминания\n/add_member @username - добавить участника\n/remove_member @username - удалить участника\n/list_members - показать очередь\n/next - кто ответственный сейчас\n/done - отметить полив выполненным\n/skip - пропустить текущего и назначить следующего\n/help - показать эту подсказку`);
}

function buildStatus(config: GroupConfig) {
  return `Настройки:\n- Интервал: ${config.intervalDays} дней\n- Время: ${config.notifyTime}\n- Следующий полив: ${nextDueText(config)}\n- Текущий ответственный: ${getCurrentResponsible(config) ?? 'никто'}\n- Участники:\n${formatMemberList(config.members)}`;
}

async function sendReminder(config: GroupConfig) {
  if (!config.members.length) {
    return;
  }
  const responsible = getCurrentResponsible(config);
  if (!responsible) {
    return;
  }
  const dueDate = dayjs(config.nextDue).format('DD.MM.YYYY');
  await bot.sendMessage(config.chatId, `${responsible}, пора полить растение сегодня (${dueDate}). Напиши /done, когда сделано, или /skip, если пропускаешь.`);
  config.reminderSentDate = dayjs().format('YYYY-MM-DD');
}

async function sendOverdueReminder(config: GroupConfig, dueDate: string) {
  const responsible = getCurrentResponsible(config);
  if (!responsible) {
    return;
  }
  await bot.sendMessage(config.chatId, `${responsible}, срок полива был ${dayjs(dueDate).format('DD.MM.YYYY')}, но никто не отчитался о выполнении задачи. Если полил — напиши /done, иначе выполни задачу или используй /skip.`);
  config.overdueReminderSentDate = dayjs().format('YYYY-MM-DD');
}

async function checkReminders() {
  const now = dayjs();
  const today = now.format('YYYY-MM-DD');

  for (const key of Object.keys(store)) {
    const config = store[key];
    if (!config.members.length) {
      continue;
    }
    computeNextDue(config);
    const due = dayjs(config.nextDue);
    if (!due.isValid()) {
      continue;
    }

    const [hour, minute] = config.notifyTime.split(':').map(Number);
    const remindMoment = now.hour(hour).minute(minute).second(0);
    if (now.isBefore(remindMoment)) {
      continue;
    }

    if (due.isSame(today, 'day')) {
      if (config.reminderSentDate !== today) {
        await sendReminder(config);
        await saveData();
      }
      continue;
    }

    const dueDate = due.format('YYYY-MM-DD');
    if (due.isBefore(today, 'day') && config.overdueReminderSentDate !== today) {
      await sendOverdueReminder(config, dueDate);
      await saveData();
    }
  }
}

function advanceResponsible(config: GroupConfig) {
  if (!config.members.length) {
    return;
  }
  config.currentIndex = (config.currentIndex + 1) % config.members.length;
}

function assignNextDue(config: GroupConfig) {
  config.nextDue = dayjs().add(config.intervalDays, 'day').startOf('day').toISOString();
  config.reminderSentDate = undefined;
  config.overdueReminderSentDate = undefined;
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

bot.onText(/\/start/, async (msg) => {
  if (!msg.chat || !msg.from) {
    return;
  }
  const config = getGroupConfig(msg.chat.id);
  setOwner(config, msg.from.id);
  await saveData();
  await bot.sendMessage(msg.chat.id, `Привет! Я буду назначать ответственного за полив и присылать напоминания. Владелец настроек: @${msg.from.username ?? msg.from.first_name}.\nИспользуй /help для списка команд.`);
});

bot.onText(/\/help/, async (msg) => {
  if (!msg.chat) return;
  await sendHelp(msg.chat.id);
});

bot.onText(/\/set_interval\s+(\d+)/, async (msg, match) => {
  if (!msg.chat || !msg.from || !match) return;
  const config = getGroupConfig(msg.chat.id);
  if (!canModifyConfig(config, msg.from.id)) {
    await bot.sendMessage(msg.chat.id, 'Только владелец группы может менять настройки.');
    return;
  }

  const interval = Number(match[1]);
  if (interval < 1 || interval > 30) {
    await bot.sendMessage(msg.chat.id, 'Интервал должен быть число от 1 до 30.');
    return;
  }
  config.intervalDays = interval;
  assignNextDue(config);
  await saveData();
  await bot.sendMessage(msg.chat.id, `Интервал установлен на ${interval} дней. Следующее напоминание: ${nextDueText(config)}.`);
});

bot.onText(/\/set_time\s+(\d{1,2}:\d{2})/, async (msg, match) => {
  if (!msg.chat || !msg.from || !match) return;
  const config = getGroupConfig(msg.chat.id);
  if (!canModifyConfig(config, msg.from.id)) {
    await bot.sendMessage(msg.chat.id, 'Только владелец группы может менять настройки.');
    return;
  }
  const time = match[1];
  if (!isValidTime(time)) {
    await bot.sendMessage(msg.chat.id, 'Введите время в формате HH:MM, например 20:00.');
    return;
  }
  config.notifyTime = time;
  config.reminderSentDate = undefined;
  await saveData();
  await bot.sendMessage(msg.chat.id, `Время напоминаний установлено на ${time}.`);
});

bot.onText(/\/add_member\s+(.+)/, async (msg, match) => {
  if (!msg.chat || !msg.from || !match) return;
  const config = getGroupConfig(msg.chat.id);
  if (!canModifyConfig(config, msg.from.id)) {
    await bot.sendMessage(msg.chat.id, 'Только владелец группы может менять участников.');
    return;
  }

  const member = normalizeMember(match[1]);
  if (config.members.includes(member)) {
    await bot.sendMessage(msg.chat.id, `${member} уже есть в очереди.`);
    return;
  }
  config.members.push(member);
  if (!config.nextDue) {
    assignNextDue(config);
  }
  await saveData();
  await bot.sendMessage(msg.chat.id, `${member} добавлен в очередь. Текущий ответственный: ${getCurrentResponsible(config)}.`);
});

bot.onText(/\/remove_member\s+(.+)/, async (msg, match) => {
  if (!msg.chat || !msg.from || !match) return;
  const config = getGroupConfig(msg.chat.id);
  if (!canModifyConfig(config, msg.from.id)) {
    await bot.sendMessage(msg.chat.id, 'Только владелец группы может менять участников.');
    return;
  }

  const member = normalizeMember(match[1]);
  const index = config.members.indexOf(member);
  if (index === -1) {
    await bot.sendMessage(msg.chat.id, `${member} не найден в списке.`);
    return;
  }
  config.members.splice(index, 1);
  if (config.currentIndex >= config.members.length) {
    config.currentIndex = 0;
  }
  await saveData();
  await bot.sendMessage(msg.chat.id, `${member} удален. Текущий ответственный: ${getCurrentResponsible(config) ?? 'нет'}.`);
});

bot.onText(/\/list_members/, async (msg) => {
  if (!msg.chat) return;
  const config = getGroupConfig(msg.chat.id);
  await bot.sendMessage(msg.chat.id, buildStatus(config));
});

bot.onText(/\/next/, async (msg) => {
  if (!msg.chat) return;
  const config = getGroupConfig(msg.chat.id);
  const responsible = getCurrentResponsible(config);
  await bot.sendMessage(msg.chat.id, responsible
    ? `Текущий ответственный: ${responsible}. Следующий полив: ${nextDueText(config)}.`
    : 'Список участников пуст. Добавьте участника командой /add_member @username.');
});

bot.onText(/\/done/, async (msg) => {
  if (!msg.chat) return;
  const config = getGroupConfig(msg.chat.id);
  if (!config.members.length) {
    await bot.sendMessage(msg.chat.id, 'Нет участников в очереди. Добавьте кого-нибудь командой /add_member @username.');
    return;
  }
  const responsible = getCurrentResponsible(config);
  assignNextDue(config);
  advanceResponsible(config);
  await saveData();
  await bot.sendMessage(msg.chat.id, `Спасибо! Задача выполнена. Следующий ответственный: ${getCurrentResponsible(config)}. Следующее напоминание: ${nextDueText(config)}.`);
});

bot.onText(/\/skip/, async (msg) => {
  if (!msg.chat) return;
  const config = getGroupConfig(msg.chat.id);
  if (!config.members.length) {
    await bot.sendMessage(msg.chat.id, 'Список пуст. Добавьте участников командой /add_member @username.');
    return;
  }
  advanceResponsible(config);
  await saveData();
  await bot.sendMessage(msg.chat.id, `Пропущено. Новый ответственный: ${getCurrentResponsible(config)}.`);
});

bot.on('message', async (msg) => {
  if (!msg.chat || !msg.text) {
    return;
  }
  if (msg.text.startsWith('/') && !msg.text.startsWith('/start') && !msg.text.startsWith('/help') && !msg.text.startsWith('/set_interval') && !msg.text.startsWith('/set_time') && !msg.text.startsWith('/add_member') && !msg.text.startsWith('/remove_member') && !msg.text.startsWith('/list_members') && !msg.text.startsWith('/next') && !msg.text.startsWith('/done') && !msg.text.startsWith('/skip')) {
    await bot.sendMessage(msg.chat.id, 'Неизвестная команда. Введите /help для списка команд.');
  }
});

(async () => {
  await loadData();
  await checkReminders();
  setInterval(checkReminders, 60 * 1000);
  console.log('Bot started');
})();
