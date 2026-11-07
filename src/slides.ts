import { SLIDE_WIDTH } from './model';
import type { Project } from './model';
import { photoBounds } from './selection';

export function reorderSlides(project: Project, fromSlide: number, toSlide: number): Project {
  if (!Number.isInteger(fromSlide) || !Number.isInteger(toSlide)
    || fromSlide < 0 || fromSlide >= project.slides
    || toSlide < 0 || toSlide >= project.slides || fromSlide === toSlide) return project;

  const groups = new Map<string, { left: number; right: number }>();
  for (const photo of project.photos) {
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

  return {
    ...project,
    photos: project.photos.map((photo) => {
      const group = photo.groupId ? groups.get(photo.groupId) : undefined;
      const bounds = group ? undefined : photoBounds(photo);
      const centre = group ? (group.left + group.right) / 2 : bounds!.x + bounds!.width / 2;
      // Centres on a seam belong to the slide on its right; off-strip centres use the nearest edge.
      const slide = Math.max(0, Math.min(project.slides - 1, Math.floor(centre / SLIDE_WIDTH)));
      let nextSlide = slide;
      if (slide === fromSlide) nextSlide = toSlide;
      else if (fromSlide < toSlide && slide > fromSlide && slide <= toSlide) nextSlide--;
      else if (fromSlide > toSlide && slide >= toSlide && slide < fromSlide) nextSlide++;
      const offset = (nextSlide - slide) * SLIDE_WIDTH;
      return offset === 0 ? photo : { ...photo, x: photo.x + offset };
    }),
  };
}
