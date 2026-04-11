import { describe, expect, it, vi } from "vitest";
import os from "node:os";
import path from "node:path";

const setCurrentProject = vi.hoisted(() => vi.fn());
const getCurrentProjectPath = vi.hoisted(() => vi.fn(() => null));
const openProjectSession = vi.hoisted(() => vi.fn(() => ({ id: "session-1" })));

vi.mock("../project-context.js", () => ({
  setCurrentProject,
  getCurrentProjectPath,
}));

vi.mock("../project-session.js", () => ({
  openProjectSession,
}));

import { registerProjectHandlers } from "./project.handlers.js";

function resetCommon() {
  vi.clearAllMocks();
  setCurrentProject.mockReset();
  getCurrentProjectPath.mockReset();
  getCurrentProjectPath.mockReturnValue(null);
  openProjectSession.mockReset();
  openProjectSession.mockReturnValue({ id: "session-1" });
}

function registerHandlers(
  projectFS?: Record<string, unknown>,
  db?: Record<string, unknown>,
  cas?: Record<string, unknown>,
) {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();

  registerProjectHandlers(
    {
      handle(channel: string, handler: (...args: unknown[]) => unknown) {
        handlers.set(channel, handler);
      },
    } as never,
    (projectFS ?? {
      createProject: vi.fn(),
      openProject: vi.fn(),
      saveProject: vi.fn(),
      listRecentProjects: vi.fn(),
      createSnapshot: vi.fn(),
      listSnapshots: vi.fn(),
      restoreSnapshot: vi.fn(),
    }) as never,
    (db ?? {
      upsertProject: vi.fn(),
      syncFromJson: vi.fn(),
    }) as never,
    (cas ?? {
      setProjectRoot: vi.fn(),
    }) as never,
  );

  return handlers;
}

