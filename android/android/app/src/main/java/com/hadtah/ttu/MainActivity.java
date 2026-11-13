package com.hadtah.ttu;

import android.app.DownloadManager;
import android.content.ContentValues;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.widget.Toast;
import com.getcapacitor.BridgeActivity;
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

public class MainActivity extends BridgeActivity {
    private boolean hooked = false;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        hookWebView();
    }

    @Override
    public void onStart() {
        super.onStart();
        hookWebView();
    }

    private void hookWebView() {
        if (hooked || getBridge() == null) return;
        WebView web = getBridge().getWebView();
        if (web == null) return;
        hooked = true;
        web.addJavascriptInterface(new PdfSaver(), "TTuNative");
        web.setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) -> {
            if (url == null || url.startsWith("blob:") || url.startsWith("data:")) return;
            try {
                DownloadManager.Request req = new DownloadManager.Request(Uri.parse(url));
                req.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                req.setMimeType(mimeType);
                req.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, guessName(contentDisposition, url));
                ((DownloadManager) getSystemService(DOWNLOAD_SERVICE)).enqueue(req);
                Toast.makeText(this, "Saving to Downloads…", Toast.LENGTH_SHORT).show();
            } catch (Exception e) {
                Toast.makeText(this, "Could not start the download", Toast.LENGTH_SHORT).show();
            }
        });
    }

    private String guessName(String contentDisposition, String url) {
        if (contentDisposition != null) {
            java.util.regex.Matcher m = java.util.regex.Pattern.compile("filename\\*=UTF-8''([^;]+)|filename=\"?([^\";]+)\"?", java.util.regex.Pattern.CASE_INSENSITIVE).matcher(contentDisposition);
            if (m.find()) {
                String n = m.group(1) != null ? m.group(1) : m.group(2);
                if (n != null && !n.isBlank()) return n.trim();
            }
        }
        try {
            String path = Uri.parse(url).getLastPathSegment();
            if (path != null && path.contains(".")) return path;
        } catch (Exception ignored) { }
        return "TTu-download";
    }

    public class PdfSaver {
        @JavascriptInterface
        public void savePdf(String base64, String filename) {
            new Thread(() -> {
                try {
                    byte[] data = Base64.decode(base64, Base64.DEFAULT);
                    String name = (filename == null || filename.isBlank()) ? "TTu.pdf" : filename.replaceAll("[^A-Za-z0-9._-]", "_");
                    if (!name.toLowerCase().endsWith(".pdf")) name = name + ".pdf";
                    if (Build.VERSION.SDK_INT >= 29) {
                        ContentValues values = new ContentValues();
                        values.put(MediaStore.Downloads.DISPLAY_NAME, name);
                        values.put(MediaStore.Downloads.MIME_TYPE, "application/pdf");
                        values.put(MediaStore.Downloads.IS_PENDING, 1);
                        Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                        if (uri == null) throw new IllegalStateException("MediaStore insert failed");
                        try (OutputStream out = getContentResolver().openOutputStream(uri)) {
                            if (out == null) throw new IllegalStateException("No output stream");
                            out.write(data);
                        }
                        values.clear();
                        values.put(MediaStore.Downloads.IS_PENDING, 0);
                        getContentResolver().update(uri, values, null, null);
                    } else {
                        File dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                        if (!dir.exists() && !dir.mkdirs()) throw new IllegalStateException("Downloads folder missing");
                        try (FileOutputStream out = new FileOutputStream(new File(dir, name))) {
                            out.write(data);
                        }
                    }
                    runOnUiThread(() -> Toast.makeText(MainActivity.this, "PDF saved to Downloads", Toast.LENGTH_SHORT).show());
                } catch (Exception e) {
                    runOnUiThread(() -> Toast.makeText(MainActivity.this, "Could not save the PDF", Toast.LENGTH_SHORT).show());
                }
            }).start();
        }
    }
}
