interface Props {
  icon?: React.ReactNode;
  title: string;
  description: string;
  action?: React.ReactNode;
}

export default function EmptyState({ icon, title, description, action }: Props) {
  return (
    <div className="flex flex-col items-center justify-center py-20 px-4 text-center animate-fade-in-up">
      <div className="w-16 h-16 rounded-2xl bg-dark-800/60 border border-white/[0.08] flex items-center justify-center mb-5">
        {icon || (
          <svg className="w-7 h-7 text-dark-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
          </svg>
        )}
      </div>
      <h3 className="text-base font-semibold text-dark-200 mb-1.5">{title}</h3>
      <p className="text-dark-400 text-sm max-w-xs leading-relaxed">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
