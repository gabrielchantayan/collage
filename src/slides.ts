import { SLIDE_WIDTH } from './model';
import type { Photo, Project } from './model';
import { photoBounds } from './selection';

type GroupBounds = Map<string, { left: number; right: number }>;

function groupBounds(photos: Photo[]): GroupBounds {
  const groups: GroupBounds = new Map();
  for (const photo of photos) {
    if (!photo.groupId) continue;
    const bounds = photoBounds(photo);
    const group = groups.get(photo.groupId);
    if (group) {
      group.left = Math.min(group.left, bounds.x);
      group.right = Math.max(group.right, bounds.x + bounds.width);
    } else {
      groups.set(photo.groupId, { left: bounds.x, right: bounds.x + bounds.width });
    }
  }
  return groups;
}

function ownerSlide(photo: Photo, slides: number, groups: GroupBounds): number {
  const group = photo.groupId ? groups.get(photo.groupId) : undefined;
  let centre: number;
  if (group) centre = (group.left + group.right) / 2;
  else {
    const bounds = photoBounds(photo);
    centre = bounds.x + bounds.width / 2;
  }
  // Centres on a seam belong to the slide on its right; off-strip centres use the nearest edge.
  return Math.max(0, Math.min(slides - 1, Math.floor(centre / SLIDE_WIDTH)));
}

export function reorderSlides(project: Project, fromSlide: number, toSlide: number): Project {
  if (!Number.isInteger(fromSlide) || !Number.isInteger(toSlide)
    || fromSlide < 0 || fromSlide >= project.slides
    || toSlide < 0 || toSlide >= project.slides || fromSlide === toSlide) return project;
  const groups = groupBounds(project.photos);
  return {
    ...project,
    photos: project.photos.map((photo) => {
      const slide = ownerSlide(photo, project.slides, groups);
      let nextSlide = slide;
      if (slide === fromSlide) nextSlide = toSlide;
      else if (fromSlide < toSlide && slide > fromSlide && slide <= toSlide) nextSlide--;
      else if (fromSlide > toSlide && slide >= toSlide && slide < fromSlide) nextSlide++;
      const offset = (nextSlide - slide) * SLIDE_WIDTH;
      return offset === 0 ? photo : { ...photo, x: photo.x + offset };
    }),
  };
}

export function deleteSlide(project: Project, index: number): Project {
  if (project.slides <= 1 || !Number.isInteger(index) || index < 0 || index >= project.slides) return project;
  const groups = groupBounds(project.photos);
  const photos: Photo[] = [];
  for (const photo of project.photos) {
    const slide = ownerSlide(photo, project.slides, groups);
    if (slide === index) continue;
    photos.push(slide > index ? { ...photo, x: photo.x - SLIDE_WIDTH } : photo);
  }
  return { ...project, slides: project.slides - 1, photos };
}
