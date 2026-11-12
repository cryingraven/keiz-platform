import Image from 'next/image';
import { cn } from '@/lib/utils';

/**
 * A real screenshot of the app, framed without pretending to be live data.
 * Captions always say it is the demo workspace.
 */
export function ProductShot({
  src,
  alt,
  caption,
  priority,
  className,
  width = 2880,
  height = 1800,
}: {
  src: string;
  alt: string;
  caption: string;
  priority?: boolean;
  className?: string;
  width?: number;
  height?: number;
}) {
  return (
    <figure className={cn('min-w-0', className)}>
      <div className="overflow-hidden rounded-card border border-line bg-surface shadow-[0_1px_2px_rgba(20,22,26,0.04),0_24px_60px_-40px_rgba(20,22,26,0.35)]">
        <Image
          src={src}
          alt={alt}
          width={width}
          height={height}
          priority={priority}
          sizes="(max-width: 768px) 100vw, 1120px"
          className="h-auto w-full"
        />
      </div>
      <figcaption className="mt-2.5 text-[13px] text-muted">{caption}</figcaption>
    </figure>
  );
}
