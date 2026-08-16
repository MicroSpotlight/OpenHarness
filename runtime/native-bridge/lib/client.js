window.__ModuleLoader__.load({
  id: "@openharness/native-bridge",
  factory: () => {
    const module = { exports: {} };
    const exports = module.exports;
    const inject = ["sessions", "workspaces"];

    function apply(ctx) {
      const sessions = ctx.get("sessions");
      const workspaces = ctx.get("workspaces");
      let revision = 0;
      let publishQueued = false;

      const publish = () => {
        publishQueued = false;
        const sessionState = sessions.list.getSnapshot();
        const workspaceState = workspaces.list.getSnapshot();
        const archived = new Set(workspaceState.archivedSessionIds);
        const workspaceBySession = new Map();

        for (const workspace of workspaceState.items) {
          for (const sessionId of workspace.sessionIds) {
            workspaceBySession.set(sessionId, workspace.title);
          }
        }

        const rows = [];
        for (const id of sessionState.ids) {
          const session = sessionState.byId[id];
          if (
            session === undefined ||
            session.blank ||
            session.origin === "subagent" ||
            archived.has(id)
          ) {
            continue;
          }
          rows.push({
            id,
            title: session.displayTitle,
            workspace: workspaceBySession.get(id),
            updatedAt: session.updatedAt,
            running: session.running,
            completed: session.completed === true,
            pendingInteraction: session.pendingInteraction,
          });
        }

        window.dispatchEvent(
          new CustomEvent("openharness:dsh-sessions", {
            detail: {
              revision: ++revision,
              ready: sessionState.phase === "ready" && workspaceState.baselinesReady,
              sessions: rows,
            },
          }),
        );
      };

      const schedulePublish = () => {
        if (publishQueued) return;
        publishQueued = true;
        queueMicrotask(publish);
      };

      const handleNativeAction = (event) => {
        const action = event.detail;
        if (action?.type === "new-session") {
          workspaces.startSession();
          return;
        }
        if (action?.type !== "open-session" || typeof action.sessionId !== "string") return;
        const session = sessions.list.getSnapshot().byId[action.sessionId];
        if (session !== undefined && session.origin !== "subagent") {
          sessions.open(action.sessionId);
        }
      };

      ctx.effect(() => {
        const unsubscribeSessions = sessions.list.subscribe(schedulePublish);
        const unsubscribeWorkspaces = workspaces.list.subscribe(schedulePublish);
        window.addEventListener("openharness:native-action", handleNativeAction);
        schedulePublish();
        return () => {
          unsubscribeSessions();
          unsubscribeWorkspaces();
          window.removeEventListener("openharness:native-action", handleNativeAction);
        };
      }, "OpenHarness native Status Bar bridge");
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
