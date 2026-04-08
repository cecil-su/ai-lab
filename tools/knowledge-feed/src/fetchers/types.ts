export interface SourceConfig {
  name: string;
  url: string;
  type: "rss" | "jina";
  tags: string[];
  enabled: boolean;
  max_items: number;
}

export interface FeedItem {
  id: string;
  title: string;
  url: string;
  content: string;
  date: string | null;
}

export type Fetcher = (source: SourceConfig) => Promise<FeedItem[]>;
