'use strict';

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'exportCSV') {
    const csvContent = message.csv;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `linkedin-connections-${timestamp}.csv`;

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const reader = new FileReader();

    reader.onloadend = () => {
      chrome.downloads.download(
        {
          url: reader.result,
          filename,
          saveAs: true,
        },
        (downloadId) => {
          if (chrome.runtime.lastError) {
            sendResponse({ success: false, error: chrome.runtime.lastError.message });
          } else {
            sendResponse({ success: true, downloadId });
          }
        }
      );
    };

    reader.readAsDataURL(blob);
    return true; // keep message channel open for async response
  }
});
