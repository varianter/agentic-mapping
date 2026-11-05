import { sheetEditorRoutes } from '../shell/sheetEditor';

// Maps people filled in on their own; the interviewer can read them and add private notes.
export const submissionRoutes = sheetEditorRoutes({ kind: 'submissions', source: 'self' });
