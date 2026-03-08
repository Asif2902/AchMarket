interface Props {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export default function LoadingSpinner({ size = 'md', className = '' }: Props) {
  const sizeMap = { sm: 'w-4 h-4', md: 'w-7 h-7', lg: 'w-10 h-10' };
  const borderMap = { sm: 'border-[1.5px]', md: 'border-2', lg: 'border-[2.5px]' };
  return (
    <div className={`flex items-center justify-center ${className}`} role="status" aria-live="polite">
      <div className={`${sizeMap[size]} ${borderMap[size]} border-dark-700 border-t-primary-500 rounded-full animate-spin`} />
      <span className="sr-only">Loading</span>
    </div>
  );
}

export function PageLoader() {
  return (
    <div className="flex flex-col items-center justify-center py-24 gap-4 animate-fade-in" role="status" aria-live="polite">
      <div className="relative">
        <div className="w-12 h-12 border-2 border-dark-700 border-t-primary-500 rounded-full animate-spin" />
        <div className="absolute inset-0 flex items-center justify-center">
          <img
            src="/img/logos/achswap-logo.png"
            alt=""
            className="w-5 h-5 rounded object-cover opacity-60"
          />
        </div>
      </div>
      <p className="text-dark-500 text-sm font-medium">Loading...</p>
    </div>
  );
}

export function SkeletonCard() {
  return (
    <div className="card overflow-hidden">
      <div className="skeleton h-36 sm:h-40 w-full rounded-none" />
      <div className="p-4 space-y-3">
        <div className="skeleton h-4 w-4/5 rounded" />
        <div className="skeleton h-4 w-3/5 rounded" />
        <div className="space-y-2.5 pt-1">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 flex-1">
              <div className="skeleton w-1.5 h-1.5 rounded-full" />
              <div className="skeleton h-3 w-12 rounded" />
            </div>
            <div className="skeleton h-1 w-16 rounded-full" />
            <div className="skeleton h-3 w-10 rounded" />
          </div>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 flex-1">
              <div className="skeleton w-1.5 h-1.5 rounded-full" />
              <div className="skeleton h-3 w-10 rounded" />
            </div>
            <div className="skeleton h-1 w-16 rounded-full" />
            <div className="skeleton h-3 w-10 rounded" />
          </div>
        </div>
        <div className="border-t border-white/[0.04] pt-2">
          <div className="skeleton h-1 w-full rounded-full mb-2" />
          <div className="flex justify-between">
            <div className="skeleton h-3 w-20 rounded" />
            <div className="skeleton h-3 w-14 rounded" />
          </div>
        </div>
      </div>
    </div>
  );
}
