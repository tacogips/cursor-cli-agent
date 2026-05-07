import { join } from "node:path";

import {
  createActivityManager,
  type ActivityListOptions,
} from "../activity/manager";
import { createBookmarkManager } from "../bookmarks/manager";
import { createTranscriptSearchService } from "../cursor/transcript-search";
import { createAiTrackingFileReader } from "../cursor/ai-tracking-reader";
import { createFileIntelligenceService } from "../file-intelligence";
import { deriveGroupProgressSnapshot } from "../group/progress";
import { deriveQueueProgressSnapshot } from "../queue/progress";
import { getCursorHome, getDataDir } from "../config/paths";
import { createActivityStore } from "../persistence/activity-store";
import { createBookmarksStore } from "../persistence/bookmarks-store";
import { FileIntelligenceIndex } from "../persistence/file-intelligence-index";
import * as groupsStore from "../persistence/groups-store";
import * as queuesStore from "../persistence/queues-store";
import { SessionIndexRepository } from "../persistence/session-index";
import type { ActivitySignal, SessionActivity } from "../types/activity";
import type {
  BookmarkFilter,
  BookmarkRecord,
  BookmarkSearchOptions,
  BookmarkSearchResult,
  CreateBookmarkInput,
} from "../types/bookmark";
import type {
  FileHistoryResult,
  FileIndexRebuildStats,
  FileSnapshotOptions,
  SessionDeletedFilesResult,
  SessionFileSnapshotResult,
  SessionFileSummary,
} from "../types/file-intelligence";
import type { GroupProgressSnapshot, GroupRecord } from "../types/group";
import type { QueueProgressSnapshot, QueueRecord } from "../types/queue";
import type { CursorSessionRecord } from "../types/session-record";
import type {
  SessionSearchOptions,
  SessionSearchResult,
} from "../types/session-search";
import type {
  TranscriptSearchOptions,
  TranscriptSearchResult,
} from "../types/transcript-search";
import type { CursorAgentSdkOptions } from "./types";

export interface SessionFacade {
  list(options?: {
    readonly limit?: number;
  }): Promise<readonly CursorSessionRecord[]>;
  get(sessionId: string): Promise<CursorSessionRecord | null>;
  refresh(): Promise<readonly CursorSessionRecord[]>;
}

export interface SearchFacade {
  sessions(options: SessionSearchOptions): Promise<SessionSearchResult>;
  transcripts(
    options: TranscriptSearchOptions,
  ): Promise<TranscriptSearchResult>;
}

export interface GroupFacade {
  list(): Promise<readonly GroupRecord[]>;
  get(name: string): Promise<GroupRecord | null>;
  create(name: string): Promise<GroupRecord>;
  addWorkspace(name: string, workspace: string): Promise<GroupRecord>;
  removeWorkspace(name: string, workspace: string): Promise<GroupRecord>;
  delete(name: string): Promise<GroupRecord | null>;
  pause(name: string): Promise<GroupRecord | null>;
  resume(name: string): Promise<GroupRecord | null>;
  progress(name: string): Promise<GroupProgressSnapshot | null>;
}

export interface QueueFacade {
  list(): Promise<readonly QueueRecord[]>;
  get(name: string): Promise<QueueRecord | null>;
  create(name: string, workspace: string): Promise<QueueRecord>;
  addItem(name: string, prompt: string): Promise<QueueRecord>;
  removeItem(name: string, itemId: string): Promise<QueueRecord>;
  delete(name: string): Promise<QueueRecord | null>;
  pause(name: string): Promise<QueueRecord | null>;
  resume(name: string): Promise<QueueRecord | null>;
  requestStop(name: string): Promise<QueueRecord | null>;
  progress(name: string): Promise<QueueProgressSnapshot | null>;
}

export interface BookmarkFacade {
  add(input: CreateBookmarkInput): Promise<BookmarkRecord>;
  list(filter?: BookmarkFilter): Promise<readonly BookmarkRecord[]>;
  show(id: string): Promise<BookmarkRecord | null>;
  delete(id: string): Promise<boolean>;
  search(
    query: string,
    options?: BookmarkSearchOptions,
  ): Promise<BookmarkSearchResult>;
}

export interface FileFacade {
  list(sessionId: string): Promise<SessionFileSummary>;
  snapshots(
    sessionId: string,
    options?: FileSnapshotOptions,
  ): Promise<SessionFileSnapshotResult>;
  deleted(sessionId: string): Promise<SessionDeletedFilesResult>;
  find(path: string): Promise<FileHistoryResult>;
  rebuild(): Promise<FileIndexRebuildStats>;
}

export interface ActivityFacade {
  get(sessionId: string): Promise<SessionActivity | null>;
  list(options?: ActivityListOptions): Promise<readonly SessionActivity[]>;
  recordSignal(sessionId: string, signal: ActivitySignal): Promise<void>;
}

interface FacadeFactoryResult {
  readonly sessions: SessionFacade;
  readonly search: SearchFacade;
  readonly groups: GroupFacade;
  readonly queues: QueueFacade;
  readonly bookmarks: BookmarkFacade;
  readonly files: FileFacade;
  readonly activity: ActivityFacade;
}

function dataPath(stateRoot: string, name: string): string {
  return join(stateRoot, name);
}

function nullIfMissing<T>(value: T | undefined): T | null {
  return value ?? null;
}

