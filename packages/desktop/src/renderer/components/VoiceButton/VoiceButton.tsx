import { useMemo } from "react";
import { Mic, MicOff, Loader2 } from "lucide-react";
import { useVoiceInput } from "../../hooks/use-voice-input.js";
import { useT } from "../../i18n.js";

interface VoiceButtonProps {
  onTranscript: (text: string) => void;
  disabled?: boolean;
  className?: string;
  size?: number;
}

export function VoiceButton({ onTranscript, disabled, className, size = 16 }: VoiceButtonProps) {
  const t = useT();

  const callbacks = useMemo(() => ({
    onTranscript,
  }), [onTranscript]);

  const { isRecording, isTranscribing, isAvailable, toggleRecording } = useVoiceInput(callbacks);

  const isDisabled = disabled || !isAvailable || isTranscribing;

  let title: string;
  let stateClass = "";

  if (!isAvailable) {
    title = t("voiceNoModel");
    stateClass = "voice-btn--unavailable";
  } else if (isTranscribing) {
    title = t("voiceTranscribing");
    stateClass = "voice-btn--transcribing";
  } else if (isRecording) {
    title = t("voiceRecording");
    stateClass = "voice-btn--recording";
  } else {
    title = t("voiceTooltip");
  }

  return (
    <button
      className={`btn-icon voice-btn ${stateClass} ${className || ""}`.trim()}
      onClick={toggleRecording}
      disabled={isDisabled && !isRecording}
      title={title}
    >
      {isTranscribing ? (
        <Loader2 size={size} className="voice-spinner" />
      ) : isRecording ? (
        <MicOff size={size} />
      ) : (
        <Mic size={size} />
      )}
    </button>
  );
}
