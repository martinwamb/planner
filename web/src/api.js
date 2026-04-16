const BASE = '/api';

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    ...options,
  });
  if (res.status === 204) return null;
  const data = await res.json();
  if (!res.ok) throw Object.assign(new Error(data.error || 'Request failed'), { status: res.status });
  return data;
}

export const api = {
  // Auth
  me:           ()      => request('/auth/me'),
  login:        (body)  => request('/auth/login',    { method: 'POST', body: JSON.stringify(body) }),
  register:     (body)  => request('/auth/register', { method: 'POST', body: JSON.stringify(body) }),
  logout:       ()      => request('/auth/logout',   { method: 'POST' }),

  // Projects
  getProjects:    ()       => request('/projects'),
  getProject:     (id)     => request(`/projects/${id}`),
  createProject:  (body)   => request('/projects',    { method: 'POST', body: JSON.stringify(body) }),
  updateProject:  (id, b)  => request(`/projects/${id}`, { method: 'PUT', body: JSON.stringify(b) }),
  deleteProject:  (id)     => request(`/projects/${id}`, { method: 'DELETE' }),

  // Tags
  getTags:    ()       => request('/tags'),
  createTag:  (body)   => request('/tags',    { method: 'POST', body: JSON.stringify(body) }),
  deleteTag:  (id)     => request(`/tags/${id}`, { method: 'DELETE' }),

  // Tasks
  getTasks:       (projectId)  => request(`/projects/${projectId}/tasks`),
  createTask:     (pid, body)  => request(`/projects/${pid}/tasks`, { method: 'POST', body: JSON.stringify(body) }),
  updateTask:     (id, body)   => request(`/tasks/${id}`,           { method: 'PUT',  body: JSON.stringify(body) }),
  moveTask:       (id, status) => request(`/tasks/${id}/status`,    { method: 'PATCH', body: JSON.stringify({ status }) }),
  deleteTask:     (id)         => request(`/tasks/${id}`,           { method: 'DELETE' }),
  toggleChecklist:(id, checked)=> request(`/checklist/${id}`,       { method: 'PATCH', body: JSON.stringify({ checked }) }),

  // AI
  enhanceTask:        (body) => request('/ai/enhance-task',        { method: 'POST', body: JSON.stringify(body) }),
  suggestPriorities:  ()     => request('/ai/suggest-priorities',  { method: 'POST' }),
  sendWeeklyDigest:   ()     => request('/ai/weekly-digest',       { method: 'POST' }),
  getDailyPlan:       (date) => request('/ai/daily-plan',          { method: 'POST', body: JSON.stringify({ date }) }),
};
