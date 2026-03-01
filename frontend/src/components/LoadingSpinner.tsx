interface Props {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export default function LoadingSpinner({ size = 'md', className = '' }: Props) {
  const sizeMap = { sm: 'w-4 h-4', md: 'w-7 h-7', lg: 'w-10 h-10' };
  const borderMap = { sm: 'border-[1.5px]', md: 'border-2', lg: 'border-[2.5px]' };
  return (
    <div className={`flex items-center justify-center ${className}`}>
      <div className={`${sizeMap[size]} ${borderMap[size]} border-dark-700 border-t-primary-500 rounded-full animate-spin`} />
    </div>
  );
}

export function PageLoader() {
  return (
    <div className="flex flex-col items-center justify-center py-24 gap-4 animate-fade-in">
      <LoadingSpinner size="lg" />
      <p className="text-dark-500 text-sm font-medium">Loading...</p>
    </div>
  );
}

export function SkeletonCard() {
  return (
    <div className="card overflow-hidden">
      <div className="skeleton h-36 sm:h-40 w-full" />
      <div className="p-4 space-y-3">
        <div className="skeleton h-4 w-4/5 rounded" />
        <div className="skeleton h-4 w-3/5 rounded" />
        <div className="space-y-2 pt-1">
          <div className="flex justify-between">
            <div className="skeleton h-3 w-12 rounded" />
            <div className="skeleton h-3 w-10 rounded" />
          </div>
          <div className="flex justify-between">
            <div className="skeleton h-3 w-10 rounded" />
            <div className="skeleton h-3 w-10 rounded" />
          </div>
        </div>
        <div className="divider" />
        <div className="flex justify-between">
          <div className="skeleton h-3 w-20 rounded" />
          <div className="skeleton h-3 w-14 rounded" />
        </div>
      </div>
    </div>
  );
}
