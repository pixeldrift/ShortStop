import Image from "next/image";

export function Logo({ size = "large" }: { size?: "large" | "small" }) {
  return (
    <Image
      src="/assets/logo.png"
      alt="ShortStop"
      width={2172}
      height={724}
      priority={size === "large"}
      className={size === "large" ? "h-20 w-auto sm:h-28" : "h-8 w-auto"}
    />
  );
}
