import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { useEditor, useEditorState, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Bold, Italic, List, ListOrdered, Heading2, Heading3, Minus, Undo, Redo, Link2, Link2Off, Download, Upload, Trash2, PenLine, Newspaper, X, ArrowDownToLine, GripVertical, Copy } from 'lucide-react';
import { parseImportedPressKitFile, findPressKitJsonFile } from '../utils/pressKitImport';
import toast from '../utils/anchoredToast';
import { showConfirmToast } from '../utils/toastDialogs';
import { dataClient } from '../lib/dataClient';
import type { PressKitImage, PressKitShare } from '../lib/dataClient/types';
import { generatePressKitZip } from '../lib/pressKitZip';
import { saveBlob } from '../lib/download';
import { PRESSKIT_ICON_OPTIONS } from '../lib/iconOptions';
import { createWebpThumbnail } from '../utils/imageThumbnail';
import type { PressKit } from '../types';
import { useBands } from '../context/BandsContext';
import { parsePressKitMedia, detectPresavePlatformLabel, normalizePresaveUrl } from '../utils/pressKitMedia';

type PressKitImageAsset = PressKitImage;

const MEDIA_ITEMS_PER_PAGE = 16;

function slugifyFileName(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'press-kit';
}

function inferImageExtension(url: string, mimeType: string): string {
  const normalizedMime = mimeType.split(';')[0].trim().toLowerCase();
  const fromMime = normalizedMime.startsWith('image/') ? normalizedMime.slice(6) : '';
  if (fromMime) return fromMime;

  const pathname = new URL(url, window.location.origin).pathname;
  const fileName = pathname.split('/').pop() ?? '';
  const ext = fileName.includes('.') ? fileName.split('.').pop() ?? '' : '';
  return ext.toLowerCase() || 'jpg';
}

function triggerBlobDownload(blob: Blob, filename: string): void {
  void saveBlob(blob, filename);
}

interface Props {
  bandId: string;
  bandName: string;
  kit: PressKit;
  canEdit: boolean;
  userId: string | null;
  userEmail: string | null;
  onDelete: () => void;
  onRename?: (name: string) => Promise<void> | void;
  onUpdateIcon?: (icon?: string) => Promise<void> | void;
}

function normalizeEmojiIcon(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return [...trimmed].slice(0, 2).join('');
}

