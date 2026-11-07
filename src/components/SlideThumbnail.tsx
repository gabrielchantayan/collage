import { memo } from 'react';
import { photoIntersects, SLIDE_WIDTH, slideHeight } from '../model';
import type { Aspect, ResolvedPhoto } from '../model';

interface Props {
  index: number;
  aspect: Aspect;
  background: string;
  photos: ResolvedPhoto[];
}

export default memo(function SlideThumbnail({ index, aspect, background, photos }: Props) {
  const height = slideHeight(aspect);
  const bounds = { x: index * SLIDE_WIDTH, y: 0, width: SLIDE_WIDTH, height };
  return <svg className="slide-thumbnail" viewBox={`0 0 ${SLIDE_WIDTH} ${height}`} width={64} height={64 * height / SLIDE_WIDTH}
    overflow="hidden" aria-hidden="true">
    <rect width={SLIDE_WIDTH} height={height} fill={background} />
    {photos.map((photo) => !photo.hidden && photoIntersects(photo, bounds) && <g key={photo.id}
      transform={`translate(${photo.x - bounds.x} ${photo.y}) rotate(${photo.rotation})`}>
      <svg width={photo.width} height={photo.height} overflow="hidden" preserveAspectRatio="none"
        viewBox={`${photo.crop.x} ${photo.crop.y} ${photo.crop.width} ${photo.crop.height}`}>
        <image href={photo.thumbnail} width={photo.naturalWidth} height={photo.naturalHeight} preserveAspectRatio="none" />
      </svg>
    </g>)}
  </svg>;
});