describe("registerProjectHandlers", () => {
  it("registers all project IPC handlers", () => {
    resetCommon();
    const handlers = registerHandlers();

    expect([...handlers.keys()].sort()).toEqual([
      "project:create",
      "project:list",
      "project:open",
      "project:save",
      "project:snapshot",
      "project:snapshot:list",
      "project:snapshot:restore",
    ]);
  });

  it("creates a project inside the user home, opens a session, and persists the recent-project record", async () => {
    resetCommon();
    const projectPath = path.join(os.homedir(), "LucidFin", "pilot");
    const manifest = {
      id: "project-1",
      title: "Pilot",
      updatedAt: 123,
    };
    const projectFS = {
      createProject: vi.fn(() => ({ manifest, projectPath })),
      openProject: vi.fn(),
      saveProject: vi.fn(),
      listRecentProjects: vi.fn(),
      createSnapshot: vi.fn(),
      listSnapshots: vi.fn(),
      restoreSnapshot: vi.fn(),
    };
    const db = {
      upsertProject: vi.fn(),
      syncFromJson: vi.fn(),
    };
    const cas = {
      setProjectRoot: vi.fn(),
    };
    const handlers = registerHandlers(projectFS, db, cas);
    const create = handlers.get("project:create");

    const result = await create?.({}, {
      title: "Pilot",
      basePath: projectPath,
    });

    expect(projectFS.createProject).toHaveBeenCalledWith({
      title: "Pilot",
      basePath: projectPath,
    });
    expect(setCurrentProject).toHaveBeenCalledWith("project-1", projectPath);
    expect(openProjectSession).toHaveBeenCalledWith("project-1", projectPath);
    expect(cas.setProjectRoot).toHaveBeenCalledWith(projectPath);
    expect(db.upsertProject).toHaveBeenCalledWith({
      id: "project-1",
      title: "Pilot",
      path: projectPath,
      updatedAt: 123,
    });
    expect(result).toEqual({
      id: "project-1",
      title: "Pilot",
      updatedAt: 123,
      sessionId: "session-1",
    });
  });

  it("rejects project creation when title is missing or basePath escapes the home directory", async () => {
    resetCommon();
    const handlers = registerHandlers();
    const create = handlers.get("project:create");

    await expect(create?.({}, { title: "" })).rejects.toThrow("title is required");
    await expect(
      create?.({}, { title: "Pilot", basePath: "C:\\outside-home" }),
    ).rejects.toThrow("basePath must be within user home directory");
  });

  it("opens an existing project, hydrates sqlite from disk, and rejects out-of-home paths", async () => {
    resetCommon();
    const openPath = path.join(os.homedir(), "LucidFin", "existing");
    const manifest = {
      id: "project-2",
      title: "Existing",
      updatedAt: 456,
    };
    const projectFS = {
      createProject: vi.fn(),
      openProject: vi.fn(() => manifest),
      saveProject: vi.fn(),
      listRecentProjects: vi.fn(),
      createSnapshot: vi.fn(),
      listSnapshots: vi.fn(),
      restoreSnapshot: vi.fn(),
    };
    const db = {
      upsertProject: vi.fn(),
      syncFromJson: vi.fn(),
    };
    const cas = {
      setProjectRoot: vi.fn(),
    };
    const handlers = registerHandlers(projectFS, db, cas);
    const open = handlers.get("project:open");

    await expect(open?.({}, { path: "C:\\outside-home" })).rejects.toThrow(
      "path must be within user home directory",
    );

    const result = await open?.({}, { path: openPath });

    expect(projectFS.openProject).toHaveBeenCalledWith(openPath);
    expect(setCurrentProject).toHaveBeenCalledWith("project-2", openPath);
    expect(openProjectSession).toHaveBeenCalledWith("project-2", openPath);
    expect(cas.setProjectRoot).toHaveBeenCalledWith(openPath);
    expect(db.syncFromJson).toHaveBeenCalledWith(openPath);
    expect(result).toEqual({
      id: "project-2",
      title: "Existing",
      updatedAt: 456,
      sessionId: "session-1",
    });
  });

  it("saves the current project manifest and fails fast when no project is open", async () => {
    resetCommon();
    const projectFS = {
      createProject: vi.fn(),
      openProject: vi.fn(() => ({ id: "project-3", title: "Current", updatedAt: 789 })),
      saveProject: vi.fn(),
      listRecentProjects: vi.fn(),
      createSnapshot: vi.fn(),
      listSnapshots: vi.fn(),
      restoreSnapshot: vi.fn(),
    };
    const handlers = registerHandlers(projectFS);
    const save = handlers.get("project:save");

    await expect(save?.({})).rejects.toThrow("No project open");

    getCurrentProjectPath.mockReturnValue("C:\\Users\\nainf\\Projects\\current");
    await expect(save?.({})).resolves.toBeUndefined();

    expect(projectFS.openProject).toHaveBeenCalledWith("C:\\Users\\nainf\\Projects\\current");
    expect(projectFS.saveProject).toHaveBeenCalledWith(
      "C:\\Users\\nainf\\Projects\\current",
      expect.objectContaining({ id: "project-3" }),
    );
  });

  it("lists projects and manages snapshots with path and id validation", async () => {
    resetCommon();
    getCurrentProjectPath.mockReturnValue("C:\\Users\\nainf\\Projects\\current");
    const projectFS = {
      createProject: vi.fn(),
      openProject: vi.fn(),
      saveProject: vi.fn(),
      listRecentProjects: vi.fn(() => [{ id: "project-1" }]),
      createSnapshot: vi.fn(() => ({ id: "snapshot-1" })),
      listSnapshots: vi.fn(() => [{ id: "snapshot-1" }]),
      restoreSnapshot: vi.fn(),
    };
    const db = {
      upsertProject: vi.fn(),
      syncFromJson: vi.fn(),
    };
    const handlers = registerHandlers(projectFS, db);

    await expect(handlers.get("project:list")?.({})).resolves.toEqual([{ id: "project-1" }]);
    await expect(
      handlers.get("project:snapshot")?.({}, { name: "checkpoint" }),
    ).resolves.toEqual({ id: "snapshot-1" });
    await expect(handlers.get("project:snapshot:list")?.({})).resolves.toEqual([{ id: "snapshot-1" }]);
    await expect(
      handlers.get("project:snapshot:restore")?.({}, { snapshotId: "invalid/../id" }),
    ).rejects.toThrow("Invalid snapshotId");
    await expect(
      handlers.get("project:snapshot:restore")?.({}, { snapshotId: "snapshot-1" }),
    ).resolves.toBeUndefined();

    expect(projectFS.createSnapshot).toHaveBeenCalledWith(
      "C:\\Users\\nainf\\Projects\\current",
      "checkpoint",
      db,
    );
    expect(projectFS.restoreSnapshot).toHaveBeenCalledWith(
      "C:\\Users\\nainf\\Projects\\current",
      "snapshot-1",
      db,
    );
  });
});
