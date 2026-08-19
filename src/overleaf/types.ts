export type EntityType = "doc" | "file" | "folder";

export interface ProjectSummary {
  id: string;
  name: string;
  lastUpdated?: string;
  owner?: string;
  archived?: boolean;
  trashed?: boolean;
  accessLevel?: string;
}

export interface CompileOutputFile {
  path: string;
  url: string;
  type?: string;
  build?: string;
}

export interface CompileResult {
  status: string;
  outputFiles: CompileOutputFile[];
  compileGroup?: string;
  clsiServerId?: string;
}

export interface UploadResult {
  success: boolean;
  entity_id?: string;
  entity_type?: string;
}

export interface EntitiesResult {
  project_id: string;
  entities: { path: string; type: "doc" | "file" }[];
}

export interface UpdateMetaUser {
  first_name?: string;
  last_name?: string;
  email?: string;
  id?: string;
}

export interface UpdateMeta {
  users?: UpdateMetaUser[];
  start_ts?: number;
  end_ts?: number;
}

export interface ProjectUpdate {
  fromV: number;
  toV: number;
  pathnames: string[];
  meta?: UpdateMeta;
}

export interface UpdatesResult {
  updates: ProjectUpdate[];
}

export interface DiffSegment {
  u?: string;
  i?: string;
  d?: string;
  meta?: UpdateMeta;
}

export interface RawDoc {
  _id: string;
  name: string;
}

export interface RawFileRef {
  _id: string;
  name: string;
  hash?: string;
  created?: string;
}

export interface RawFolder {
  _id: string;
  name: string;
  folders: RawFolder[];
  fileRefs: RawFileRef[];
  docs: RawDoc[];
}

export interface JoinedProject {
  _id: string;
  name: string;
  rootDoc_id?: string;
  rootFolder: RawFolder[];
  compiler?: string;
  imageName?: string;
  spellCheckLanguage?: string;
  publicAccesLevel?: string;
}

export interface JoinProjectResult {
  project: JoinedProject;
  permissionsLevel: string;
  protocolVersion: number;
}

export interface TreeEntry {
  path: string;
  name: string;
  type: EntityType;
  id: string;
  hash?: string;
  parentFolderId: string;
}

export interface ProjectTree {
  projectId: string;
  name: string;
  rootFolderId: string;
  rootDocId?: string;
  compiler?: string;
  entries: TreeEntry[];
}

export interface GrepHit {
  path: string;
  line: number;
  text: string;
}
