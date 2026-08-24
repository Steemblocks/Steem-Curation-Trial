const API_BASE = '/api';

export async function fetchStatus() {
  const res = await fetch(`${API_BASE}/status`);
  return res.json();
}

export async function fetchLeader() {
  const res = await fetch(`${API_BASE}/leader`);
  return res.json();
}

export async function fetchMembers() {
  const res = await fetch(`${API_BASE}/members`);
  return res.json();
}

export async function fetchLogs(limit = 50) {
  const res = await fetch(`${API_BASE}/logs?limit=${limit}`);
  return res.json();
}

export async function joinTrial(data) {
  const res = await fetch(`${API_BASE}/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  return res.json();
}

export async function updateSettings(data) {
  const res = await fetch(`${API_BASE}/settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  return res.json();
}

export async function toggleTrialStatus(username, status) {
  const res = await fetch(`${API_BASE}/toggle-status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, status })
  });
  return res.json();
}

export async function leaveTrial(username) {
  const res = await fetch(`${API_BASE}/leave`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username })
  });
  return res.json();
}

export async function fetchUser(username) {
  const res = await fetch(`${API_BASE}/user/${username}`);
  return res.json();
}

export async function simulateTestVote(author, permlink, weight = 100) {
  const res = await fetch(`${API_BASE}/simulate-vote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ author, permlink, weight })
  });
  return res.json();
}
