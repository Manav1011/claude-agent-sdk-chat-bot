export async function fetchProjects() {
  const res = await fetch('/api/projects');
  if (!res.ok) throw new Error('Failed to fetch projects');
  return res.json();
}

export async function fetchWorkspace() {
  const res = await fetch('/api/workspace');
  if (!res.ok) throw new Error('Failed to fetch workspace');
  return res.json();
}

export async function createProject(name, path) {
  const res = await fetch('/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, path }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.detail || 'Failed to add project');
  }
  return data;
}

export async function deleteProjectApi(projectId) {
  const res = await fetch(`/api/projects/${projectId}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete project');
  return res.json();
}

export async function fetchProjectSessions(projectId) {
  const res = await fetch(`/api/projects/${projectId}/sessions`);
  if (!res.ok) throw new Error('Failed to fetch sessions');
  return res.json();
}

export async function fetchSessionMessages(threadId, projectId = null, cursor = null, limit = 50) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (projectId) params.append('project_id', String(projectId));
  if (cursor !== null && cursor !== undefined) params.append('cursor', String(cursor));

  const res = await fetch(`/api/sessions/${threadId}/messages?${params.toString()}`);
  if (!res.ok) throw new Error('Failed to fetch session messages');
  return res.json();
}

export async function deleteSessionApi(threadId) {
  const res = await fetch(`/api/sessions/${threadId}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete session');
  return res.json();
}

export async function fetchPendingPermissions(threadId = null) {
  const url = threadId ? `/api/permissions/pending?thread_id=${encodeURIComponent(threadId)}` : '/api/permissions/pending';
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to fetch pending permissions');
  return res.json();
}

export async function submitPermissionDecision({ requestId, decision, updatedInput, answers, message }) {
  const res = await fetch('/api/permissions/decision', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      request_id: requestId,
      decision,
      updated_input: updatedInput || null,
      answers: answers || null,
      message: message || null,
    }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || 'Failed to submit permission decision');
  }
  return res.json();
}

export async function* streamChatApi({
  message,
  threadId,
  projectId,
  speechExplanation,
  settingSources,
  skillsMode,
  skillsList,
  permissionMode,
  signal,
}) {
  let skillsPayload = null;
  if (skillsMode === 'none') {
    skillsPayload = [];
  } else if (skillsMode === 'custom') {
    skillsPayload = Array.isArray(skillsList) ? skillsList : [];
  }

  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      thread_id: threadId,
      project_id: projectId || null,
      speech_explanation: Boolean(speechExplanation),
      setting_sources: settingSources,
      skills: skillsPayload,
      permission_mode: permissionMode,
    }),
    signal,
  });

  if (!response.ok) {
    throw new Error(`Server returned error ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() || '';

      for (const part of parts) {
        const lines = part.split('\n');
        let currentEvent = null;
        let eventData = null;

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith('data: ')) {
            try {
              eventData = JSON.parse(line.slice(6).trim());
            } catch (e) {
              console.error('Failed to parse SSE data:', e);
            }
          }
        }

        if (currentEvent && eventData !== null) {
          yield { event: currentEvent, data: eventData };
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
