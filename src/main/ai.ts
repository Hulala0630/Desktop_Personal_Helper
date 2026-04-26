import OpenAI from 'openai';
import type { DigestItem } from './assistant';

type AssistantContext = {
  memories: Array<{ content: string; category: string }>;
  reminders: Array<{ title: string; remindAt: string; status: string }>;
  digestItems: DigestItem[];
  chatLogs: Array<{ role: 'user' | 'assistant'; content: string }>;
};

const buildSystemPrompt = (context: AssistantContext) => {
  const memories = context.memories.map((item) => `- [${item.category}] ${item.content}`).join('\n') || '- 暂无';
  const reminders =
    context.reminders
      .map((item) => `- ${item.title} | ${item.remindAt} | ${item.status === 'pending' ? '待处理' : item.status}`)
      .join('\n') || '- 暂无';
  const digest =
    context.digestItems
      .map((item) => `- ${item.sourceName}: ${item.title} | ${item.summary}`)
      .join('\n') || '- 暂无';

  return [
    '你是 Aster，一个桌面宠物形式的个人助手。',
    '你的主要职责只有四类：记录长期信息、创建提醒、回答简单问题、结合最新 AI 资讯给出简洁建议。',
    '说中文，保持简洁、自然、像贴身助理。',
    '如果用户问的是提醒或预约，优先确认提醒内容，不要编造未写入的数据。',
    '如果用户问的是 AI 资讯，请基于提供的资讯上下文回答，并明确指出值得关注的点。',
    '如果用户问现阶段重点，请结合长期记忆和待处理提醒进行概括。',
    '',
    '用户长期记忆：',
    memories,
    '',
    '用户提醒：',
    reminders,
    '',
    '最新 AI 资讯：',
    digest
  ].join('\n');
};

export const createAiService = (apiKey: string) => {
  const client = new OpenAI({ apiKey });

  const streamReply = async (
    userMessage: string,
    context: AssistantContext,
    onDelta: (delta: string) => void
  ) => {
    const stream = await client.responses.create({
      model: 'gpt-4.1-mini',
      input: [
        {
          role: 'system',
          content: buildSystemPrompt(context)
        },
        ...context.chatLogs.slice(-8).map((item) => ({
          role: item.role,
          content: item.content
        })),
        {
          role: 'user',
          content: userMessage
        }
      ],
      stream: true
    });

    let finalText = '';

    for await (const event of stream) {
      if (event.type === 'response.output_text.delta') {
        finalText += event.delta;
        onDelta(event.delta);
      }
    }

    return finalText.trim();
  };

  return {
    streamReply
  };
};
