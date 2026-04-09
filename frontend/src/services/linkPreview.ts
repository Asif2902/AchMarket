export interface LinkPreviewData {
  url: string;
  title: string;
  description: string;
  image: string;
  siteName: string;
  embeddable: boolean;
  embedBlockReason: string;
}

export async function fetchLinkPreview(url: string): Promise<LinkPreviewData> {
  const origin = window.location.origin;
  const response = await fetch(`/api/link-preview?url=${encodeURIComponent(url)}&origin=${encodeURIComponent(origin)}`);
  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = typeof body?.error === 'string' ? body.error : 'Failed to load preview.';
    throw new Error(message);
  }

  const preview = body?.preview as Partial<LinkPreviewData> | undefined;
  if (!preview || typeof preview.url !== 'string') {
    throw new Error('Invalid preview response.');
  }

  return {
    url: preview.url,
    title: typeof preview.title === 'string' ? preview.title : '',
    description: typeof preview.description === 'string' ? preview.description : '',
    image: typeof preview.image === 'string' ? preview.image : '',
    siteName: typeof preview.siteName === 'string' ? preview.siteName : '',
    embeddable: Boolean(preview.embeddable),
    embedBlockReason: typeof preview.embedBlockReason === 'string' ? preview.embedBlockReason : '',
  };
}
