export function idsForShelfAction(ids, skills, mode) {
  const byId = new Map(skills.map((skill) => [skill.id, skill]));
  return ids.filter((id) => {
    const skill = byId.get(id);
    if (!skill) return false;
    if (mode === "restore") return Boolean(skill.quarantined);
    if (mode === "quarantine") return !skill.quarantined;
    return true;
  });
}

export function crossingQuarantineShelf(fromScopeId, toScopeId) {
  return (fromScopeId === "quarantine") !== (toScopeId === "quarantine");
}