export default function PressKitView({ bandId, bandName, kit, canEdit, userId, userEmail, onDelete, onRename, onUpdateIcon }: Props) {
  const { deleteBandPressKit, refreshBandPressKits, refreshBandTrash, updateBandLogo } = useBands();

  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(kit.name);
  const [showIconEditor, setShowIconEditor] = useState(false);
  const [iconDraft, setIconDraft] = useState(kit.icon ?? '');
  const iconPickerRef = useRef<HTMLDivElement | null>(null);
  const iconTriggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => { if (!isRenaming) setRenameValue(kit.name); }, [isRenaming, kit.name]);
  useEffect(() => { setIconDraft(kit.icon ?? ''); }, [kit.icon]);

  useEffect(() => {
    if (!showIconEditor) return;
    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (iconPickerRef.current?.contains(target)) return;
      if (iconTriggerRef.current?.contains(target)) return;
      setShowIconEditor(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setShowIconEditor(false);
      iconTriggerRef.current?.focus();
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [showIconEditor]);

  const handleRenameCommit = async () => {
    const trimmed = renameValue.trim();
    if (!trimmed) { setRenameValue(kit.name); setIsRenaming(false); return; }
    if (trimmed !== kit.name && onRename) await onRename(trimmed);
    setIsRenaming(false);
  };

  // ── Rich text ────────────────────────────────────────────────────────────
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const editor = useEditor({
    extensions: [StarterKit],
    content: kit.richText || '',
    editable: canEdit,
    onUpdate: ({ editor: ed }) => {
      if (!canEdit) return;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        void saveRichText(ed.getHTML());
      }, 1200);
    },
  });

  const toolbarState = useEditorState({
    editor,
    selector: ({ editor: currentEditor }) => {
      if (!currentEditor) {
        return { isBold: false, isItalic: false, isHeading2: false, isHeading3: false, isBulletList: false, isOrderedList: false, canUndo: false, canRedo: false };
      }
      return {
        isBold: currentEditor.isActive('bold'),
        isItalic: currentEditor.isActive('italic'),
        isHeading2: currentEditor.isActive('heading', { level: 2 }),
        isHeading3: currentEditor.isActive('heading', { level: 3 }),
        isBulletList: currentEditor.isActive('bulletList'),
        isOrderedList: currentEditor.isActive('orderedList'),
        canUndo: currentEditor.can().undo(),
        canRedo: currentEditor.can().redo(),
      };
    },
  });

  // Sync content when kit changes (e.g. navigating between kits)
  useEffect(() => {
    if (!editor) return;
    const current = editor.getHTML();
    if (current !== kit.richText) {
      editor.commands.setContent(kit.richText || '', { emitUpdate: false });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kit.id]);

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(canEdit);
  }, [canEdit, editor]);

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  const saveRichText = async (html: string) => {
    try {
      await dataClient.bandPressKits.update(bandId, { ...kit, richText: html });
    } catch {
      toast.error('Failed to save text.');
    }
  };

  // ── Images ───────────────────────────────────────────────────────────────
  const [imageAssets, setImageAssets] = useState<PressKitImageAsset[]>([]);
  const [loadingImages, setLoadingImages] = useState(false);
  const [busyUpload, setBusyUpload] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  const [kitImageIds, setKitImageIds] = useState<string[]>(kit.imageIds ?? []);
  const [imagePage, setImagePage] = useState(1);
  const [imagePreview, setImagePreview] = useState<{ url: string; title: string } | null>(null);
  const [downloadingImageId, setDownloadingImageId] = useState<string | null>(null);

  // Sync kitImageIds when kit prop changes
  useEffect(() => {
    setKitImageIds(kit.imageIds ?? []);
    setImagePage(1);
  }, [kit.id, kit.imageIds]);

  // ── Attached image reordering (mouse, touch, and pen via Pointer Events) ──
  const [draggingImageId, setDraggingImageId] = useState<string | null>(null);
  const dragOrderRef = useRef<string[] | null>(null);

  const persistImageOrder = async (order: string[]) => {
    try {
      await dataClient.bandPressKits.update(bandId, { ...kit, imageIds: order });
    } catch {
      toast.error('Failed to save image order.');
    }
  };

  const handleImageDragStart = (event: ReactPointerEvent<HTMLButtonElement>, imageId: string) => {
    if (!canEdit) return;
    event.preventDefault();
    dragOrderRef.current = [...kitImageIds];
    setDraggingImageId(imageId);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleImageDragMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const order = dragOrderRef.current;
    if (!order || !draggingImageId) return;
    const hovered = document.elementFromPoint(event.clientX, event.clientY);
    const tile = hovered?.closest<HTMLElement>('[data-image-tile-id]');
    const targetId = tile?.dataset.imageTileId;
    if (!targetId || targetId === draggingImageId) return;
    const fromIndex = order.indexOf(draggingImageId);
    const toIndex = order.indexOf(targetId);
    if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return;
    const next = [...order];
    next.splice(fromIndex, 1);
    next.splice(toIndex, 0, draggingImageId);
    dragOrderRef.current = next;
    setKitImageIds(next);
  };

  const handleImageDragEnd = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const order = dragOrderRef.current;
    dragOrderRef.current = null;
    setDraggingImageId(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (order) void persistImageOrder(order);
  };

  useEffect(() => {
    let mounted = true;
    setLoadingImages(true);
    void dataClient.bandPressKitImages.list(bandId)
      .then((images) => {
        if (!mounted) return;
        const assets = [...images]
          .filter((a) => a.url.length > 0)
          .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
        setImageAssets(assets);
      })
      .catch(() => toast.error('Failed to load images.'))
      .finally(() => { if (mounted) setLoadingImages(false); });
    return () => { mounted = false; };
  }, [bandId]);

  useEffect(() => {
    const totalPages = Math.max(1, Math.ceil(imageAssets.length / MEDIA_ITEMS_PER_PAGE));
    if (imagePage > totalPages) {
      setImagePage(totalPages);
    }
  }, [imageAssets.length, imagePage]);

  useEffect(() => {
    if (!imagePreview) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setImagePreview(null);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [imagePreview]);

  const uploadImages = async (files: FileList | null) => {
    if (!files || files.length === 0 || !canEdit) return;
    const accepted = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (accepted.length === 0) { toast.error('Choose at least one image file.'); return; }
    setBusyUpload(true);
    try {
      const uploaded: PressKitImageAsset[] = [];
      for (const file of accepted) {
        const thumbBlob = await createWebpThumbnail(file);
        if (!thumbBlob) {
          toast.error(`Could not process "${file.name}" — skipped.`);
          continue;
        }
        const image = await dataClient.bandPressKitImages.upload(bandId, file, thumbBlob);
        uploaded.push(image);
      }
      if (uploaded.length === 0) return;
      setImageAssets((current) => [...uploaded, ...current.filter((a) => !uploaded.some((u) => u.id === a.id))]);
      // Auto-attach uploaded images to this kit
      const newIds = uploaded.map((u) => u.id);
      const nextIds = [...new Set([...kitImageIds, ...newIds])];
      setKitImageIds(nextIds);
      await dataClient.bandPressKits.update(bandId, { ...kit, imageIds: nextIds });
      toast.success(`Uploaded ${uploaded.length} image${uploaded.length === 1 ? '' : 's'}.`);
    } catch {
      toast.error('Failed to upload images.');
    } finally {
      setBusyUpload(false);
    }
  };

  const toggleKitImage = async (imageId: string, attached: boolean) => {
    const next = attached ? [...kitImageIds, imageId] : kitImageIds.filter((id) => id !== imageId);
    setKitImageIds(next);
    await dataClient.bandPressKits.update(bandId, { ...kit, imageIds: next });
  };

  const toggleAllImages = async (attachAll: boolean) => {
    const next = attachAll ? imageAssets.map((a) => a.id) : [];
    setKitImageIds(next);
    await dataClient.bandPressKits.update(bandId, { ...kit, imageIds: next });
  };

  const removeImageAsset = async (asset: PressKitImageAsset) => {
    if (!canEdit) return;
    if (asset.id === 'band-logo') {
      const confirmed = await showConfirmToast(`Move logo "${asset.title}" to trash?`, {
        confirmLabel: 'Move to trash',
      });
      if (!confirmed) return;

      const error = await updateBandLogo(bandId, null);
      if (error) {
        toast.error(error);
        return;
      }

      setImageAssets((current) => current.filter((entry) => entry.id !== asset.id));
      setKitImageIds((current) => current.filter((entryId) => entryId !== asset.id));
      void refreshBandPressKits(bandId);
      void refreshBandTrash(bandId);
      toast.success('Logo moved to trash.');
      return;
    }

    const confirmed = await showConfirmToast(`Move image "${asset.title}" to trash? It will be permanently deleted after 30 days.`, {
      confirmLabel: 'Move to trash',
    });
    if (!confirmed) return;

    try {
      // The server handles the trash record and unlinking this image from any press kit that
      // references it (see server/routes/bandPressKitImages.ts) — nothing else to persist here.
      await dataClient.bandPressKitImages.remove(bandId, asset.id);

      setImageAssets((current) => current.filter((a) => a.id !== asset.id));
      setKitImageIds((current) => current.filter((id) => id !== asset.id));
      void refreshBandPressKits(bandId);
      void refreshBandTrash(bandId);
      toast.success('Image moved to trash.');
    } catch {
      toast.error('Failed to move image to trash.');
    }
  };

  const handleImageDownload = async (asset: PressKitImageAsset) => {
    setDownloadingImageId(asset.id);
    try {
      const response = await fetch(asset.url);
      if (!response.ok) throw new Error('Failed to download image.');
      const blob = await response.blob();
      const ext = inferImageExtension(asset.url, blob.type);
      triggerBlobDownload(blob, `${slugifyFileName(asset.title)}.${ext}`);
    } catch {
      toast.error('Failed to download image.');
    } finally {
      setDownloadingImageId(null);
    }
  };

  // ── Share / Download ──────────────────────────────────────────────────────
  const [busyShare, setBusyShare] = useState(false);
  const [activeShare, setActiveShare] = useState<PressKitShare | null>(null);

  useEffect(() => {
    if (!userId || !userEmail) return;
    setActiveShare(null);
    void dataClient.bandPressKitShares.get(bandId, kit.id)
      .then(setActiveShare)
      .catch(() => setActiveShare(null));
  }, [bandId, kit.id, userId, userEmail]);

  // ── Video URLs ───────────────────────────────────────────────────────────
  const [videoUrls, setVideoUrls] = useState<string[]>(kit.videoUrls ?? []);
  const [selectedVideoUrls, setSelectedVideoUrls] = useState<string[]>(
    kit.selectedVideoUrls ?? kit.videoUrls ?? [],
  );
  const [newVideoUrl, setNewVideoUrl] = useState('');

  useEffect(() => {
    const nextVideoUrls = kit.videoUrls ?? [];
    const nextSelected = kit.selectedVideoUrls ?? nextVideoUrls;
    setVideoUrls(nextVideoUrls);
    setSelectedVideoUrls(nextSelected.filter((url) => nextVideoUrls.includes(url)));
  }, [kit.id, kit.videoUrls, kit.selectedVideoUrls]);

  const saveVideoState = async (nextVideoUrls: string[], nextSelectedVideoUrls: string[]) => {
    if (!canEdit) return;
    const cleanedUrls = nextVideoUrls.map((u) => u.trim()).filter(Boolean);
    const validUrls = cleanedUrls.filter((url) => parsePressKitMedia(url));
    const validSelected = nextSelectedVideoUrls
      .map((u) => u.trim())
      .filter((url) => validUrls.includes(url));

    if (validUrls.length !== cleanedUrls.length) {
      toast.error('Some links were ignored. Only YouTube, Vimeo, VEVO, Spotify, and SoundCloud URLs are supported.');
    }

    try {
      await dataClient.bandPressKits.update(bandId, {
        ...kit,
        videoUrls: validUrls,
        selectedVideoUrls: validSelected,
      });
      setVideoUrls(validUrls);
      setSelectedVideoUrls(validSelected);
    } catch {
      toast.error('Failed to save video links.');
    }
  };

  const addVideoUrl = async () => {
    if (!canEdit) return;
    const trimmed = newVideoUrl.trim();
    if (!trimmed) return;

    if (!parsePressKitMedia(trimmed)) {
      toast.error('Use a valid YouTube, Vimeo, VEVO, Spotify, or SoundCloud link.');
      return;
    }

    if (videoUrls.includes(trimmed)) {
      toast.error('That video is already added.');
      return;
    }

    const nextUrls = [...videoUrls, trimmed];
    const nextSelected = [...selectedVideoUrls, trimmed];
    setNewVideoUrl('');
    await saveVideoState(nextUrls, nextSelected);
  };

  const removeVideoUrl = async (url: string) => {
    const nextUrls = videoUrls.filter((entry) => entry !== url);
    const nextSelected = selectedVideoUrls.filter((entry) => entry !== url);
    await saveVideoState(nextUrls, nextSelected);
  };

  const toggleVideoSelection = async (url: string, selected: boolean) => {
    const nextSelected = selected
      ? Array.from(new Set([...selectedVideoUrls, url]))
      : selectedVideoUrls.filter((entry) => entry !== url);
    await saveVideoState(videoUrls, nextSelected);
  };

  const toggleAllVideos = async (selectAll: boolean) => {
    await saveVideoState(videoUrls, selectAll ? [...videoUrls] : []);
  };

  const handleCopyUrl = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Link copied.');
    } catch {
      toast.error(`Failed to copy. Copy this link: ${url}`);
    }
  };

  // ── Presaves / upcoming release ─────────────────────────────────────────
  const [presaveReleaseName, setPresaveReleaseName] = useState(kit.presaveReleaseName ?? '');
  const [presaveReleaseDate, setPresaveReleaseDate] = useState(kit.presaveReleaseDate ?? '');
  const [presaveUrls, setPresaveUrls] = useState<string[]>(kit.presaveUrls ?? []);
  const [selectedPresaveUrls, setSelectedPresaveUrls] = useState<string[]>(
    kit.selectedPresaveUrls ?? kit.presaveUrls ?? [],
  );
  const [newPresaveUrl, setNewPresaveUrl] = useState('');

  useEffect(() => {
    setPresaveReleaseName(kit.presaveReleaseName ?? '');
    setPresaveReleaseDate(kit.presaveReleaseDate ?? '');
    const nextPresaveUrls = kit.presaveUrls ?? [];
    const nextSelected = kit.selectedPresaveUrls ?? nextPresaveUrls;
    setPresaveUrls(nextPresaveUrls);
    setSelectedPresaveUrls(nextSelected.filter((url) => nextPresaveUrls.includes(url)));
  }, [kit.id, kit.presaveReleaseName, kit.presaveReleaseDate, kit.presaveUrls, kit.selectedPresaveUrls]);

  const savePresaveMeta = async (nextName: string, nextDate: string) => {
    if (!canEdit) return;
    try {
      // Explicit `null` (not `undefined`, which JSON.stringify would drop) so an emptied field
      // actually clears server-side — see the `'presaveReleaseName' in body` check in
      // server/routes/bandPressKits.ts.
      await dataClient.bandPressKits.update(bandId, {
        ...kit,
        presaveReleaseName: (nextName.trim() || null) as unknown as string | undefined,
        presaveReleaseDate: (nextDate || null) as unknown as string | undefined,
      });
    } catch {
      toast.error('Failed to save release info.');
    }
  };

  const savePresaveState = async (nextPresaveUrls: string[], nextSelectedPresaveUrls: string[]) => {
    if (!canEdit) return;
    const cleanedUrls = nextPresaveUrls.map((u) => u.trim()).filter(Boolean);
    const validUrls = cleanedUrls.filter((url) => normalizePresaveUrl(url));
    const validSelected = nextSelectedPresaveUrls
      .map((u) => u.trim())
      .filter((url) => validUrls.includes(url));

    if (validUrls.length !== cleanedUrls.length) {
      toast.error('Some links were ignored. Use a full URL (e.g. https://open.spotify.com/...).');
    }

    try {
      await dataClient.bandPressKits.update(bandId, {
        ...kit,
        presaveUrls: validUrls,
        selectedPresaveUrls: validSelected,
      });
      setPresaveUrls(validUrls);
      setSelectedPresaveUrls(validSelected);
    } catch {
      toast.error('Failed to save presave links.');
    }
  };

  const addPresaveUrl = async () => {
    if (!canEdit) return;
    const trimmed = newPresaveUrl.trim();
    if (!trimmed) return;

    const normalized = normalizePresaveUrl(trimmed);
    if (!normalized) {
      toast.error('Use a valid link, e.g. https://open.spotify.com/... or a smart link.');
      return;
    }

    if (presaveUrls.includes(normalized)) {
      toast.error('That link is already added.');
      return;
    }

    const nextUrls = [...presaveUrls, normalized];
    const nextSelected = [...selectedPresaveUrls, normalized];
    setNewPresaveUrl('');
    await savePresaveState(nextUrls, nextSelected);
  };

  const removePresaveUrl = async (url: string) => {
    const nextUrls = presaveUrls.filter((entry) => entry !== url);
    const nextSelected = selectedPresaveUrls.filter((entry) => entry !== url);
    await savePresaveState(nextUrls, nextSelected);
  };

  const togglePresaveSelection = async (url: string, selected: boolean) => {
    const nextSelected = selected
      ? Array.from(new Set([...selectedPresaveUrls, url]))
      : selectedPresaveUrls.filter((entry) => entry !== url);
    await savePresaveState(presaveUrls, nextSelected);
  };

  const pressKitImportInputRef = useRef<HTMLInputElement | null>(null);
  const [isImportingPressKit, setIsImportingPressKit] = useState(false);

  const handleImportPressKit = async (files: FileList | null) => {
    const fileArray = Array.from(files ?? []);
    const jsonFile = findPressKitJsonFile(fileArray);
    if (!jsonFile) {
      toast.error('Select the kit.json file from a gigboy press kit export (optionally along with its images).', { duration: 8000 });
      return;
    }

    setIsImportingPressKit(true);
    try {
      const draft = await parseImportedPressKitFile(jsonFile);
      const imageFiles = fileArray.filter((file) => file !== jsonFile);

      const uploadedAssets: PressKitImageAsset[] = [];
      let unmatchedImageCount = 0;
      for (const ref of draft.images) {
        const match = imageFiles.find((file) => file.name.toLowerCase() === ref.filename.toLowerCase());
        if (!match) { unmatchedImageCount += 1; continue; }
        const thumbBlob = await createWebpThumbnail(match);
        if (!thumbBlob) { unmatchedImageCount += 1; continue; }
        const uploaded = await dataClient.bandPressKitImages.upload(bandId, match, thumbBlob);
        uploadedAssets.push(uploaded);
      }

      if (draft.richText) {
        editor?.commands.setContent(draft.richText, { emitUpdate: false });
        await saveRichText(draft.richText);
      }

      if (uploadedAssets.length > 0) {
        const newIds = uploadedAssets.map((asset) => asset.id);
        const nextImageIds = [...new Set([...kitImageIds, ...newIds])];
        setImageAssets((current) => [...uploadedAssets, ...current.filter((a) => !newIds.includes(a.id))]);
        setKitImageIds(nextImageIds);
        await dataClient.bandPressKits.update(bandId, { ...kit, imageIds: nextImageIds });
      }

      if (draft.videoUrls.length > 0) {
        const nextUrls = [...new Set([...videoUrls, ...draft.videoUrls])];
        const nextSelected = [...new Set([...selectedVideoUrls, ...draft.selectedVideoUrls])];
        await saveVideoState(nextUrls, nextSelected);
      }

      if (draft.presaveUrls.length > 0) {
        const nextUrls = [...new Set([...presaveUrls, ...draft.presaveUrls])];
        const nextSelected = [...new Set([...selectedPresaveUrls, ...draft.selectedPresaveUrls])];
        await savePresaveState(nextUrls, nextSelected);
      }

      if (draft.presaveReleaseName || draft.presaveReleaseDate) {
        const nextName = draft.presaveReleaseName ?? presaveReleaseName;
        const nextDate = draft.presaveReleaseDate ?? presaveReleaseDate;
        await savePresaveMeta(nextName, nextDate);
        setPresaveReleaseName(nextName);
        setPresaveReleaseDate(nextDate);
      }

      if (draft.icon && onUpdateIcon) {
        await onUpdateIcon(draft.icon);
      }

      await refreshBandPressKits(bandId);

      const summaryParts: string[] = [];
      if (draft.richText) summaryParts.push('text updated');
      if (uploadedAssets.length > 0) summaryParts.push(`${uploadedAssets.length} image${uploadedAssets.length === 1 ? '' : 's'} added`);
      if (draft.videoUrls.length > 0) summaryParts.push(`${draft.videoUrls.length} video link${draft.videoUrls.length === 1 ? '' : 's'} merged`);
      if (draft.presaveUrls.length > 0) summaryParts.push(`${draft.presaveUrls.length} presave link${draft.presaveUrls.length === 1 ? '' : 's'} merged`);
      toast.success(`Imported "${draft.name}"${summaryParts.length > 0 ? ` — ${summaryParts.join(', ')}` : ''}.`);

      if (unmatchedImageCount > 0) {
        toast.error(
          `${unmatchedImageCount} image${unmatchedImageCount === 1 ? '' : 's'} not selected — re-upload from the images/ folder if needed.`,
          { duration: 8000 },
        );
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to import press kit.', { duration: 8000 });
    } finally {
      setIsImportingPressKit(false);
      if (pressKitImportInputRef.current) pressKitImportInputRef.current.value = '';
    }
  };

  const [busyDownload, setBusyDownload] = useState(false);

  const imageAssetsById = new Map(imageAssets.map((img) => [img.id, img]));
  const attachedImages = kitImageIds
    .map((id) => imageAssetsById.get(id))
    .filter((img): img is PressKitImageAsset => Boolean(img));
  const imageTotalPages = Math.max(1, Math.ceil(imageAssets.length / MEDIA_ITEMS_PER_PAGE));
  const imagePageStart = (imagePage - 1) * MEDIA_ITEMS_PER_PAGE;
  const pagedImageAssets = imageAssets.slice(imagePageStart, imagePageStart + MEDIA_ITEMS_PER_PAGE);

  const handleShare = async () => {
    if (!userId || !userEmail) { toast.error('You must be signed in to share.'); return; }
    setBusyShare(true);
    try {
      const result = await dataClient.bandPressKitShares.create(bandId, kit.id);
      setActiveShare(result);
      await navigator.clipboard.writeText(result.publicUrl);
      toast.success('Public link copied to clipboard.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to create share link.');
    } finally {
      setBusyShare(false);
    }
  };

  const [busyDisable, setBusyDisable] = useState(false);

  const handleDisable = async () => {
    if (!userId || !userEmail || !activeShare) return;
    const confirmed = await showConfirmToast('Disable this public link? Anyone with it will lose access.', {
      confirmLabel: 'Disable link',
    });
    if (!confirmed) return;
    setBusyDisable(true);
    try {
      await dataClient.bandPressKitShares.disable(bandId, kit.id);
      setActiveShare(null);
      toast.success('Public link disabled.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to disable link.');
    } finally {
      setBusyDisable(false);
    }
  };

  const handleDownload = async () => {
    setBusyDownload(true);
    try {
      const richText = editor?.getHTML() ?? kit.richText ?? '';
      const blob = await generatePressKitZip({
        bandName,
        stageplots: [],
        riders: [],
        texts: richText ? [{ title: kit.name, body: richText }] : [],
        images: attachedImages,
        videoUrls,
        presaveReleaseName,
        presaveReleaseDate,
        presaveUrls,
        generatedAt: new Date().toISOString(),
      });
      const blobUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = blobUrl;
      anchor.download = `${slugifyFileName(kit.name)}-press-kit.zip`;
      anchor.click();
      URL.revokeObjectURL(blobUrl);
    } catch {
      toast.error('Failed to generate ZIP.');
    } finally {
      setBusyDownload(false);
    }
  };

  const handleDelete = async () => {
    if (!canEdit) return;
    const confirmed = await showConfirmToast(`Delete "${kit.name}"? This cannot be undone.`, {
      confirmLabel: 'Delete press kit',
    });
    if (!confirmed) return;
    const error = await deleteBandPressKit(bandId, kit.id);
    if (error) { toast.error(error); return; }
    onDelete();
  };

  return (
    <section className="bands-page bands-page--library">
      <input
        ref={pressKitImportInputRef}
        type="file"
        accept="application/json,.json,image/*"
        multiple
        onChange={(event) => { void handleImportPressKit(event.target.files); }}
        style={{ display: 'none' }}
      />
      <div className="setlist-shell">
        <div className="list-sticky-header">
          <header className="page-section-header bands-header resource-header">
            <div className="setlist-title-block">
              {isRenaming ? (
                <input
                  type="text"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleRenameCommit();
                    if (e.key === 'Escape') { setRenameValue(kit.name); setIsRenaming(false); }
                  }}
                  onBlur={() => void handleRenameCommit()}
                  className="setlist-name-input"
                  autoFocus
                />
              ) : (
                <div className="song-list-title-row">
                  <h1 className="resource-title setlist-title resource-title--setlist">
                    {canEdit && onUpdateIcon ? (
                      <div className="icon-picker-wrapper" ref={iconPickerRef}>
                        <button
                          ref={iconTriggerRef}
                          type="button"
                          className={`icon-picker-trigger${showIconEditor ? ' is-open' : ''}`}
                          aria-haspopup="dialog"
                          aria-expanded={showIconEditor}
                          onClick={(e) => { e.stopPropagation(); setShowIconEditor((v) => !v); }}
                          title="Change press kit icon"
                          aria-label="Change press kit icon"
                        >
                          <span className="resource-title-icon" aria-hidden="true">
                            {kit.icon ? kit.icon : <Newspaper size={20} />}
                          </span>
                        </button>
                        {showIconEditor && (
                          <div className="icon-picker-popover" role="dialog" aria-label="Choose press kit icon">
                            <div className="emoji-choice-grid" role="radiogroup" aria-label="Press kit icon options">
                              <button
                                type="button"
                                className={`emoji-choice-btn${!kit.icon ? ' active' : ''}`}
                                onClick={() => { void onUpdateIcon(undefined); setIconDraft(''); setShowIconEditor(false); }}
                                aria-pressed={!kit.icon}
                              >
                                <Newspaper size={16} />
                              </button>
                              {PRESSKIT_ICON_OPTIONS.map((emoji) => {
                                const selected = iconDraft === emoji;
                                return (
                                  <button
                                    key={emoji}
                                    type="button"
                                    className={`emoji-choice-btn${selected ? ' active' : ''}`}
                                    onClick={() => { void onUpdateIcon(normalizeEmojiIcon(emoji)); setIconDraft(emoji); setShowIconEditor(false); }}
                                    aria-pressed={selected}
                                  >
                                    {emoji}
                                  </button>
                                );
                              })}
                            </div>
                            <button
                              type="button"
                              className="icon-picker-reset-btn"
                              onClick={() => { void onUpdateIcon(undefined); setIconDraft(''); setShowIconEditor(false); }}
                            >
                              Reset to default
                            </button>
                          </div>
                        )}
                      </div>
                    ) : kit.icon ? (
                      <span className="resource-title-icon" aria-hidden="true">{kit.icon}</span>
                    ) : null}
                    {kit.name}
                  </h1>
                  {canEdit && onRename ? (
                    <button type="button" className="title-rename-btn" onClick={() => setIsRenaming(true)} title="Rename press kit">
                      <PenLine size={14} />
                    </button>
                  ) : null}
                </div>
              )}
              <p className="setlist-subtitle">Write copy, attach images, and share your public press kit.</p>
            </div>
            <div className="resource-header-actions">
              {activeShare ? (
                <>
                  <button
                    type="button"
                    className="setlist-action-btn setlist-action-btn--accent"
                    onClick={() => { void navigator.clipboard.writeText(activeShare.publicUrl).then(() => toast.success('Link copied.')); }}
                    title="Copy public link"
                  >
                    <Link2 size={14} /> Copy link
                  </button>
                  <button
                    type="button"
                    className="setlist-action-btn setlist-action-btn--secondary"
                    onClick={() => void handleDisable()}
                    disabled={busyDisable}
                    title="Disable public link"
                  >
                    <Link2Off size={14} /> {busyDisable ? 'Disabling...' : 'Disable link'}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="setlist-action-btn setlist-action-btn--accent"
                  onClick={() => void handleShare()}
                  disabled={busyShare}
                  title="Create and copy public share link"
                >
                  <Link2 size={14} /> {busyShare ? 'Creating...' : 'Share'}
                </button>
              )}
              <button
                type="button"
                className="setlist-action-btn setlist-action-btn--secondary"
                onClick={() => void handleDownload()}
                disabled={busyDownload}
                title="Download ZIP"
              >
                <Download size={14} />
              </button>
              {canEdit && (
                <button
                  type="button"
                  className="setlist-action-btn setlist-action-btn--secondary"
                  onClick={() => pressKitImportInputRef.current?.click()}
                  disabled={isImportingPressKit}
                  title={isImportingPressKit ? 'Importing press kit…' : 'Import press kit from file'}
                  aria-label="Import press kit from file"
                >
                  <Upload size={14} />
                </button>
              )}
              {canEdit && (
                <button
                  type="button"
                  className="setlist-action-btn setlist-action-btn--secondary"
                  onClick={() => void handleDelete()}
                  title="Delete press kit"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          </header>


        </div>

        <div className="press-kit-body-columns">
          {/* ── Text + Presave ────────────────────────────────────────────── */}
          <div className="press-kit-column-stack">

          <div className="press-kit-section-card">
            <section className="press-kit-text-section">
              <header className="press-kit-section-header">
                <p className="press-kit-section-title">Text</p>
                {canEdit && <p className="press-kit-section-hint">Write and format the copy to include in this press kit.</p>}
              </header>
              {canEdit && editor && (
                <div className="press-kit-toolbar" aria-label="Text formatting toolbar">
                  <button type="button" title="Bold" className={`press-kit-toolbar-btn${toolbarState.isBold ? ' active' : ''}`} onClick={() => editor.chain().focus().toggleBold().run()}><Bold size={14} /></button>
                  <button type="button" title="Italic" className={`press-kit-toolbar-btn${toolbarState.isItalic ? ' active' : ''}`} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic size={14} /></button>
                  <span className="press-kit-toolbar-sep" />
                  <button type="button" title="Heading 2" className={`press-kit-toolbar-btn${toolbarState.isHeading2 ? ' active' : ''}`} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}><Heading2 size={14} /></button>
                  <button type="button" title="Heading 3" className={`press-kit-toolbar-btn${toolbarState.isHeading3 ? ' active' : ''}`} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}><Heading3 size={14} /></button>
                  <span className="press-kit-toolbar-sep" />
                  <button type="button" title="Bullet list" className={`press-kit-toolbar-btn${toolbarState.isBulletList ? ' active' : ''}`} onClick={() => editor.chain().focus().toggleBulletList().run()}><List size={14} /></button>
                  <button type="button" title="Ordered list" className={`press-kit-toolbar-btn${toolbarState.isOrderedList ? ' active' : ''}`} onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered size={14} /></button>
                  <span className="press-kit-toolbar-sep" />
                  <button type="button" title="Horizontal rule" className="press-kit-toolbar-btn" onClick={() => editor.chain().focus().setHorizontalRule().run()}><Minus size={14} /></button>
                  <span className="press-kit-toolbar-sep" />
                  <button type="button" title="Undo" className="press-kit-toolbar-btn" onClick={() => editor.chain().focus().undo().run()} disabled={!toolbarState.canUndo}><Undo size={14} /></button>
                  <button type="button" title="Redo" className="press-kit-toolbar-btn" onClick={() => editor.chain().focus().redo().run()} disabled={!toolbarState.canRedo}><Redo size={14} /></button>
                </div>
              )}
              <div className="press-kit-editor-wrap">
                <EditorContent editor={editor} className="press-kit-editor" />
              </div>
            </section>
          </div>

          <div className="press-kit-section-card press-kit-section-card--presave">
            <section className="press-kit-videos-section">
              <header className="press-kit-section-header">
                <p className="press-kit-section-title">Presave / Upcoming Release</p>
                {canEdit && <p className="press-kit-section-hint">Announce an unreleased track and add presave links for each platform.</p>}
              </header>
              <div className="setlist-notes-editor">
                {canEdit && (
                  <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
                    <input
                      type="text"
                      value={presaveReleaseName}
                      onChange={(e) => setPresaveReleaseName(e.target.value)}
                      onBlur={() => void savePresaveMeta(presaveReleaseName, presaveReleaseDate)}
                      placeholder="Release name (e.g. New Single — Out Sept 12)"
                      className="press-kit-video-url-input"
                      style={{ flex: '2 1 220px' }}
                    />
                    <input
                      type="date"
                      value={presaveReleaseDate}
                      onChange={(e) => setPresaveReleaseDate(e.target.value)}
                      onBlur={() => void savePresaveMeta(presaveReleaseName, presaveReleaseDate)}
                      className="press-kit-video-url-input"
                      style={{ flex: '1 1 160px' }}
                    />
                  </div>
                )}

                {canEdit && (
                  <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
                    <input
                      type="url"
                      value={newPresaveUrl}
                      onChange={(e) => setNewPresaveUrl(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          void addPresaveUrl();
                        }
                      }}
                      placeholder="Spotify, Apple Music, or smart link"
                      className="press-kit-video-url-input"
                    />
                    <button
                      type="button"
                      className="setlist-action-btn setlist-action-btn--secondary"
                      onClick={() => void addPresaveUrl()}
                    >
                      Add
                    </button>
                  </div>
                )}

                {presaveUrls.length === 0 ? (
                  <p className="bands-status">No presave links added yet.</p>
                ) : (
                  <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                    {presaveUrls.map((url) => {
                      const selected = selectedPresaveUrls.includes(url);
                      return (
                        <li key={url} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'var(--surface)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', padding: '0.4rem 0.6rem' }}>
                          {canEdit && (
                            <input
                              type="checkbox"
                              checked={selected}
                              onChange={(e) => { void togglePresaveSelection(url, e.target.checked); }}
                              title="Include in public share"
                            />
                          )}
                          <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--muted)', flexShrink: 0 }}>{detectPresavePlatformLabel(url)}</span>
                          <span style={{ flex: 1, minWidth: 0, fontSize: '0.75rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{url}</span>
                          <button
                            type="button"
                            className="title-rename-btn"
                            title="Copy URL"
                            onClick={() => { void handleCopyUrl(url); }}
                          >
                            <Copy size={13} />
                          </button>
                          {canEdit && (
                            <button
                              type="button"
                              className="title-rename-btn"
                              title="Remove presave link"
                              onClick={() => { void removePresaveUrl(url); }}
                            >
                              <Trash2 size={13} />
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </section>
          </div>

          </div>

          {/* ── Images + Videos ──────────────────────────────────────────── */}
          <div className="press-kit-column-stack">

          <div className="press-kit-section-card">
          <section className="press-kit-images-section">
            <header className="press-kit-section-header">
              <p className="press-kit-section-title">Images</p>
              {canEdit && <p className="press-kit-section-hint">Check the images to include in this press kit.</p>}
            </header>
            <div className="setlist-notes-editor">

              {canEdit && (
                <div
                  role="button"
                  tabIndex={0}
                  onDragOver={(e) => { e.preventDefault(); if (!busyUpload) setDropActive(true); }}
                  onDragLeave={() => setDropActive(false)}
                  onDrop={(e) => { e.preventDefault(); setDropActive(false); void uploadImages(e.dataTransfer.files); }}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') document.getElementById('pk-img-input')?.click(); }}
                  onClick={() => document.getElementById('pk-img-input')?.click()}
                  style={{
                    border: dropActive ? '2px solid var(--bands-hue)' : '2px dashed var(--bands-hue)',
                    borderRadius: 'var(--radius)',
                    padding: '0.75rem',
                    background: dropActive ? 'var(--bands-hue-soft)' : 'color-mix(in srgb, var(--bands-hue) 8%, var(--surface))',
                    cursor: 'pointer',
                    marginBottom: '0.75rem',
                  }}
                >
                  <p className="songlist-item-meta" style={{ margin: 0 }}>
                    {busyUpload ? 'Uploading…' : 'Drag & drop or click to upload images'}
                  </p>
                </div>
              )}
              <input id="pk-img-input" type="file" accept="image/*" multiple style={{ display: 'none' }} disabled={!canEdit || busyUpload}
                onChange={(e) => { void uploadImages(e.target.files); e.currentTarget.value = ''; }}
              />

              {loadingImages && <p className="bands-status">Loading images…</p>}

              {!loadingImages && imageAssets.length === 0 && (
                <p className="bands-status">No images uploaded yet.</p>
              )}

              {attachedImages.length > 0 && (
                <div style={{ marginBottom: '0.9rem' }}>
                  <p className="songlist-item-meta" style={{ margin: '0 0 0.4rem' }}>
                    In this press kit{canEdit ? ' — drag to reorder' : ''}
                  </p>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: '0.5rem' }}>
                    {attachedImages.map((img) => (
                      <div
                        key={img.id}
                        data-image-tile-id={img.id}
                        style={{
                          position: 'relative',
                          borderRadius: 'var(--radius)',
                          overflow: 'hidden',
                          border: '1px solid var(--border)',
                          opacity: draggingImageId === img.id ? 0.5 : 1,
                          touchAction: draggingImageId ? 'none' : undefined,
                        }}
                      >
                        <img
                          src={img.thumbUrl ?? img.url}
                          alt={img.title}
                          loading="lazy"
                          decoding="async"
                          style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', display: 'block' }}
                        />
                        {canEdit && (
                          <button
                            type="button"
                            aria-label={`Reorder ${img.title}`}
                            title="Drag to reorder"
                            onPointerDown={(e) => handleImageDragStart(e, img.id)}
                            onPointerMove={handleImageDragMove}
                            onPointerUp={handleImageDragEnd}
                            onPointerCancel={handleImageDragEnd}
                            style={{
                              position: 'absolute',
                              top: '4px',
                              right: '4px',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              width: '1.6rem',
                              height: '1.6rem',
                              background: 'rgba(0,0,0,0.55)',
                              color: '#fff',
                              border: 'none',
                              borderRadius: 'var(--radius-xs)',
                              cursor: 'grab',
                              touchAction: 'none',
                              zIndex: 1,
                            }}
                          >
                            <GripVertical size={14} />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {imageAssets.length > 0 && (
                <p className="songlist-item-meta" style={{ margin: '0 0 0.4rem' }}>Image library</p>
              )}

              {canEdit && imageAssets.length > 0 && (
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.4rem', fontSize: '0.8rem', color: 'var(--muted)', cursor: 'pointer', userSelect: 'none' }}>
                  <input
                    type="checkbox"
                    checked={imageAssets.length > 0 && imageAssets.every((a) => kitImageIds.includes(a.id))}
                    ref={(el) => { if (el) el.indeterminate = imageAssets.some((a) => kitImageIds.includes(a.id)) && !imageAssets.every((a) => kitImageIds.includes(a.id)); }}
                    onChange={(e) => void toggleAllImages(e.target.checked)}
                  />
                  Select all
                </label>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: '0.6rem' }}>
              {pagedImageAssets.map((img) => {
                const attached = kitImageIds.includes(img.id);
                return (
                  <div key={img.id} style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', background: 'var(--surface)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', overflow: 'hidden' }}>
                    <div style={{ position: 'relative' }}>
                      <button
                        type="button"
                        className="image-preview-trigger"
                        onClick={() => setImagePreview({ url: img.url, title: img.title })}
                        aria-label={`Preview ${img.title}`}
                      >
                        <img
                          src={img.thumbUrl ?? img.url}
                          alt={img.title}
                          loading="lazy"
                          decoding="async"
                          style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', display: 'block' }}
                        />
                      </button>
                      {canEdit && (
                        <label style={{ position: 'absolute', top: '6px', left: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '1.4rem', height: '1.4rem', background: 'rgba(0,0,0,0.5)', borderRadius: 'var(--radius-xs)', cursor: 'pointer', zIndex: 1 }}>
                          <input
                            type="checkbox"
                            checked={attached}
                            disabled={!canEdit}
                            onChange={(e) => void toggleKitImage(img.id, e.target.checked)}
                            style={{ accentColor: 'var(--bands-hue)' }}
                          />
                        </label>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', padding: '0 0.4rem 0.4rem' }}>
                      <button
                        type="button"
                        className="title-rename-btn"
                        title="Download image"
                        aria-label={`Download ${img.title}`}
                        onClick={() => { void handleImageDownload(img); }}
                        disabled={downloadingImageId === img.id}
                      >
                        <ArrowDownToLine size={13} />
                      </button>
                      {canEdit && (
                        <button type="button" className="title-rename-btn" title="Delete image" aria-label={`Delete ${img.title}`} onClick={() => void removeImageAsset(img)}><Trash2 size={13} /></button>
                      )}
                    </div>
                  </div>
                );
              })}
              </div>

              {imageAssets.length > MEDIA_ITEMS_PER_PAGE && (
                <div className="media-pagination">
                  <button
                    type="button"
                    className="setlist-action-btn setlist-action-btn--secondary"
                    onClick={() => setImagePage((current) => Math.max(1, current - 1))}
                    disabled={imagePage <= 1}
                  >
                    Previous
                  </button>
                  <p className="bands-inline-note">Page {imagePage} of {imageTotalPages}</p>
                  <button
                    type="button"
                    className="setlist-action-btn setlist-action-btn--secondary"
                    onClick={() => setImagePage((current) => Math.min(imageTotalPages, current + 1))}
                    disabled={imagePage >= imageTotalPages}
                  >
                    Next
                  </button>
                </div>
              )}
            </div>
          </section>
          </div>

          <div className="press-kit-section-card">
            <section className="press-kit-videos-section">
              <header className="press-kit-section-header">
                <p className="press-kit-section-title">Music & Videos</p>
                {canEdit && <p className="press-kit-section-hint">Add videos, tracks, and playlists, and choose which ones are included in the public share link.</p>}
              </header>
              <div className="setlist-notes-editor">
                {canEdit && (
                  <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
                    <input
                      type="url"
                      value={newVideoUrl}
                      onChange={(e) => setNewVideoUrl(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          void addVideoUrl();
                        }
                      }}
                      placeholder="YouTube, Vimeo, Vevo, Spotify, or SoundCloud"
                      className="press-kit-video-url-input"
                    />
                    <button
                      type="button"
                      className="setlist-action-btn setlist-action-btn--secondary"
                      onClick={() => void addVideoUrl()}
                    >
                      Add
                    </button>
                  </div>
                )}

                {canEdit && videoUrls.length > 0 && (
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.4rem', fontSize: '0.8rem', color: 'var(--muted)', cursor: 'pointer', userSelect: 'none' }}>
                    <input
                      type="checkbox"
                      checked={videoUrls.length > 0 && videoUrls.every((url) => selectedVideoUrls.includes(url))}
                      ref={(el) => {
                        if (!el) return;
                        const anySelected = videoUrls.some((url) => selectedVideoUrls.includes(url));
                        const allSelected = videoUrls.every((url) => selectedVideoUrls.includes(url));
                        el.indeterminate = anySelected && !allSelected;
                      }}
                      onChange={(e) => { void toggleAllVideos(e.target.checked); }}
                    />
                    Select all videos for sharing
                  </label>
                )}

                {videoUrls.length === 0 ? (
                  <p className="bands-status">No videos added yet.</p>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.6rem' }}>
                    {videoUrls.map((url) => {
                      const media = parsePressKitMedia(url);
                      const selected = selectedVideoUrls.includes(url);
                      return (
                        <div key={url} style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', background: 'var(--surface)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', overflow: 'hidden' }}>
                          <div style={{ position: 'relative' }}>
                            {media ? (
                              media.provider === 'spotify' || media.provider === 'soundcloud' ? (
                                <iframe
                                  src={media.embedUrl}
                                  width="100%"
                                  height={media.embedHeight ?? 152}
                                  title={media.provider === 'spotify' ? 'Spotify player' : 'SoundCloud player'}
                                  allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
                                  loading="lazy"
                                />
                              ) : (
                                <iframe
                                  src={media.embedUrl}
                                  width="100%"
                                  title={`${media.provider} video`}
                                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                                  allowFullScreen
                                  loading="lazy"
                                  referrerPolicy="strict-origin-when-cross-origin"
                                  style={{ aspectRatio: '16 / 9', border: 0, display: 'block' }}
                                />
                              )
                            ) : (
                              <div style={{ aspectRatio: '16 / 9', display: 'grid', placeItems: 'center', color: 'var(--muted)' }}>Unsupported link</div>
                            )}

                            <label style={{ position: 'absolute', top: '6px', left: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '1.4rem', height: '1.4rem', background: 'rgba(0,0,0,0.5)', borderRadius: 'var(--radius-xs)', cursor: canEdit ? 'pointer' : 'default', zIndex: 1 }}>
                              <input
                                type="checkbox"
                                checked={selected}
                                disabled={!canEdit}
                                onChange={(e) => { void toggleVideoSelection(url, e.target.checked); }}
                                style={{ accentColor: 'var(--bands-hue)' }}
                              />
                            </label>
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', padding: '0 0.4rem 0.4rem' }}>
                            <span style={{ flex: 1, minWidth: 0, fontSize: '0.75rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--muted)' }}>{url}</span>
                            <button
                              type="button"
                              className="title-rename-btn"
                              title="Copy URL"
                              onClick={() => { void handleCopyUrl(url); }}
                            >
                              <Copy size={13} />
                            </button>
                            {canEdit && (
                              <button
                                type="button"
                                className="title-rename-btn"
                                title="Remove video"
                                onClick={() => { void removeVideoUrl(url); }}
                              >
                                <Trash2 size={13} />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </section>
          </div>
          </div>

        </div>

        {imagePreview && (
          <div className="image-lightbox-overlay" onClick={() => setImagePreview(null)} role="dialog" aria-modal="true" aria-label={`${imagePreview.title} preview`}>
            <div className="image-lightbox" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                className="image-lightbox-close"
                onClick={() => setImagePreview(null)}
                title="Close preview"
                aria-label="Close preview"
              >
                <X size={18} />
              </button>
              <img src={imagePreview.url} alt={imagePreview.title} className="image-lightbox-image" />
              <p className="image-lightbox-caption">{imagePreview.title}</p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
