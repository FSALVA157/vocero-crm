import { CHANNEL_LABEL, type Channel } from "@/lib/channels";
import { cn } from "@/lib/utils";

/**
 * 010 — Distintivo del canal de una conversación o contacto. Ícono mínimo
 * y monocromo (hereda `currentColor`): no compite con el avatar ni con la
 * marca; el color lo aporta el contexto.
 */

function WhatsappGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} fill="currentColor">
      <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 1.8a8.2 8.2 0 1 1-4.2 15.3l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 0 1 12 3.8Zm-3.3 4.4c-.2 0-.5 0-.7.3-.3.3-1 1-1 2.4s1 2.8 1.2 3c.1.2 2 3.2 5 4.4 2.5 1 3 .8 3.5.7.5 0 1.7-.7 2-1.4.2-.7.2-1.2.1-1.4l-.5-.3-1.8-.9c-.3-.1-.4-.1-.6.1l-.9 1.1c-.2.2-.3.2-.6.1a6.7 6.7 0 0 1-3.4-3c-.2-.4.3-.4.8-1.4.1-.2 0-.4 0-.5l-.8-2c-.2-.5-.4-.4-.6-.4h-.7Z" />
    </svg>
  );
}

function InstagramGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} fill="none" stroke="currentColor" strokeWidth="1.9">
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.3" cy="6.7" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function ChannelGlyph({ channel, className }: { channel: Channel; className?: string }) {
  return channel === "instagram" ? (
    <InstagramGlyph className={className} />
  ) : (
    <WhatsappGlyph className={className} />
  );
}

export function ChannelBadge({
  channel,
  withLabel = false,
  className,
}: {
  channel: Channel;
  withLabel?: boolean;
  className?: string;
}) {
  const label = CHANNEL_LABEL[channel];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full text-[11px] font-medium",
        withLabel && "border bg-secondary px-2 py-0.5 text-text-2",
        channel === "instagram" ? "text-[#c13584]" : "text-[#25D366]",
        className
      )}
      title={label}
      aria-label={label}
      data-channel={channel}
    >
      <ChannelGlyph channel={channel} className="h-3.5 w-3.5" />
      {withLabel && <span className={channel === "instagram" ? "text-text-2" : "text-text-2"}>{label}</span>}
    </span>
  );
}
