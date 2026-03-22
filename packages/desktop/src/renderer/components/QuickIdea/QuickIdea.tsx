import { useState, useRef, useEffect, useCallback } from "react";
import { X, Send, Paperclip } from "lucide-react";
import { createPortal } from "react-dom";
import { useAppStore } from "../../stores/app.store.js";
import { useT } from "../../i18n.js";
import { VoiceButton } from "../VoiceButton/VoiceButton.js";

interface QuickImage {
  id: string;
  name: string;
  mediaType: string;
  data: string; // base64
}

const MAX_IMAGES = 5;
const MAX_DIMENSION = 1200;
const JPEG_QUALITY = 0.7;

const readFileAsBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

const compressImage = (file: File): Promise<{ data: string; mediaType: string }> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (!width || !height) { reject(new Error("Invalid")); return; }
      if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
        if (width > height) {
          height = Math.round(height * (MAX_DIMENSION / width));
          width = MAX_DIMENSION;
        } else {
          width = Math.round(width * (MAX_DIMENSION / height));
          height = MAX_DIMENSION;
        }
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d")!.drawImage(img, 0, 0, width, height);
      const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
      img.src = "";
      resolve({ data: dataUrl.split(",")[1], mediaType: "image/jpeg" });
    };
    img.onerror = reject;
    const reader = new FileReader();
    reader.onload = () => { img.src = reader.result as string; };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

const processImageFile = async (file: File): Promise<QuickImage> => {
  if (file.size < 200 * 1024) {
    const data = await readFileAsBase64(file);
    return { id: crypto.randomUUID(), name: file.name, mediaType: file.type || "image/png", data };
  }
  const { data, mediaType } = await compressImage(file);
  return { id: crypto.randomUUID(), name: file.name, mediaType, data };
};

export function QuickIdeaPopup() {
  const quickIdeaOpen = useAppStore((s) => s.quickIdeaOpen);
  const setQuickIdeaOpen = useAppStore((s) => s.setQuickIdeaOpen);
  const quickCreateIdea = useAppStore((s) => s.quickCreateIdea);
  const currentProject = useAppStore((s) => s.currentProject);
  const t = useT();

  const [text, setText] = useState("");
  const [images, setImages] = useState<QuickImage[]>([]);
  const [saving, setSaving] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (quickIdeaOpen && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [quickIdeaOpen]);

  // --- Image handling ---

  const addFiles = useCallback(async (files: File[]) => {
    const imageFiles = files.filter((f) => f.type.startsWith("image/"));
    if (imageFiles.length === 0) return;
    const processed: QuickImage[] = [];
    for (const file of imageFiles) {
      try { processed.push(await processImageFile(file)); } catch { /* skip */ }
    }
    if (processed.length > 0) {
      setImages((prev) => {
        const remaining = MAX_IMAGES - prev.length;
        return remaining > 0 ? [...prev, ...processed.slice(0, remaining)] : prev;
      });
    }
  }, []);

  const handleAttach = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.multiple = true;
    input.onchange = () => { if (input.files) addFiles(Array.from(input.files)); };
    input.click();
  }, [addFiles]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData.items).filter((i) => i.type.startsWith("image/"));
    if (items.length === 0) return;
    e.preventDefault();
    const files = items.map((i) => i.getAsFile()).filter(Boolean) as File[];
    addFiles(files);
  }, [addFiles]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    addFiles(Array.from(e.dataTransfer.files));
  }, [addFiles]);

  const removeImage = useCallback((id: string) => {
    setImages((prev) => prev.filter((img) => img.id !== id));
  }, []);

  // --- Submit ---

  const handleSubmit = useCallback(async () => {
    if ((!text.trim() && images.length === 0) || saving) return;
    setSaving(true);
    try {
      await quickCreateIdea(text, images.length > 0 ? images : undefined);
      setText("");
      setImages([]);
      setQuickIdeaOpen(false);
    } finally {
      setSaving(false);
    }
  }, [text, images, saving, quickCreateIdea, setQuickIdeaOpen]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
      if (e.key === "Escape") {
        setQuickIdeaOpen(false);
      }
    },
    [handleSubmit, setQuickIdeaOpen],
  );

  const handleVoiceTranscript = useCallback(
    (transcript: string) => {
      setText((prev) => (prev ? prev + " " + transcript : transcript));
    },
    [],
  );

  if (!quickIdeaOpen || !currentProject) return null;

  const canSend = text.trim() || images.length > 0;

  return createPortal(
    <div className="quick-idea-overlay" onClick={() => setQuickIdeaOpen(false)}>
      <div
        className={`quick-idea-popup${dragOver ? " quick-idea-dragover" : ""}`}
        onClick={(e) => e.stopPropagation()}
        onDrop={handleDrop}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={(e) => {
          e.preventDefault();
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false);
        }}
      >
        <div className="quick-idea-header">
          <span className="quick-idea-title">{t("quickIdeaTitle")}</span>
          <button className="btn-icon" onClick={() => setQuickIdeaOpen(false)}>
            <X size={16} />
          </button>
        </div>
        <div className="quick-idea-body">
          {images.length > 0 && (
            <div className="quick-idea-images">
              {images.map((img) => (
                <div key={img.id} className="quick-idea-image-thumb">
                  <img src={`data:${img.mediaType};base64,${img.data}`} alt={img.name} />
                  <button
                    className="quick-idea-image-remove"
                    onClick={() => removeImage(img.id)}
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <textarea
            ref={textareaRef}
            className="quick-idea-input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={t("quickIdeaPlaceholder")}
            rows={3}
            disabled={saving}
          />
        </div>
        <div className="quick-idea-footer">
          <button
            className="btn-icon"
            onClick={handleAttach}
            disabled={images.length >= MAX_IMAGES}
            title={t("attachImages")}
          >
            <Paperclip size={16} />
          </button>
          <VoiceButton onTranscript={handleVoiceTranscript} size={16} />
          <button
            className="btn-icon quick-idea-send"
            onClick={handleSubmit}
            disabled={!canSend || saving}
            title={t("sendMessage")}
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
