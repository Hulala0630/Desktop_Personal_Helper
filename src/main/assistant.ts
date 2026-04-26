import Database from 'better-sqlite3';

export type InputSource = 'text' | 'voice';

export type MemoryRecord = {
  id: string;
  content: string;
  category: string;
  source: InputSource;
  createdAt: string;
};

export type ReminderRecord = {
  id: string;
  title: string;
  rawInput: string;
  remindAt: string;
  status: 'pending' | 'notified' | 'completed';
  source: InputSource;
  createdAt: string;
};

export type ChatRecord = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  source: InputSource | 'system';
  createdAt: string;
};

export type DigestItem = {
  id: string;
  title: string;
  summary: string;
  sourceName: string;
  sourceUrl: string;
  publishedAt: string;
};

export type DashboardState = {
  reminders: ReminderRecord[];
  chatLogs: ChatRecord[];
  digestItems: DigestItem[];
};

export type ReminderAction = 'complete' | 'delete' | 'snooze10';

type LocalDatabase = Database.Database;

const memoryKeywords = ['记住', '记一下', '记得', '我是', '我在', '我想', '我希望', '我喜欢', '我正在'];
const reminderKeywords = ['提醒', '日程', '安排', '会议', '开会', '预约', '待办', 'todo'];

const formatIso = (date: Date) => date.toISOString();
const createId = () => crypto.randomUUID();

const stripCommandPrefix = (input: string) =>
  input
    .replace(/^记一下[:：]?\s*/u, '')
    .replace(/^记住[:：]?\s*/u, '')
    .replace(/^提醒我[:：]?\s*/u, '')
    .replace(/^帮我提醒[:：]?\s*/u, '')
    .trim();

const parseReminderTime = (input: string) => {
  const now = new Date();
  const candidate = new Date(now);

  const relativeMinutesMatch = input.match(/(\d{1,3})\s*分钟后/u);
  if (relativeMinutesMatch) {
    candidate.setMinutes(candidate.getMinutes() + Number(relativeMinutesMatch[1]));
    return candidate;
  }

  const relativeHoursMatch = input.match(/(\d{1,2})\s*小时后/u);
  if (relativeHoursMatch) {
    candidate.setHours(candidate.getHours() + Number(relativeHoursMatch[1]));
    return candidate;
  }

  if (input.includes('后天')) {
    candidate.setDate(candidate.getDate() + 2);
  } else if (input.includes('明天')) {
    candidate.setDate(candidate.getDate() + 1);
  } else if (input.includes('下周')) {
    candidate.setDate(candidate.getDate() + 7);
  }

  const timeMatch =
    input.match(/(上午|中午|下午|晚上)?\s*(\d{1,2})(?:[:点时](\d{1,2}))?/u) ??
    input.match(/\b(\d{1,2}):(\d{2})\b/u);

  if (!timeMatch) {
    candidate.setMinutes(candidate.getMinutes() + 5);
    return candidate;
  }

  const period = timeMatch[1] ?? '';
  const rawHour = Number(timeMatch[2]);
  const rawMinute = Number(timeMatch[3] ?? 0);

  let hour = rawHour;
  if ((period === '下午' || period === '晚上') && hour < 12) {
    hour += 12;
  }
  if (period === '中午' && hour < 11) {
    hour += 12;
  }

  candidate.setHours(hour, rawMinute, 0, 0);

  if (candidate.getTime() <= now.getTime()) {
    candidate.setDate(candidate.getDate() + 1);
  }

  return candidate;
};

const buildReminderTitle = (input: string) => {
  const cleaned = stripCommandPrefix(input)
    .replace(/(今天|明天|后天|下周)/gu, '')
    .replace(/(上午|中午|下午|晚上)?\s*\d{1,2}(?:[:点时]\d{1,2})?/gu, '')
    .replace(/[，。、；;]/gu, ' ')
    .trim();

  return cleaned || '新的提醒';
};