export function createDomainFacades(
  options: CursorAgentSdkOptions = {},
): FacadeFactoryResult {
  const stateRoot = options.stateRoot ?? getDataDir();
  const cursorHome = options.cursorHome ?? getCursorHome();
  const now = options.now ?? (() => new Date());
  const repository = new SessionIndexRepository(
    dataPath(stateRoot, "state.db"),
    { cursorProjectsRoot: join(cursorHome, "projects") },
  );
  const activityManager = createActivityManager({
    sessions: repository,
    store: createActivityStore(dataPath(stateRoot, "activity-signals.json")),
  });
  const bookmarkManager = createBookmarkManager({
    sessions: repository,
    store: createBookmarksStore(dataPath(stateRoot, "bookmarks.json")),
    now,
  });
  const fileService = createFileIntelligenceService({
    sessions: repository,
    aiTracking: createAiTrackingFileReader(
      join(cursorHome, "ai-tracking", "ai-code-tracking.db"),
    ),
    index: new FileIntelligenceIndex(
      dataPath(stateRoot, "file-intelligence.db"),
    ),
  });
  const transcriptSearch = createTranscriptSearchService(repository);
  const groupsPath = dataPath(stateRoot, "groups.json");
  const queuesPath = dataPath(stateRoot, "queues.json");
  const nowIso = (): string => now().toISOString();

  return {
    sessions: {
      async list(listOptions?: {
        readonly limit?: number;
      }): Promise<readonly CursorSessionRecord[]> {
        await repository.importTranscriptsFromFilesystem();
        return repository.listSessions(listOptions?.limit ?? 1000);
      },
      async get(sessionId: string): Promise<CursorSessionRecord | null> {
        await repository.importTranscriptsFromFilesystem();
        return repository.resolveSessionKey(sessionId) ?? null;
      },
      async refresh(): Promise<readonly CursorSessionRecord[]> {
        await repository.importTranscriptsFromFilesystem();
        return repository.listSessions(1000);
      },
    },
    search: {
      async sessions(
        options: SessionSearchOptions,
      ): Promise<SessionSearchResult> {
        await repository.importTranscriptsFromFilesystem();
        return repository.searchSessions(options);
      },
      async transcripts(
        options: TranscriptSearchOptions,
      ): Promise<TranscriptSearchResult> {
        await repository.importTranscriptsFromFilesystem();
        return transcriptSearch.search(options);
      },
    },
    groups: {
      list: () => groupsStore.listGroups(groupsPath),
      async get(name: string): Promise<GroupRecord | null> {
        return nullIfMissing(await groupsStore.getGroup(name, groupsPath));
      },
      create: (name: string) => groupsStore.createGroup(name, groupsPath),
      addWorkspace: (name: string, workspace: string) =>
        groupsStore.addWorkspaceToGroup(name, workspace, groupsPath),
      removeWorkspace: (name: string, workspace: string) =>
        groupsStore.removeWorkspaceFromGroup(name, workspace, groupsPath),
      async delete(name: string): Promise<GroupRecord | null> {
        return nullIfMissing(await groupsStore.deleteGroup(name, groupsPath));
      },
      async pause(name: string): Promise<GroupRecord | null> {
        return nullIfMissing(await groupsStore.pauseGroup(name, groupsPath));
      },
      async resume(name: string): Promise<GroupRecord | null> {
        return nullIfMissing(await groupsStore.resumeGroup(name, groupsPath));
      },
      async progress(name: string): Promise<GroupProgressSnapshot | null> {
        const group = await groupsStore.getGroup(name, groupsPath);
        if (group === undefined) {
          return null;
        }
        return deriveGroupProgressSnapshot(group, {
          getActivity: activityManager.getSessionActivity,
          now: nowIso,
        });
      },
    },
    queues: {
      list: () => queuesStore.listQueues(queuesPath),
      async get(name: string): Promise<QueueRecord | null> {
        return nullIfMissing(await queuesStore.getQueue(name, queuesPath));
      },
      create: (name: string, workspace: string) =>
        queuesStore.createQueue(name, workspace, queuesPath),
      addItem: (name: string, prompt: string) =>
        queuesStore.addQueueItem(name, prompt, queuesPath),
      removeItem: (name: string, itemId: string) =>
        queuesStore.removeQueueItem(name, itemId, queuesPath),
      async delete(name: string): Promise<QueueRecord | null> {
        return nullIfMissing(await queuesStore.deleteQueue(name, queuesPath));
      },
      async pause(name: string): Promise<QueueRecord | null> {
        return nullIfMissing(await queuesStore.pauseQueue(name, queuesPath));
      },
      async resume(name: string): Promise<QueueRecord | null> {
        return nullIfMissing(await queuesStore.resumeQueue(name, queuesPath));
      },
      async requestStop(name: string): Promise<QueueRecord | null> {
        return nullIfMissing(
          await queuesStore.requestQueueStop(name, queuesPath),
        );
      },
      async progress(name: string): Promise<QueueProgressSnapshot | null> {
        const queue = await queuesStore.getQueue(name, queuesPath);
        if (queue === undefined) {
          return null;
        }
        return deriveQueueProgressSnapshot(queue, {
          getActivity: activityManager.getSessionActivity,
          now: nowIso,
        });
      },
    },
    bookmarks: bookmarkManager,
    files: {
      list: (sessionId: string) => fileService.listFiles(sessionId),
      snapshots: (sessionId: string, snapshotOptions?: FileSnapshotOptions) =>
        fileService.listSnapshots(sessionId, snapshotOptions),
      deleted: (sessionId: string) => fileService.listDeleted(sessionId),
      find: (path: string) => fileService.findFile(path),
      rebuild: () => fileService.rebuild(),
    },
    activity: {
      get: (sessionId: string) => activityManager.getSessionActivity(sessionId),
      list: (activityOptions?: ActivityListOptions) =>
        activityManager.listActivity(activityOptions),
      recordSignal: (sessionId: string, signal: ActivitySignal) =>
        activityManager.recordSignal(sessionId, signal),
    },
  };
}
