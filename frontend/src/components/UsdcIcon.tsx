interface Props {
  size?: number;
  className?: string;
}

export default function UsdcIcon({ size = 16, className = '' }: Props) {
  return (
    <img
      src="/img/usdc.webp"
      alt="USDC"
      width={size}
      height={size}
      className={`inline-block rounded-full shrink-0 ${className}`}
      draggable={false}
    />
  );
}
