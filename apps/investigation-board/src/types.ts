// Entity types
export type EntityType = 'person' | 'company' | 'organisation' | 'government';

export type EntityCategory = 'primary' | 'minor';

// Topic types
export type TopicName =
  | 'Lobbying'
  | 'Campaign Finance'
  | 'Government Contracts'
  | 'Tax Evasion'
  | 'Environmental Violations'
  | 'Board Memberships';

export interface Topic {
  name: TopicName;
  color: string;
}

// Core data structures
export interface Entity {
  id: string;
  name: string;
  type: EntityType;
  category: EntityCategory;
  photoUrl?: string;
  initials: string;
  description?: string;
}

export interface DataPoint {
  id: string;
  entityId: string;
  topicName: TopicName;
  title: string;
  summary: string;
  sourceUrl?: string;
  sourceTitle?: string;
  date?: string;
  amount?: string;
}

export interface Connection {
  id: string;
  sourceEntityId: string;
  targetEntityId: string;
  topicName: TopicName;
  summary: string;
  sourceUrl?: string;
  sourceTitle?: string;
  dataPointIds: string[];
}

// React Flow node data
export interface EntityNodeData {
  entity: Entity;
  onSelect: (entityId: string) => void;
}

export interface WordCloudNodeData {
  entityId: string;
  words: WordCloudWord[];
}

export interface WordCloudWord {
  text: string;
  topic: TopicName;
  count: number;
  color: string;
  x: number;
  y: number;
}

// React Flow edge data
export interface ConnectionEdgeData {
  connections: Connection[];
  topicName: TopicName;
  color: string;
  label: string;
  onClick?: (connections: Connection[], topicName: string) => void;
}

// Board state
export interface BoardFilters {
  searchQuery: string;
  activeTopics: Set<TopicName>;
  showMinorEntities: boolean;
  showWordClouds: boolean;
}

// Seed data structure
export interface SeedData {
  entities: Entity[];
  topics: Topic[];
  dataPoints: DataPoint[];
  connections: Connection[];
}
