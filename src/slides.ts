import { SLIDE_WIDTH } from './model';
import type { Photo, Project } from './model';

export interface SlideBlock { start: number; end: number }

function photoSlides(photo: Photo, slides: number): SlideBlock {
  const angle = photo.rotation * Math.PI / 180;
  // Exact quarter turns should not create a microscopic overlap across a seam.
  let cosine = Math.cos(angle);
  let sine = Math.sin(angle);
  if (Math.abs(cosine) < 1e-12) cosine = 0;
  if (Math.abs(sine) < 1e-12) sine = 0;
  const dx = photo.width * cosine;
  const dy = -photo.height * sine;
  const left = photo.x + Math.min(0, dx, dy, dx + dy);
  const right = photo.x + Math.max(0, dx, dy, dx + dy);
  // Positive overlap only: an edge ending on a seam belongs to the previous slide.
  // Off-canvas artwork travels with the nearest edge slide, never gets discarded.
  const start = Math.max(0, Math.min(slides - 1, Math.floor(left / SLIDE_WIDTH)));
  const end = Math.max(start, Math.min(slides - 1, Math.ceil(right / SLIDE_WIDTH) - 1));
  return { start, end };
}

function slideLayout(project: Project): { blocks: SlideBlock[]; photoStarts: number[] } {
  if (project.slides < 1) return { blocks: [], photoStarts: [] };
  const links = new Array<boolean>(project.slides - 1).fill(false);
  const groups = new Map<string, SlideBlock>();
  const photoStarts: number[] = [];
  const link = ({ start, end }: SlideBlock) => {
    for (let seam = start; seam < end; seam++) links[seam] = true;
  };
  for (const photo of project.photos) {
    const range = photoSlides(photo, project.slides);
    photoStarts.push(range.start);
    link(range);
    if (photo.groupId) {
      const group = groups.get(photo.groupId);
      if (group) {
        group.start = Math.min(group.start, range.start);
        group.end = Math.max(group.end, range.end);
      } else {
        groups.set(photo.groupId, { ...range });
      }
    }
  }
  for (const group of groups.values()) link(group);
  const blocks: SlideBlock[] = [];
  let start = 0;
  for (let seam = 0; seam < project.slides - 1; seam++) {
    if (!links[seam]) {
      blocks.push({ start, end: seam });
      start = seam + 1;
    }
  }
  blocks.push({ start, end: project.slides - 1 });
  return { blocks, photoStarts };
}

export function slideBlocks(project: Project): SlideBlock[] {
  return slideLayout(project).blocks;
}

export function reorderSlides(project: Project, fromSlide: number, toSlide: number): Project {
  if (!Number.isInteger(fromSlide) || !Number.isInteger(toSlide)
    || fromSlide < 0 || fromSlide >= project.slides
    || toSlide < 0 || toSlide >= project.slides || fromSlide === toSlide) return project;
  const { blocks, photoStarts } = slideLayout(project);
  const source = blocks.findIndex((block) => fromSlide >= block.start && fromSlide <= block.end);
  const target = blocks.findIndex((block) => toSlide >= block.start && toSlide <= block.end);
  if (source === target || source < 0 || target < 0) return project;
  const [moving] = blocks.splice(source, 1);
  // Removing the source makes target the insertion gap before a left target,
  // or after a right target, regardless of the blocks' different lengths.
  blocks.splice(target, 0, moving);
  const displacement = new Array<number>(project.slides);
  let nextSlide = 0;
  for (const block of blocks) {
    const offset = (nextSlide - block.start) * SLIDE_WIDTH;
    for (let slide = block.start; slide <= block.end; slide++) displacement[slide] = offset;
    nextSlide += block.end - block.start + 1;
  }
  return {
    ...project,
    photos: project.photos.map((photo, index) => {
      const offset = displacement[photoStarts[index]];
      return offset === 0 ? photo : { ...photo, x: photo.x + offset };
    }),
  };
}
