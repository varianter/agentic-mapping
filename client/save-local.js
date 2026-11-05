// Offers anonymous browser models to a signed-in account. Pure: storage adapters are passed in.
const filledValue = (value) => Array.isArray(value) ? value.some((item) => item.trim()) : typeof value === 'string' && value.trim() !== '';
export const isFilled = (sheet) => Object.entries(sheet?.fields ?? {}).some(([key, value]) => key !== 'date' && filledValue(value));

export async function filledLocalModels(local) {
  return (await local.allSheets()).filter(isFilled).sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

// Uploads in order. A 409 (different content already stored) skips that model and goes on;
// any other failure stops the run. Each local copy is deleted only after its
// upload succeeds; an identical retry is a 200 on the server, so nothing is duplicated.
export async function saveLocalModels(local, server, models) {
  let saved = 0;
  let error = null;
  const remaining = [];
  const conflicts = [];
  for (const model of models) {
    try {
      await server.createSheet({ id: model.id, fields: model.fields, createdAt: model.createdAt, updatedAt: model.updatedAt });
      await local.deleteSheet(model);
      saved += 1;
    } catch (reason) {
      remaining.push(model);
      if (reason?.status === 409) { conflicts.push(model); continue; }
      error = reason;
      remaining.push(...models.slice(models.indexOf(model) + 1));
      break;
    }
  }
  return { saved, total: models.length, error, conflicts, remaining };
}
