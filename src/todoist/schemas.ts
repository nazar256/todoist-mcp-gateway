import { z } from 'zod';
import { TODOIST_COLOR_NAMES } from './colors';

const colorEnum = z.enum([...TODOIST_COLOR_NAMES] as [string, ...string[]]);

export const taskSelectorSchema = {
  task_id: z.string().optional(),
  task_name: z.string().optional(),
};

export const projectSelectorSchema = {
  id: z.string().optional(),
  name: z.string().optional(),
};

export const projectMutationSelectorSchema = {
  id: z.string().optional(),
  project_name: z.string().optional(),
};

export const sectionSelectorSchema = {
  id: z.string().optional(),
  name: z.string().optional(),
};

export const sectionMutationSelectorSchema = {
  id: z.string().optional(),
  section_name: z.string().optional(),
};

export const labelSelectorSchema = {
  id: z.string().optional(),
  name: z.string().optional(),
};

export const labelMutationSelectorSchema = {
  id: z.string().optional(),
  label_name: z.string().optional(),
};

export const createTaskFields = {
  content: z.string(),
  description: z.string().optional(),
  project_id: z.string().optional(),
  section_id: z.string().optional(),
  parent_id: z.string().optional(),
  labels: z.array(z.string()).optional(),
  priority: z.number().int().min(1).max(4).optional(),
  due_string: z.string().optional(),
  due_date: z.string().optional(),
  due_datetime: z.string().optional(),
  due_lang: z.string().optional(),
  assignee_id: z.string().optional(),
  duration: z.number().int().positive().optional(),
  duration_unit: z.enum(['minute', 'day']).optional(),
  deadline_date: z.string().optional(),
};

export const createProjectFields = {
  name: z.string(),
  parent_id: z.string().optional(),
  color: colorEnum.optional(),
  is_favorite: z.boolean().optional(),
  view_style: z.enum(['list', 'board']).optional(),
};

export const createSectionFields = {
  name: z.string(),
  project_id: z.string(),
  order: z.number().int().optional(),
};

export const createCommentFields = {
  task_id: z.string().optional(),
  project_id: z.string().optional(),
  content: z.string(),
};

export const createLabelFields = {
  name: z.string(),
  color: colorEnum.optional(),
  order: z.number().int().optional(),
  is_favorite: z.boolean().optional(),
};
