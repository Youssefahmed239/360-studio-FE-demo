import type { TourProject } from '../types/project';

export function exportProjectJson(project: TourProject) {
  const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${slugify(project.name)}.360studio.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function importProjectJson(file: File): Promise<TourProject> {
  const parsed: unknown = JSON.parse(await file.text());
  if (!parsed || typeof parsed !== 'object') throw new Error('This file is not a valid 360 Studio project.');
  const project = parsed as Partial<TourProject>;
  if (project.schemaVersion !== 1 || typeof project.id !== 'string' || typeof project.name !== 'string' || !Array.isArray(project.scenes) || !Array.isArray(project.assets) || !project.settings) {
    throw new Error('Unsupported or invalid project format. Expected schema version 1.');
  }
  return project as TourProject;
}

function slugify(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || '360-studio-project';
}
