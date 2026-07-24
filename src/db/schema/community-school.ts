import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { schools } from './core.js';

export const schoolProfiles = pgTable('school_profiles', {
  schoolId: uuid('school_id')
    .primaryKey()
    .references(() => schools.id, { onDelete: 'cascade' }),
  address: text('address').notNull().default(''),
  rating: text('rating').notNull().default('—'),
  description: text('description').array().notNull().default(sql`'{}'::text[]`),
  rulesIntro: text('rules_intro').notNull().default(''),
  rules: text('rules').array().notNull().default(sql`'{}'::text[]`),
  logoPath: text('logo_path'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const schoolGalleryItems = pgTable(
  'school_gallery_items',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    schoolId: uuid('school_id')
      .notNull()
      .references(() => schools.id, { onDelete: 'cascade' }),
    objectPath: text('object_path').notNull(),
    altText: text('alt_text').notNull(),
    sortOrder: integer('sort_order').notNull(),
    isPublished: boolean('is_published').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('school_gallery_items_school_object_unique').on(table.schoolId, table.objectPath),
    unique('school_gallery_items_school_sort_order_unique').on(table.schoolId, table.sortOrder),
    index('school_gallery_visible_index')
      .on(table.schoolId, table.sortOrder)
      .where(sql`${table.isPublished}`),
  ],
);

export const communitySchoolSchema = {
  schoolGalleryItems,
  schoolProfiles,
};