const inferMemoryCategory = (input: string) => {
  if (input.includes('喜欢') || input.includes('偏好')) {
    return 'preference';
  }
  if (input.includes('目标') || input.includes('转型') || input.includes('阶段')) {
    return 'goal';
  }
  return 'profile';
};

const isReminderIntent = (input: string) => reminderKeywords.some((keyword) => input.includes(keyword));
const isMemoryIntent = (input: string) => memoryKeywords.some((keyword) => input.includes(keyword));

export const createAssistantService = (db: LocalDatabase) => {
  const getRecentMemories = () =>
    db
      .prepare(
        `
          SELECT id, content, category, source, created_at AS createdAt
          FROM memories
          ORDER BY created_at DESC
          LIMIT 20
        `
      )
      .all() as MemoryRecord[];

  const getUpcomingReminders = () =>
    db
      .prepare(
        `
          SELECT id, title, raw_input AS rawInput, remind_at AS remindAt, status, source, created_at AS createdAt
          FROM reminders
          ORDER BY
            CASE status
              WHEN 'pending' THEN 0
              WHEN 'notified' THEN 1
              ELSE 2
            END,
            remind_at ASC
          LIMIT 12
        `
      )
      .all() as ReminderRecord[];

  const getRecentChatLogs = () =>
    db
      .prepare(
        `
          SELECT id, role, content, source, created_at AS createdAt
          FROM (
            SELECT id, role, content, source, created_at, sequence
            FROM chat_logs
            ORDER BY sequence DESC
            LIMIT 80
          )
          ORDER BY sequence ASC
        `
      )
      .all() as ChatRecord[];

  const getDigestItems = () =>
    db
      .prepare(
        `
          SELECT id, title, summary, source_name AS sourceName, source_url AS sourceUrl, published_at AS publishedAt
          FROM ai_digest_items
          ORDER BY published_at DESC
          LIMIT 12
        `
      )
      .all() as DigestItem[];

  const getDashboardState = (): DashboardState => ({
    reminders: getUpcomingReminders(),
    chatLogs: getRecentChatLogs(),
    digestItems: getDigestItems()
  });

  const clearChatLogs = () => {
    db.prepare(`DELETE FROM chat_logs`).run();
    return getDashboardState();
  };

  const saveChatMessage = (role: 'user' | 'assistant', content: string, source: InputSource | 'system') => {
    db.prepare(
      `
        INSERT INTO chat_logs (id, role, content, source, created_at, sequence)
        VALUES (?, ?, ?, ?, ?, (SELECT IFNULL(MAX(sequence), 0) + 1 FROM chat_logs))
      `
    ).run(createId(), role, content, source, formatIso(new Date()));
  };

  const saveMemoryIfNeeded = (content: string, source: InputSource) => {
    if (!isMemoryIntent(content)) {
      return null;
    }

    const normalized = stripCommandPrefix(content);
    db.prepare(
      `
        INSERT INTO memories (id, content, category, source, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `
    ).run(createId(), normalized, inferMemoryCategory(normalized), source, formatIso(new Date()), formatIso(new Date()));

    return normalized;
  };

  const saveReminderIfNeeded = (content: string, source: InputSource) => {
    if (!isReminderIntent(content)) {
      return null;
    }

    const remindAt = parseReminderTime(content);
    const title = buildReminderTitle(content);
    db.prepare(
      `
        INSERT INTO reminders (id, title, raw_input, remind_at, status, source, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)
      `
    ).run(createId(), title, content, formatIso(remindAt), source, formatIso(new Date()), formatIso(new Date()));

    return {
      title,
      remindAt
    };
  };

  const handleLocalInput = (input: string, source: InputSource) => {
    const content = input.trim();
    if (!content) {
      return {
        assistantMessage: '我没有收到有效输入，你可以再说一次。',
        localOnly: true
      };
    }

    saveChatMessage('user', content, source);

    const reminder = saveReminderIfNeeded(content, source);
    if (reminder) {
      const assistantMessage = `已为你创建提醒：${reminder.title}，时间是 ${reminder.remindAt.toLocaleString('zh-CN')}`;
      saveChatMessage('assistant', assistantMessage, 'system');
      return { assistantMessage, localOnly: true, state: getDashboardState() };
    }

    const memory = saveMemoryIfNeeded(content, source);
    if (memory) {
      const assistantMessage = `我记住了：${memory}`;
      saveChatMessage('assistant', assistantMessage, 'system');
      return { assistantMessage, localOnly: true, state: getDashboardState() };
    }

    return { localOnly: false, state: getDashboardState() };
  };

  const finalizeAssistantReply = (content: string) => {
    saveChatMessage('assistant', content, 'system');
    return getDashboardState();
  };

  const replaceDigestItems = (items: DigestItem[]) => {
    const transaction = db.transaction((entries: DigestItem[]) => {
      db.prepare('DELETE FROM ai_digest_items').run();
      const insert = db.prepare(
        `
          INSERT INTO ai_digest_items (id, title, summary, source_name, source_url, published_at, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `
      );

      for (const item of entries) {
        insert.run(item.id, item.title, item.summary, item.sourceName, item.sourceUrl, item.publishedAt, formatIso(new Date()));
      }
    });

    transaction(items);
    return getDigestItems();
  };

  const buildContext = () => ({
    memories: getRecentMemories(),
    reminders: getUpcomingReminders(),
    chatLogs: getRecentChatLogs(),
    digestItems: getDigestItems()
  });

  const flushDueReminders = () => {
    const now = formatIso(new Date());
    const due = db
      .prepare(
        `
          SELECT id, title, raw_input AS rawInput, remind_at AS remindAt, status, source, created_at AS createdAt
          FROM reminders
          WHERE status = 'pending' AND remind_at <= ?
          ORDER BY remind_at ASC
        `
      )
      .all(now) as ReminderRecord[];

    if (due.length === 0) {
      return [];
    }

    const update = db.prepare(
      `
        UPDATE reminders
        SET status = 'notified', updated_at = ?
        WHERE id = ?
      `
    );

    const transaction = db.transaction((records: ReminderRecord[]) => {
      for (const reminder of records) {
        update.run(now, reminder.id);
      }
    });

    transaction(due);
    return due;
  };

  const mutateReminder = (id: string, action: ReminderAction) => {
    const reminder = db
      .prepare(
        `
          SELECT id, title, raw_input AS rawInput, remind_at AS remindAt, status, source, created_at AS createdAt
          FROM reminders
          WHERE id = ?
        `
      )
      .get(id) as ReminderRecord | undefined;

    if (!reminder) {
      return getDashboardState();
    }

    const now = formatIso(new Date());

    if (action === 'delete') {
      db.prepare(`DELETE FROM reminders WHERE id = ?`).run(id);
      saveChatMessage('assistant', `已删除提醒：${reminder.title}`, 'system');
      return getDashboardState();
    }

    if (action === 'complete') {
      db.prepare(
        `
          UPDATE reminders
          SET status = 'completed', updated_at = ?
          WHERE id = ?
        `
      ).run(now, id);
      saveChatMessage('assistant', `已完成提醒：${reminder.title}`, 'system');
      return getDashboardState();
    }

    const snoozedTime = new Date(reminder.remindAt);
    snoozedTime.setMinutes(snoozedTime.getMinutes() + 10);
    db.prepare(
      `
        UPDATE reminders
        SET status = 'pending', remind_at = ?, updated_at = ?
        WHERE id = ?
      `
    ).run(formatIso(snoozedTime), now, id);
    saveChatMessage('assistant', `已将提醒顺延 10 分钟：${reminder.title}`, 'system');
    return getDashboardState();
  };

  return {
    buildContext,
    clearChatLogs,
    finalizeAssistantReply,
    flushDueReminders,
    getDashboardState,
    handleLocalInput,
    mutateReminder,
    replaceDigestItems
  };
};
