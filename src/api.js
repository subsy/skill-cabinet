const headers = { Accept: "application/json" };

async function json(resPromise) {
  const res = await resPromise;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || res.statusText);
  }
  return data;
}

export function fetchCatalog(refresh = false) {
  return json(
    fetch(`/api/skills${refresh ? "?refresh=1" : ""}`, { headers }),
  );
}

export function fetchSkill(id) {
  return json(fetch(`/api/skills/${id}`, { headers }));
}

export function fetchSkillFile(id, relPath) {
  const q = new URLSearchParams({ path: relPath });
  return json(fetch(`/api/skills/${id}/file?${q}`, { headers }));
}

export function quarantineSkills(ids) {
  return json(
    fetch("/api/skills/quarantine", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    }),
  );
}
