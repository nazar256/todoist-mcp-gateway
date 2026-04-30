export interface TodoistTask {
  id: string;
  content: string;
  description?: string;
  project_id?: string;
  section_id?: string;
  parent_id?: string;
  labels?: string[];
  priority?: number;
}

export interface TodoistProject {
  id: string;
  name: string;
  parent_id?: string | null;
  order?: number;
  description?: string;
  is_inbox_project?: boolean;
  is_shared?: boolean;
  view_style?: string;
}

export interface TodoistSection {
  id: string;
  name: string;
  project_id: string;
}

export interface TodoistComment {
  id: string;
  content: string;
  task_id?: string;
  project_id?: string;
}

export interface TodoistLabel {
  id: string;
  name: string;
  color?: string;
}

export interface SyncCommand {
  type: string;
  uuid: string;
  args: Record<string, unknown>;
}

export interface TodoistConfig {
  v: 1;
  todoistApiToken: string;
}
