import { Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { apiUrl } from './providers';

type SecureDownloadParams = {
  url: string;
  fileName: string;
  // Set this when `url` is already a complete, ready-to-use URL — either a
  // safe direct link (e.g. omegatech.app's own /stream or /download, proven
  // via curl to need no proxying) or an already-built /api/download-file
  // proxy link from the server. Wrapping it again through proxiedDownloadUrl()
  // here would double-proxy it and break the download.
  preResolved?: boolean;
};

function cleanFileName(fileName: string) {
  const cleaned = fileName
    .replace(/[^a-z0-9._ -]+/gi, '_')
    .replace(/_+/g, '_')
    .trim();
  return cleaned || 'video.mp4';
}

export function proxiedDownloadUrl(url: string, fileName: string) {
  return apiUrl('/api/download-file', {
    url,
    filename: cleanFileName(fileName),
  });
}

export async function triggerSecureDownload({ url, fileName, preResolved }: SecureDownloadParams) {
  const safeFileName = cleanFileName(fileName);
  const downloadUrl = preResolved ? url : proxiedDownloadUrl(url, safeFileName);

  if (Platform.OS === 'web' && typeof document !== 'undefined') {
    const anchor = document.createElement('a');
    anchor.href = downloadUrl;
    anchor.download = safeFileName;
    anchor.target = '_self';
    anchor.rel = 'noopener noreferrer';
    anchor.addEventListener('click', (event) => event.stopPropagation());

    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    return;
  }

  await WebBrowser.openBrowserAsync(downloadUrl);
}
