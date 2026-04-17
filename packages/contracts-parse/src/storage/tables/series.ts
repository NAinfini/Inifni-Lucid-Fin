/**
 * Series + episodes — multi-project hierarchy.
 */
import { defineTable, col } from '../../tables.js';

export const SeriesTable = defineTable('series', {
  id: col<string>('id'),
  title: col<string>('title'),
  description: col<string | null>('description'),
  styleGuide: col<string | null>('style_guide'),
  episodeIds: col<string | null>('episode_ids'),
  createdAt: col<number>('created_at'),
  updatedAt: col<number>('updated_at'),
});

export const EpisodesTable = defineTable('episodes', {
  id: col<string>('id'),
  seriesId: col<string>('series_id'),
  title: col<string>('title'),
  episodeOrder: col<number>('episode_order'),
  status: col<string | null>('status'),
  createdAt: col<number>('created_at'),
  updatedAt: col<number>('updated_at'),
});
