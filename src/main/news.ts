import Parser from 'rss-parser';
import type { DigestItem } from './assistant';

const parser = new Parser();

const FEEDS = [
  { sourceName: 'OpenAI', url: 'https://openai.com/news/rss.xml' },
  { sourceName: 'Anthropic', url: 'https://www.anthropic.com/news/rss.xml' },
  { sourceName: 'Hugging Face', url: 'https://huggingface.co/blog/feed.xml' },
  { sourceName: 'Google DeepMind', url: 'https://deepmind.google/discover/blog/rss.xml' },
  { sourceName: 'Mistral', url: 'https://mistral.ai/news/rss.xml' },
  { sourceName: 'Cohere', url: 'https://cohere.com/blog/rss.xml' },
  { sourceName: 'LangChain', url: 'https://blog.langchain.dev/rss/' },
  { sourceName: 'Latent Space', url: 'https://www.latent.space/feed' },
  { sourceName: 'Simon Willison', url: 'https://simonwillison.net/atom/everything/' }
];

const stripHtml = (value: string) => value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

export const fetchLatestAiDigest = async () => {
  const cacheBust = Date.now();

  const feedResults = await Promise.allSettled(
    FEEDS.map(async (feed) => {
      const separator = feed.url.includes('?') ? '&' : '?';
      const parsed = await parser.parseURL(`${feed.url}${separator}t=${cacheBust}`);
      return parsed.items.slice(0, 3).map((item, index) => ({
        id: `${feed.sourceName}-${item.guid ?? item.link ?? index}`,
        title: item.title?.trim() ?? 'Untitled',
        summary: stripHtml(item.contentSnippet ?? item.content ?? item.summary ?? '').slice(0, 220) || '摘要待补充',
        sourceName: feed.sourceName,
        sourceUrl: item.link ?? feed.url,
        publishedAt: item.isoDate ?? new Date().toISOString()
      }));
    })
  );

  const items = feedResults.flatMap((result) => (result.status === 'fulfilled' ? result.value : []));

  return items
    .sort((left, right) => new Date(right.publishedAt).getTime() - new Date(left.publishedAt).getTime())
    .slice(0, 15) as DigestItem[];
};
