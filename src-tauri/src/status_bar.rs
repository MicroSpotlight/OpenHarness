use std::collections::HashSet;

use serde::Deserialize;

pub(crate) const TOP_SESSION_LIMIT: usize = 5;
pub(crate) const HISTORY_SESSION_LIMIT: usize = 20;
const SNAPSHOT_LIMIT: usize = 5_000;
const TEXT_LIMIT: usize = 256;

#[derive(Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SessionMenuSnapshot {
    pub(crate) revision: u64,
    pub(crate) ready: bool,
    pub(crate) sessions: Vec<SessionMenuEntry>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SessionMenuEntry {
    pub(crate) id: String,
    pub(crate) title: String,
    pub(crate) workspace: Option<String>,
    pub(crate) updated_at: u64,
    pub(crate) running: bool,
    pub(crate) completed: bool,
    pub(crate) pending_interaction: Option<String>,
}

fn priority(session: &SessionMenuEntry) -> u8 {
    match session.pending_interaction.as_deref() {
        Some("approval") => 0,
        Some("question" | "plan-review") => 1,
        _ if session.running => 2,
        _ if session.completed => 3,
        _ => 4,
    }
}

pub(crate) fn select_sessions(
    sessions: &[SessionMenuEntry],
) -> (Vec<&SessionMenuEntry>, Vec<&SessionMenuEntry>) {
    let mut ranked = sessions.iter().collect::<Vec<_>>();
    ranked.sort_by(|a, b| {
        priority(a)
            .cmp(&priority(b))
            .then_with(|| b.updated_at.cmp(&a.updated_at))
            .then_with(|| a.id.cmp(&b.id))
    });
    let top = ranked
        .into_iter()
        .take(TOP_SESSION_LIMIT)
        .collect::<Vec<_>>();
    let top_ids = top
        .iter()
        .map(|session| session.id.as_str())
        .collect::<HashSet<_>>();
    let mut history = sessions
        .iter()
        .filter(|session| !top_ids.contains(session.id.as_str()))
        .collect::<Vec<_>>();
    history.sort_by(|a, b| {
        b.updated_at
            .cmp(&a.updated_at)
            .then_with(|| a.id.cmp(&b.id))
    });
    history.truncate(HISTORY_SESSION_LIMIT);
    (top, history)
}

fn validate_text(label: &str, value: &str, allow_empty: bool) -> Result<(), String> {
    if (!allow_empty && value.is_empty()) || value.chars().count() > TEXT_LIMIT {
        return Err(format!("invalid {label}"));
    }
    Ok(())
}

pub(crate) fn validate_snapshot(snapshot: &SessionMenuSnapshot) -> Result<(), String> {
    if snapshot.sessions.len() > SNAPSHOT_LIMIT {
        return Err("DSH session snapshot is too large".to_string());
    }
    let mut ids = HashSet::with_capacity(snapshot.sessions.len());
    for session in &snapshot.sessions {
        validate_text("session id", &session.id, false)?;
        if session.id.chars().any(char::is_control) {
            return Err("invalid session id".to_string());
        }
        validate_text("session title", &session.title, true)?;
        if let Some(workspace) = session.workspace.as_deref() {
            validate_text("workspace title", workspace, true)?;
        }
        if !ids.insert(session.id.as_str()) {
            return Err("DSH session snapshot contains duplicate ids".to_string());
        }
        if !matches!(
            session.pending_interaction.as_deref(),
            None | Some("approval" | "question" | "plan-review")
        ) {
            return Err("unsupported pending interaction".to_string());
        }
    }
    Ok(())
}
